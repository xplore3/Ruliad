import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  ChatMessage,
  PersonaConfig,
  Scenario,
  ScenarioParticipant,
  ScoreReport,
  VoiceConfigDiagnosis,
  VoiceConfigOperation,
  VoiceEditCommand,
} from '@grasp-mvp/core';
import { SCORE_CATEGORIES } from '@grasp-mvp/core';
import type { ASRStream } from '@grasp-mvp/speech-gateway';
import type { Store } from '@grasp-mvp/infra';
import type { RouteContext } from '../ctx.js';
import { requireRoles, tokenFailReason, verifyToken } from '../auth.js';
import {
  TARGETS,
  RESOURCE_DEFS,
  type Target,
  type Patch,
  revisionOf,
  nameOf,
  getResource,
  listResources,
  cleanPatch,
  applyResource,
  affectedScenarios,
} from './resource-ai.js';
import { prepareScoreItemAnalysis, VoiceConfigAnalysisError } from './voice-config-analysis.js';

/* ============================================================
 * 语音自动场景创建和配置
 * 流程：LLM 理解命令 → 服务端自动定位对象 → 权限与影响检查
 *      → 生成执行预览 → 用户确认 → 落库并记录
 * 策略：私有新增 / 单场景修改 / 共享复制(copy-on-write) / 通用反馈
 * ============================================================ */

const CATEGORIES = [...SCORE_CATEGORIES];
const SCENARIO_FIELDS = [
  'name', 'category', 'sceneType', 'flowType', 'status', 'description', 'methodology', 'source',
  'difficulty', 'duration', 'successCriteria', 'goal', 'doNot', 'productKBId', 'coverageTopics',
  'participants', 'scriptExecutionOrder', 'scriptTopics', 'scriptCustomerQuestions', 'scriptAssessmentPoints',
  'skillPointNames', 'scoreItemNames', 'drillScriptName', 'conversation',
];
const PERSONA_FIELDS = [
  'name', 'roleName', 'roleTitle', 'occupation', 'roleIndustry', 'industry', 'personalities',
  'personalityTags', 'decisionStyle', 'objections', 'hiddenInfo', 'elementIds', 'behaviorBands',
  'knowledgeBoundary', 'speechRate', 'challenge', 'interruptLevel',
];

interface CommandContext {
  scenarioId?: string;
  form?: Record<string, unknown>;
}

interface ParsedOperation {
  target: Target;
  action: 'create' | 'update' | 'analyze-update';
  subject: string;
  resourceName?: string;
  fields: Patch;
  persona?: Patch;
  skillPointNames?: string[];
  scoreItemNames?: string[];
  drillScriptName?: string;
  conversation?: Patch;
  analysis?: { category?: string; scenarioName?: string; aspect?: string };
  general: boolean;
  generalReason?: string;
}

interface OpPlanResult {
  op: ParsedOperation;
  scope: 'direct' | 'copy-on-write' | 'general';
  scopeReason?: string;
  primary: VoiceConfigOperation;
  impact: Array<{ id: string; name: string }>;
  resolvedResourceId?: string;
  diagnosis?: VoiceConfigDiagnosis;
}

function schemaText(): string {
  return TARGETS.map((t) => `${RESOURCE_DEFS[t].label}(${t})：${RESOURCE_DEFS[t].schema}`).join('\n');
}

/** 汇总租户内可用资源名称，帮助 LLM 选择准确的对象描述 */
async function availableNames(store: Store, tenantId: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const target of TARGETS) {
    const items = (await listResources(store, target, tenantId)) as any[];
    out[target] = items.map((item) => nameOf(target, item)).filter(Boolean);
  }
  return out;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    const s = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').join('；');
    return s || undefined;
  }
  return undefined;
}

function clampInt(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((v): v is string => typeof v === 'string');
  return list;
}

/** 服务端自动定位操作对象：优先上下文场景绑定，其次按名称精确/包含匹配 */
async function locateResource(
  store: Store,
  tenantId: string,
  target: Target,
  action: 'create' | 'update',
  subject: string,
  context: CommandContext
): Promise<unknown | undefined> {
  const scenario = context.scenarioId ? await store.getScenario(context.scenarioId) : undefined;
  const q = normalize(subject);
  if (action === 'update' && target === 'scenario' && scenario) {
    // 上下文场景优先；但描述明显指向其它场景时不误改当前场景
    if (!q || matchesName(scenario.name ?? '', q)) return scenario;
  }
  if (action === 'create') return undefined;

  // 租户单例资源：描述为空或指向单例时直接定位（方法论配置租户内唯一，直接返回）
  if (action === 'update' && target === 'methodology-config') {
    const single = await store.getMethodologyConfig(tenantId);
    if (single) return single;
  }
  if (action === 'update' && target === 'product-kb' && !q) {
    const single = await store.getProductKB(tenantId);
    if (single) return single;
  }

  // 编辑场景中提到的关联资源：仅当描述为空或指向当前绑定资源时才优先取绑定
  if (scenario) {
    if (target === 'persona' && scenario.personaConfigId) {
      const persona = await store.getPersonaConfig(scenario.personaConfigId);
      if (persona && (!q || matchesName(nameOf(target, persona), q))) return persona;
    }
    if (target === 'drill-script' && scenario.drillScriptId) {
      const script = await store.getDrillScript(scenario.drillScriptId);
      if (script && (!q || matchesName(nameOf(target, script), q))) return script;
    }
    if (target === 'skill-point' && scenario.skillPointIds?.length) {
      const skill = await store.getSkillPoint(scenario.skillPointIds[0]);
      if (skill && (!q || matchesName(nameOf(target, skill), q))) return skill;
    }
    if (target === 'score-item' && scenario.scoreItemIds?.length) {
      const item = (await store.listScoreItemDefs(tenantId)).find((s) => s.id === scenario.scoreItemIds![0]);
      if (item && (!q || matchesName(nameOf(target, item), q))) return item;
    }
    if (target === 'product-kb' && scenario.productKBId) {
      const kb = await store.getProductKBById(scenario.productKBId);
      if (kb && (!q || matchesName(nameOf(target, kb), q))) return kb;
    }
  }

  const all = (await listResources(store, target, tenantId)) as any[];
  if (!q) return undefined;
  // 改进建议规则支持按稳定 key / id 定位（名称与 key 都可作为 subject）
  if (target === 'suggestion-rule') {
    const byKey = all.find((item) => normalize(item.key) === q || normalize(item.id) === q);
    if (byKey) return byKey;
  }
  const exact = all.find((item) => normalize(nameOf(target, item)) === q);
  if (exact) return exact;
  return all.find((item) => matchesName(nameOf(target, item), q));
}

/** 对象名称与用户描述是否匹配（忽略大小写/空白，支持包含关系） */
function matchesName(name: string, q: string): boolean {
  const n = normalize(name);
  return !!n && (n === q || n.includes(q) || q.includes(n));
}

/** 意图分流：识别「询问上一场评分原因」类问题，避免走进资源编辑流程 */
async function detectScoreExplain(gateway: RouteContext['gateway'], text: string): Promise<{ scoreExplain: boolean; scenarioName?: string }> {
  const prompt = [
    '你是意图分类器，判断用户指令属于哪一类：',
    '- score_explain：询问/复盘以往某次销售对练（模拟演练）的得分情况与原因，例如"上一场为什么激情度得分低""上次演练各项评分的原因是什么""帮我分析上次的扣分点"。',
    '- edit：要求创建或修改场景、角色、技能点、评分标准、剧本、知识库等资源（包括"根据上次评分把难度调低"这类要改配置的指令）。',
    '只返回 JSON：{"intent":"score_explain"|"edit","scenarioName":"指令中提到的场景名称，没有则为空字符串"}',
  ].join('\n');
  try {
    const result = await gateway.forTask('extractor').chat(
      [{ role: 'system', content: prompt }, { role: 'user', content: text.slice(0, 2000) }],
      { jsonMode: true, temperature: 0 },
    );
    const match = result.content.match(/\{[\s\S]*\}/);
    const parsed = match ? (JSON.parse(match[0]) as { intent?: string; scenarioName?: string }) : {};
    const scenarioName = typeof parsed.scenarioName === 'string' ? parsed.scenarioName.trim() : '';
    return { scoreExplain: parsed.intent === 'score_explain', scenarioName: scenarioName || undefined };
  } catch {
    return { scoreExplain: false };
  }
}

/** 评分解读的目标场景：优先编辑中的场景，其次按名称匹配 */
async function resolveExplainScenario(
  store: Store,
  tenantId: string,
  context: CommandContext,
  scenarioName?: string,
): Promise<Scenario | undefined> {
  if (context.scenarioId) {
    const scenario = await store.getScenario(context.scenarioId);
    if (scenario && scenario.tenantId === tenantId) return scenario;
  }
  const q = normalize(scenarioName ?? '');
  if (!q) return undefined;
  const scenarios = await store.listScenarios(tenantId);
  return scenarios.find((s) => normalize(s.name ?? '') === q) ?? scenarios.find((s) => matchesName(s.name ?? '', q));
}

function clipText(text: unknown, max: number): string {
  const s = typeof text === 'string' ? text : '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 压缩评分报告：只保留解释得分原因所需的字段 */
function summarizeReport(report: ScoreReport) {
  return {
    totalScore: report.totalScore,
    baseScore: report.baseScore,
    confidenceIndex: report.confidenceIndex,
    passed: report.passed,
    completionStatus: report.completionStatus,
    completionReason: report.completionReason,
    fatalViolation: report.fatalViolation,
    skillScores: report.skillScores,
    items: report.items.map((item) => ({
      name: item.itemName,
      level: item.levelLabel,
      score: item.score,
      quote: clipText(item.quote, 160),
      rationale: clipText(item.rationale, 300),
      betterScript: clipText(item.betterScript, 160),
      confidence: item.confidence,
      isReference: item.isReference,
    })),
    violations: report.violations,
    ruleStats: {
      interruptions: report.ruleStats.interruptions,
      fillerCounts: report.ruleStats.fillerCounts,
      coverageHits: report.ruleStats.coverageHits,
      coverageMisses: report.ruleStats.coverageMisses,
      talkRatio: report.ruleStats.talkRatio,
      avgSpeechRate: report.ruleStats.avgSpeechRate,
      pauseCount: report.ruleStats.pauseCount,
      fluencyScore: report.ruleStats.fluencyScore,
      voice: report.ruleStats.voice,
      voiceChild: report.ruleStats.voiceChild,
    },
    summary: clipText(report.summary, 400),
    improvementGoal: report.improvementGoal,
  };
}

/** 基于评分报告回答「为什么得这个分」：只依据报告数据，要求引用依据 */
async function buildScoreExplanation(
  gateway: RouteContext['gateway'],
  args: { scenarioName: string; question: string; report: ScoreReport },
): Promise<string> {
  const prompt = [
    '你是销售陪练的评分解读助手。给定一场对练的评分报告（JSON），回答用户关于各项得分/扣分原因的问题。',
    '要求：',
    '1. 只能依据报告中的数据回答（评分项得分与档位、判定理由 rationale、引用原文 quote、违规 violations、规则统计 ruleStats、总结 summary），不要编造报告没有的信息；报告没覆盖的点要明确说明。',
    '2. 先给一句话结论，再按评分项说明原因：该项得分、命中档位、扣分依据（引用原文或声学/规则数据）；用户问到具体项时聚焦该项，问整体时覆盖主要失分项。',
    '3. 每个主要原因后给出报告依据，格式「原文：…」或「数据：…」。',
    '4. 最后给出 1-3 条可操作的改进建议（可引用报告中的 betterScript 或 improvementGoal）。',
    '5. 用中文、口语化教练口吻，控制在 400 字以内。',
    `【场景】${args.scenarioName}`,
    `【评分报告】${JSON.stringify(summarizeReport(args.report))}`,
    '严格返回 JSON：{"answer":"..."}',
  ].join('\n');
  const result = await gateway.forTask('extractor').chat(
    [{ role: 'system', content: prompt }, { role: 'user', content: args.question.slice(0, 2000) }],
    { jsonMode: true, temperature: 0.3 },
  );
  const match = result.content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { answer?: string };
      if (typeof parsed.answer === 'string' && parsed.answer.trim()) return parsed.answer.trim();
    } catch { /* 落到原文兜底 */ }
  }
  return clipText(result.content, 1000);
}

function buildBehaviorBands(speechRate: unknown, challenge: unknown, interruptLevel: unknown) {
  const rate = clampInt(speechRate, 1, 3) ?? 2;
  const level = clampInt(challenge, 1, 5) ?? 3;
  const interrupt = asText(interruptLevel) ?? 'weak';
  const rateText = { 1: '语速偏慢', 2: '语速标准', 3: '语速偏快' }[rate];
  const challengeText = level >= 4 ? '追问犀利、让步很少' : level >= 3 ? '有来有回、适度施压' : '态度温和、容易沟通';
  const interruptText = { off: '从不打断对方', weak: '偶尔打断对方', strong: '频繁打断对方' }[interrupt];
  return [
    { key: 'calm', minArousal: 0, maxArousal: 0.33, instruction: `保持平和友好的语气，${rateText}，${challengeText}，${interruptText}。` },
    { key: 'engaged', minArousal: 0.33, maxArousal: 0.66, instruction: `态度认真专注，${rateText}，${challengeText}，${interruptText}。` },
    { key: 'agitated', minArousal: 0.66, maxArousal: 1, instruction: `情绪激动、不耐烦，${rateText}，施压升级，${interruptText}。` },
  ];
}

/** 角色补丁：只输出 LLM 明确给出的字段 */
function buildPersonaPatch(patch: Patch): Partial<PersonaConfig> {
  const out: Partial<PersonaConfig> = {};
  // 空字符串/空值一律视为「未提供」，避免清空语义误伤姓名字段导致合并后丢失原值
  const name = asText(patch.name ?? patch.roleName);
  if (name !== undefined) out.name = name;
  const occupation = asText(patch.roleTitle ?? patch.occupation);
  if (occupation !== undefined) out.occupation = occupation;
  const industry = asText(patch.roleIndustry ?? patch.industry);
  if (industry !== undefined) out.industry = industry;
  const personalities = stringArray(patch.personalities ?? patch.personalityTags);
  if (personalities !== undefined) out.personalityTags = personalities;
  if (patch.decisionStyle !== undefined) out.decisionStyle = asText(patch.decisionStyle);
  if (patch.objections !== undefined) out.objections = stringArray(patch.objections);
  if (patch.hiddenInfo !== undefined) out.hiddenInfo = stringArray(patch.hiddenInfo);
  if (patch.elementIds !== undefined) out.elementIds = stringArray(patch.elementIds);
  if (patch.behaviorBands !== undefined) out.behaviorBands = patch.behaviorBands as PersonaConfig['behaviorBands'];
  if (patch.knowledgeBoundary !== undefined) out.knowledgeBoundary = patch.knowledgeBoundary as PersonaConfig['knowledgeBoundary'];
  return out;
}

/** 由角色字段重建 background 展示文本 */
function personaBackground(persona: Partial<PersonaConfig>): string {
  const lines: string[] = [];
  if (persona.industry) lines.push(`行业：${persona.industry}`);
  if (persona.personalityTags?.length) lines.push(`性格标签：${persona.personalityTags.join('、')}`);
  if (persona.decisionStyle) lines.push(`决策风格：${persona.decisionStyle}`);
  if (persona.objections?.length) lines.push(`典型异议：${persona.objections.join('；')}`);
  if (persona.hiddenInfo?.length) lines.push(`禁止透露（除非被追问）：${persona.hiddenInfo.join('；')}`);
  return lines.join('\n') || '本场景的客户角色';
}

function personaBackgroundChanged(patch: Patch): boolean {
  return ['industry', 'roleIndustry', 'personalities', 'personalityTags', 'decisionStyle', 'objections', 'hiddenInfo']
    .some((key) => patch[key] !== undefined);
}

/** 角色背景相关字段是否被补丁修改 */
function backgroundKeysPresent(patch: Patch): boolean {
  return personaBackgroundChanged(patch);
}

/** 场景字段补丁 → Scenario patch；并解析技能点 / 评分标准 / 演练剧本绑定 */
async function buildScenarioPatch(
  store: Store,
  tenantId: string,
  fields: Patch
): Promise<{ patch: Patch; bindings: { skillPointIds: string[]; scoreItemIds: string[]; drillScriptId?: string }; bindingsProvided: boolean }> {
  const patch: Patch = {};
  const allowed = new Set(SCENARIO_FIELDS);
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key)) continue;
    patch[key] = value;
  }

  const bindings: { skillPointIds: string[]; scoreItemIds: string[]; drillScriptId?: string } = { skillPointIds: [], scoreItemIds: [] };
  let bindingsProvided = fields.skillPointNames !== undefined || fields.scoreItemNames !== undefined || fields.drillScriptName !== undefined;
  const category = asText(patch.category);
  const skillPoints = await store.listSkillPoints(tenantId);
  const scoreItems = await store.listScoreItemDefs(tenantId);
  const drillScripts = await store.listDrillScripts(tenantId);

  if (Array.isArray(patch.skillPointNames) && patch.skillPointNames.length) {
    bindings.skillPointIds = patch.skillPointNames
      .filter((n): n is string => typeof n === 'string')
      .map((n) => skillPoints.find((sp) => sp.name === n)?.id)
      .filter((id): id is string => !!id);
  } else if (!bindingsProvided && skillPoints.length) {
    // 新建场景未指定技能点时，默认绑定租户第一个技能点
    bindings.skillPointIds = [skillPoints[0].id];
  }

  if (Array.isArray(patch.scoreItemNames)) {
    const selected = patch.scoreItemNames.filter((n): n is string => typeof n === 'string');
    bindings.scoreItemIds = scoreItems
      .filter((item) => selected.includes(item.name) && (!item.category || !category || item.category === category))
      .map((item) => item.id);
  }
  if (asText(patch.drillScriptName)) {
    const name = asText(patch.drillScriptName)!;
    const script = drillScripts.find((item) => item.name === name && (!item.category || !category || item.category === category));
    if (script) bindings.drillScriptId = script.id;
  }

  // 清理绑定辅助字段，保留给场景实际字段
  delete patch.skillPointNames;
  delete patch.scoreItemNames;
  delete patch.drillScriptName;

  // 场景实际字段转换
  const out: Patch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'duration') out.durationMinutes = clampInt(value, 1, 60) ?? value;
    else if (key === 'successCriteria') {
      const passScore = clampInt(value ?? (fields as Patch).passScore, 0, 100);
      out.successCriteria = passScore !== undefined ? { passScore } : value;
    } else if (key === 'conversation') {
      const conversation = (value ?? {}) as Patch;
      const speechRate = clampInt(conversation.speechRate, 1, 3) ?? 2;
      const challenge = clampInt(conversation.challenge, 1, 5) ?? 3;
      const interruptLevel = asText(conversation.interruptLevel) ?? 'weak';
      out.conversation = { speechRate: speechRate as 1 | 2 | 3, challenge, interruptLevel: interruptLevel as 'off' | 'weak' | 'strong' };
    } else if (key === 'goal' || key === 'doNot' || key === 'scriptExecutionOrder' || key === 'scriptTopics'
      || key === 'scriptCustomerQuestions' || key === 'scriptAssessmentPoints') {
      // 剧本字段统一在下方重建，先暂存
    } else {
      out[key] = value;
    }
  }

  const scriptKeys = ['goal', 'doNot', 'scriptExecutionOrder', 'scriptTopics', 'scriptCustomerQuestions', 'scriptAssessmentPoints', 'sceneType'];
  if (scriptKeys.some((key) => fields[key] !== undefined)) {
    const sceneType = (fields.sceneType as 'drill' | 'practical') ?? ((out.sceneType as 'drill' | 'practical') ?? 'practical');
    const goal = asText(fields.goal);
    const doNot = asText(fields.doNot);
    const assessmentPoints = (asText(fields.scriptAssessmentPoints) ?? '').split(/[\n；;]/).map((s) => s.trim()).filter(Boolean);
    if (doNot) assessmentPoints.push(`禁止：${doNot}`);
    if (sceneType === 'practical') {
      out.script = {
        executionOrder: asText(fields.scriptExecutionOrder),
        purpose: goal,
        topics: (asText(fields.scriptTopics) ?? '').split(/[\n；;]/).map((s) => s.trim()).filter(Boolean),
        customerQuestions: (asText(fields.scriptCustomerQuestions) ?? '').split(/[\n；;]/).map((s) => s.trim()).filter(Boolean),
        assessmentPoints,
      };
    } else if (goal || doNot) {
      out.script = { purpose: goal, assessmentPoints };
    } else {
      out.script = undefined;
    }
  }

  return { patch: out, bindings, bindingsProvided };
}

function validateScenarioDraft(draft: any, bindings: { skillPointIds: string[]; scoreItemIds: string[] }): string | null {
  if (!draft.name?.trim()) return '场景标题必填';
  if (!draft.personaConfigId) return '缺少角色配置';
  if (!bindings.skillPointIds?.length) return '请至少绑定一个技能点';
  if (!draft.category || !CATEGORIES.includes(draft.category)) return '场景分类无效';
  const passScore = draft.successCriteria?.passScore;
  if (!Number.isFinite(passScore) || passScore < 0 || passScore > 100) return '及格分必须为 0-100';
  if (!Number.isFinite(draft.durationMinutes) || draft.durationMinutes < 1 || draft.durationMinutes > 60) return '时长必须为 1-60 分钟';
  if (draft.status === 'published' && !bindings.scoreItemIds?.length) return '发布场景至少绑定一条评分标准';
  return null;
}

/** 权限与处理策略决策 */
function decideScope(args: {
  admin: boolean;
  userId: string;
  target: Target;
  action: 'create' | 'update';
  current: any;
  affected: Array<{ id: string; name: string }>;
  hasContextScenario: boolean;
  general: boolean;
  generalReason?: string;
}): { scope: 'direct' | 'copy-on-write' | 'general'; reason?: string } {
  if (args.admin) return { scope: 'direct' };
  if (args.general) return { scope: 'general', reason: args.generalReason };
  // 方法论配置是租户共享配置：非管理员的新建同样进入通用建议，不直接落库
  if (args.action === 'create' && args.target !== 'methodology-config') return { scope: 'direct' };
  if (args.target === 'scenario') {
    if (args.current?.createdBy === args.userId) return { scope: 'direct' };
    // 不能修改其他用户创建的场景：转为通用建议
    return { scope: 'general', reason: '只能修改自己创建的场景，已转为通用建议' };
  }
  // 非场景资源
  const owned = args.current?.createdBy === args.userId;
  if (owned && args.affected.length <= 1) return { scope: 'direct' };
  if (!args.hasContextScenario) {
    return { scope: 'general', reason: '共享资源修改缺少可绑定的场景，已转为通用建议' };
  }
  if (args.target === 'product-kb' || args.target === 'scenario-guidance' || args.target === 'methodology-config') {
    return { scope: 'general', reason: '公共知识库/场景指引/方法论配置属于租户共享配置，已转为通用建议' };
  }
  return {
    scope: 'copy-on-write',
    reason: owned ? '资源被多个场景使用，将创建场景专属副本' : '资源来自共享库，将创建私有副本并绑定当前场景',
  };
}

/** 资源绑定字段映射（copy-on-write 后重绑场景用） */
const BINDING_FIELD: Partial<Record<Target, { field: string; mode: 'single' | 'list' }>> = {
  persona: { field: 'personaConfigId', mode: 'single' },
  'drill-script': { field: 'drillScriptId', mode: 'single' },
  'score-item': { field: 'scoreItemIds', mode: 'list' },
  'skill-point': { field: 'skillPointIds', mode: 'list' },
  'product-kb': { field: 'productKBId', mode: 'single' },
};

/**
 * 名称/描述 → 租户内资源 ID：LLM 只认识资源名称，服务端负责解析。
 * 先按 ID 原样命中，再按名称精确/包含匹配。
 */
async function resolveResourceByName(store: Store, tenantId: string, target: Target, value: unknown): Promise<string | undefined> {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const direct = await getResource(store, target, value.trim(), tenantId);
  if (direct) return (direct as { id: string }).id;
  const all = (await listResources(store, target, tenantId)) as Array<{ id: string }>;
  const q = normalize(value);
  if (!q) return undefined;
  const exact = all.find((item) => normalize(String(item.id)) === q || normalize(nameOf(target, item)) === q);
  if (exact) return exact.id;
  return all.find((item) => matchesName(nameOf(target, item), q))?.id;
}

/** 测验题的场景/技能点引用可能是名称，统一解析为租户内 ID；解析失败抛出可读错误 */
async function resolveQuizRefs(store: Store, tenantId: string, patch: Patch): Promise<Patch> {
  const out: Patch = { ...patch };
  const refs: Array<{ key: 'scenarioId' | 'skillPointId'; target: Target; label: string }> = [
    { key: 'scenarioId', target: 'scenario', label: '场景' },
    { key: 'skillPointId', target: 'skill-point', label: '技能点' },
  ];
  for (const ref of refs) {
    const value = out[ref.key];
    if (value === undefined || value === null || value === '') continue;
    const id = await resolveResourceByName(store, tenantId, ref.target, value);
    if (!id) throw new Error(`未找到引用的${ref.label}：${String(value)}，请说明准确名称`);
    out[ref.key] = id;
  }
  return out;
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

async function isPersonaShared(store: Store, tenantId: string, personaId: string, excludeScenarioId?: string): Promise<boolean> {
  const scenarios = await store.listScenarios(tenantId);
  return scenarios.filter((s) => s.personaConfigId === personaId && s.id !== excludeScenarioId).length > 0;
}

/** 引用语法：{ __ref: "key" } 取该 key 操作的产物 id */
function resolveRefs<T>(value: T, ids: Record<string, string>): T {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, ids)) as unknown as T;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.__ref === 'string') return ids[record.__ref] as unknown as T;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = resolveRefs(item, ids);
    return out as T;
  }
  return value;
}

export async function voiceConfigRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway, speech } = ctx;
  const isAdmin = (role: string) => role === 'admin' || role === 'platform';

  app.post<{ Body: any }>('/library/voice-config', async (request, reply) => {
    let text: string | undefined;
    let transcript: string | undefined;
    let context: CommandContext = {};
    let apply = false;
    let commandId: string | undefined;
    let expectedRevisions: Record<string, string> | undefined;

    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: '缺少音频文件' });
      const fields = file.fields;
      const fieldValue = (key: string): string | undefined => {
        const field: any = fields[key];
        const value: any = Array.isArray(field) ? field[0] : field;
        return value && value.type === 'field' ? String(value.value) : undefined;
      };
      const rawContext = fieldValue('context');
      if (rawContext) {
        try { context = JSON.parse(rawContext); } catch { return reply.code(400).send({ error: 'context 格式无效' }); }
      }
      const audio = await file.toBuffer();
      transcript = (await speech.asr.transcribe(audio, (file.mimetype.split('/')[1] ?? 'wav').split(';')[0])).trim();
      if (!transcript) return reply.code(422).send({ error: '未识别到有效语音' });
      text = transcript;
    } else {
      const body = (request.body ?? {}) as any;
      text = body.text?.trim();
      transcript = body.transcript;
      context = body.context ?? {};
      apply = body.apply === true;
      commandId = body.commandId;
      expectedRevisions = body.expectedRevisions;
    }

    /* ---------------- 应用已确认的命令 ---------------- */
    if (apply) {
      if (!commandId) return reply.code(400).send({ error: 'commandId 必填，请先生成预览' });
      const command = await store.getVoiceEditCommand(commandId);
      if (!command || command.tenantId !== request.tenantId || command.userId !== request.userId) {
        return reply.code(404).send({ error: '命令不存在' });
      }
      if (!command.plan) return reply.code(400).send({ error: '命令没有可执行的计划' });

      const privateOps = command.plan.operations.filter((op) => !op.general);
      const generalOps = command.plan.operations.filter((op) => op.general);

      // 只有通用内容：不修改业务数据，进入统一处理队列
      if (privateOps.length === 0) {
        const first = generalOps[0] ?? { target: command.target, patch: {} as Patch };
        const updated: VoiceEditCommand = {
          ...command,
          status: 'pending_review',
          suggestions: [...(command.suggestions ?? []), {
            target: first.target ?? command.target,
            action: command.action,
            subject: command.subject ?? '',
            resourceName: command.resourceName,
            patch: Object.assign({}, ...generalOps.map((op) => op.patch)) as Patch,
            reason: command.generalReason ?? '通用或共享修改',
          }],
          updatedAt: new Date().toISOString(),
        };
        await store.saveVoiceEditCommand(updated);
        return reply.code(202).send({ pendingReview: true, command: updated });
      }

      // 版本复核：应用前重新检查对象是否被改动
      const expected = expectedRevisions ?? {};
      for (const op of privateOps) {
        if ((op.kind === 'update-resource' || op.kind === 'update-scenario' || op.kind === 'update-persona') && op.id) {
          const target = (op.target ?? command.target) as Target;
          const current = await getResource(store, target, op.id, request.tenantId);
          if (!current) return reply.code(404).send({ error: '操作对象已不存在' });
          if (expected[op.id] && revisionOf(current) !== expected[op.id]) {
            return reply.code(409).send({ error: '资源已被其他用户修改，请重新生成预览' });
          }
        }
      }

      try {
        const result = await executePlan(store, privateOps, context, request.tenantId, request.userId);
        const updated: VoiceEditCommand = {
          ...command,
          status: 'applied',
          updatedAt: new Date().toISOString(),
          suggestions: generalOps.length
            ? [...(command.suggestions ?? []), ...generalOps.map((op) => ({
                target: op.target ?? command.target,
                action: command.action,
                subject: command.subject ?? '',
                resourceName: command.resourceName,
                patch: op.patch,
                reason: op.generalReason ?? '通用或共享修改',
              }))]
            : command.suggestions,
        };
        await store.saveVoiceEditCommand(updated);
        return { command: updated, result };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : '保存失败' });
      }
    }

    /* ---------------- 生成预览 ---------------- */
    if (!text) return reply.code(400).send({ error: 'text 或音频必填' });

    /* ---------------- 评分原因解读（上一场同场景对练） ---------------- */
    const intent = await detectScoreExplain(gateway, text);
    if (intent.scoreExplain) {
      const scenario = await resolveExplainScenario(store, request.tenantId, context, intent.scenarioName);
      // 未指定场景时回退到该用户最近一场已完成对练（独立语音编辑页 / 新场景草稿无 scenarioId）
      const sessions = scenario
        ? await store.listSessions({ userId: request.userId, scenarioId: scenario.id })
        : await store.listSessions({ userId: request.userId });
      const lastSession = sessions
        .filter((s) => s.status === 'completed')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (!lastSession) {
        return reply.code(422).send({
          error: scenario ? `场景「${scenario.name}」下还没有已完成的练习记录` : '你还没有已完成的练习记录',
        });
      }
      const report = await store.getScoreReportBySession(lastSession.id);
      if (!report) {
        return reply.code(422).send({ error: '上一场练习的评分报告尚未生成，请稍后再试' });
      }
      const sessionScenario = scenario ?? await store.getScenario(lastSession.scenarioId);
      const answer = await buildScoreExplanation(gateway, { scenarioName: sessionScenario?.name ?? '对练', question: text, report });
      return {
        transcript,
        scoreExplain: {
          scenarioName: sessionScenario?.name ?? '对练',
          sessionId: lastSession.id,
          sessionAt: lastSession.startedAt,
          totalScore: report.totalScore,
          passed: report.passed,
          answer,
        },
      };
    }

    const names = await availableNames(store, request.tenantId);
    // 翻译指南需要现状对照：注入演练剧本全文，让 LLM 能判断"现有剧本是否已覆盖该要求"
    const drillScripts = (await store.listDrillScripts(request.tenantId)).slice(0, 5).map((s) => ({
      id: s.id, name: s.name, category: s.category, content: String(s.content ?? '').slice(0, 6000),
    }));
    const suggestionRules = await store.listSuggestionRules(request.tenantId);
    const prompt = [
      '你是销售陪练系统的「语音自动场景创建和配置」助手。用户用自然语言描述要创建或修改的场景、场景配置或资源库对象。',
      '',
      '【第一步：判断操作对象】',
      `- target 只能是：${TARGETS.join(' / ')}`,
      '  scenario=对练场景；persona=陪练角色；skill-point=技能点；element=角色要素；product-kb=产品知识库；',
      '  demo-faq=示范问答；demo-script=示范剧本；drill-script=演练剧本；score-item=评分标准；golden-case=评分回归案例；',
      '  briefing-standard=讲解标准；realism-standard=演练真实度标准；scenario-guidance=场景指引配置；',
      '  quiz-question=测验题；methodology-config=方法论配置；suggestion-rule=改进建议规则（点评/改进建议的文案与阶段逻辑）。',
      '- action = create、update 或 analyze-update。',
      '- analyze-update 用于要求先查找历史演练、分析评分原因、再修改评分标准的复合指令；target=score-item，fields={}。',
      '- analysis={category:"地推|电销|咨询接待|现场成交（可选）",scenarioName:"历史场景名称（可选）",aspect:"用户要求补充的评分维度"}；aspect 用简短中文保留用户原意，例如磕磕绊绊、礼貌礼仪、需求挖掘、预算异议，不要限定为固定枚举。',
      '- 用户明确点名评分标准时，subject 返回该标准的准确名称；未点名时 subject 描述历史场景和目标维度即可。',
      '- analyze-update 是单个历史场景的诊断并修改，general=false；是否复制共享资源或转通用建议由服务端权限策略决定。',
      '- 普通创建或直接修改不要使用 analyze-update。',
      '- subject 用一句话描述对象名称/特征（如"首次电话邀约"、"需求挖掘技能点"、"客户甲"）。',
      '- 新建时在 resourceName 给出名称。',
      '',
      '【第二步：提取字段】只返回用户明确要求的字段，未提及不要返回；清空用空字符串或空数组。',
      schemaText(),
      '',
      '【scenario 专用字段】',
      '- fields 放场景字段：name / category（地推|电销|咨询接待|现场成交）/ sceneType（drill|practical）/ flowType（generic|ground_push|reception）/ status（draft|published）/ description / methodology / difficulty（1-3）/ duration（分钟,1-60）/ successCriteria（0-100）/ goal / doNot / productKBId。',
      '- persona 放角色字段（仅 target=scenario 时用于修改场景绑定角色）：name / roleTitle / roleIndustry / personalities（性格标签数组）/ decisionStyle / objections / hiddenInfo。',
      '- 当 target=persona 直接修改角色资源时，把字段放在 fields 里，且只能用角色资源字段：name / occupation / industry / personalityTags / decisionStyle / objections / hiddenInfo，不要用 roleName / roleIndustry。',
      '- skillPointNames / scoreItemNames 为要绑定的资源名称数组；drillScriptName 为演练剧本名称（不引用时返回空字符串）。',
      '- conversation 为 { speechRate:1-3, challenge:1-5, interruptLevel:off|weak|strong }。',
      '- scriptExecutionOrder / scriptTopics / scriptCustomerQuestions / scriptAssessmentPoints 为剧本流程/话题/客户问题/考核点；多值用换行或分号分隔。',
      '- participants 为参与者数组，每项可含 name/traits/speakingStyle/speechScope/languageRequirements/goal。',
      '',
      '【人类业务语言 → 资源修改 翻译指南】',
      '把用户的业务说法映射到正确的资源和字段，不要凭字面猜：',
      '- 客户的拒绝/异议话术、六连问、孩子沟通节拍（先情感支持再讲故事）、成交环节规则 → target=drill-script，fields.content 为合并后的剧本全文（在下方【现有演练剧本】基础上修改，保留无关段落原文）。',
      '- 评分/扣分/误判/评分口径问题（如虚假承诺、语速、激情度）→ target=score-item；若用户提到某次历史演练的误判，用 analyze-update 诊断并追加判定说明，不要重写全文。',
      '- 机构事实（班容、价格、师资、课时、退费、地址等）→ target=product-kb，fields.entries 必须包含全部原有条目加新增/修改条目，不得只返回新增条目。',
      '- 点评/改进建议的内容与阶段逻辑（如"以后XX情况都用这个改进建议"）→ target=suggestion-rule，fields.data 在【现有改进建议规则】基础上合并修改，保留未涉及的键；subject 用规则名称或 key（如 ground-push-incomplete）。建议库是租户内普通配置资源，general=false，不要因"适用于所有演练"就标为通用建议。',
      '- 客户性格、情绪反应、提问方式 → target=persona，改 personalityTags/behaviorBands/background 等。',
      '- 场景目标、考核点、及格分、时长 → target=scenario 对应字段。',
      '- 用户说"上一场/刚才那次演练"是在指认问题发生的现场，不代表一定要改评分标准；按问题实质选择资源。',
      '- 给评分标准追加判定说明时，用 fields.judgePromptAppend / behaviorAnchorAppend（服务端自动追加到原文末尾），不要整体替换 judgePrompt/behaviorAnchor/content 等长文本字段。',
      '',
      '【已覆盖则不修改】',
      '先对照【现有演练剧本】等现状内容判断用户要求是否已经被现有规则覆盖。若已完整覆盖：operations 返回空数组，reply 用一两句话指出现有哪条规则已包含该要求，不要重复追加或改写。若只是部分覆盖，只修改缺失部分。',
      '',
      '【第三步：通用性判断】',
      '若涉及跨场景规则、公共产品事实、合规规范、通用提示词/评分规则/系统能力，或要修改被多个场景共用的资源：general=true 并给出 generalReason。',
      '',
      '【第四步：混合指令拆分】',
      '若一条指令同时包含「私有/场景专属」与「通用」两部分，返回多个 operations，每部分一条；通用部分 general=true。',
      '',
      `【当前租户可用资源】${JSON.stringify(names)}`,
      drillScripts.length ? `【现有演练剧本】${JSON.stringify(drillScripts)}` : '',
      suggestionRules.length ? `【现有改进建议规则】${JSON.stringify(suggestionRules.map((r) => ({ id: r.id, key: r.key, name: r.name, category: r.category, data: r.data })))}` : '',
      context.scenarioId ? `【当前正在编辑的场景 ID】${context.scenarioId}` : '',
      context.form ? `【当前编辑表单快照（供理解，不是数据库）】${JSON.stringify(context.form)}` : '',
      '',
      '严格返回 JSON（不要输出多余文字）：',
      '{"reply":"一句话中文摘要","operations":[{"target":"scenario","action":"update","subject":"首次电话邀约","resourceName":"","fields":{},"persona":{},"skillPointNames":[],"scoreItemNames":[],"drillScriptName":"","conversation":{},"general":false,"generalReason":""}]}',
      '诊断并修改示例：{"reply":"已定位最近地推演练并生成修改预览","operations":[{"target":"score-item","action":"analyze-update","subject":"上次地推场景的评分标准","fields":{},"analysis":{"category":"地推","scenarioName":"","aspect":"磕磕绊绊"},"general":false}]}',
    ].join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: prompt },
      { role: 'user', content: text.slice(0, 6000) },
    ];
    const result = await gateway.forTask('extractor').chat(messages, { jsonMode: true, temperature: 0.2 });

    let parsed: { reply?: string; operations?: Partial<ParsedOperation>[] };
    try {
      parsed = JSON.parse(result.content);
    } catch {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (!match) return reply.code(422).send({ error: '无法理解指令，请换个说法重试', reply: result.content.slice(0, 200) });
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return reply.code(422).send({ error: '无法理解指令，请换个说法重试' });
      }
    }

    const rawOperations = (parsed.operations ?? []).filter((op) => op && typeof op === 'object');
    if (rawOperations.length === 0) {
      // 已覆盖则不修改：LLM 判断现有规则已包含用户要求时返回空 operations，直接回说明
      if (parsed.reply?.trim()) return { transcript, reply: parsed.reply, operations: [], noChange: true };
      return reply.code(422).send({ error: '没有识别到操作内容，请换个说法重试' });
    }

    const operations: ParsedOperation[] = [];
    for (const raw of rawOperations) {
      const target = raw.target as Target;
      if (!target || !TARGETS.includes(target)) {
        return reply.code(422).send({ error: `无法识别的操作对象类型：${String(raw.target ?? '')}` });
      }
      operations.push({
        target,
        action: raw.action === 'create' ? 'create' : ['analyze-update', 'analyze_and_update'].includes(String(raw.action)) ? 'analyze-update' : 'update',
        subject: String(raw.subject ?? ''),
        resourceName: raw.resourceName ? String(raw.resourceName) : undefined,
        fields: (raw.fields ?? {}) as Patch,
        persona: (raw.persona ?? {}) as Patch,
        skillPointNames: Array.isArray(raw.skillPointNames) ? raw.skillPointNames : undefined,
        scoreItemNames: Array.isArray(raw.scoreItemNames) ? raw.scoreItemNames : undefined,
        drillScriptName: raw.drillScriptName ? String(raw.drillScriptName) : undefined,
        conversation: (raw.conversation ?? {}) as Patch,
        analysis: raw.analysis && typeof raw.analysis === 'object' ? raw.analysis : undefined,
        general: target === 'suggestion-rule' ? false : raw.general === true,
        generalReason: raw.generalReason ? String(raw.generalReason) : undefined,
      });
    }

    const admin = isAdmin(request.userRole);
    const contextScenario = context.scenarioId ? await store.getScenario(context.scenarioId) : undefined;
    if (context.scenarioId && !contextScenario) return reply.code(404).send({ error: '当前场景不存在' });

    const planOperations: VoiceConfigOperation[] = [];
    const opPlans: OpPlanResult[] = [];
    expectedRevisions = {};

    const pushPersonaOps = (plan: VoiceConfigOperation[], op: ParsedOperation, basePatch: Partial<PersonaConfig>, scenario: any) => {
      const personaPatch = { ...basePatch };
      if (op.conversation && Object.keys(op.conversation).length) {
        personaPatch.behaviorBands = buildBehaviorBands(op.conversation.speechRate, op.conversation.challenge, op.conversation.interruptLevel) as any;
      }
      const behaviorBands = personaPatch.behaviorBands as any;
      delete personaPatch.behaviorBands;
      return { personaPatch, behaviorBands };
    };

    for (let opIndex = 0; opIndex < operations.length; opIndex++) {
      const op = operations[opIndex];
      let current: any;
      let analysisScenario: Scenario | undefined;
      let preparedAnalysis: Awaited<ReturnType<typeof prepareScoreItemAnalysis>> | undefined;
      if (op.action === 'analyze-update') {
        if (op.target !== 'score-item' || !op.analysis?.aspect?.trim()) {
          return reply.code(422).send({ error: '诊断并修改任务需要明确评分维度和目标评分标准' });
        }
        if (op.analysis.category && !CATEGORIES.includes(op.analysis.category as (typeof CATEGORIES)[number])) {
          return reply.code(422).send({ error: `不支持的场景分类：${op.analysis.category}` });
        }
        try {
          preparedAnalysis = await prepareScoreItemAnalysis({
            store,
            gateway,
            tenantId: request.tenantId,
            userId: request.userId,
            admin,
            subject: op.subject,
            question: text,
            category: op.analysis.category,
            scenarioName: op.analysis.scenarioName,
            aspect: op.analysis.aspect.trim(),
          });
        } catch (error) {
          if (error instanceof VoiceConfigAnalysisError) return reply.code(error.statusCode).send({ error: error.message });
          throw error;
        }
        current = preparedAnalysis.current;
        analysisScenario = preparedAnalysis.scenario;
        op.fields = preparedAnalysis.patch;
        op.action = 'update';
        op.general = false;
        op.generalReason = undefined;
      } else {
        current = (await locateResource(store, request.tenantId, op.target, op.action, op.subject, context)) as any;
      }
      if (op.action === 'update' && !current) {
        // 方法论配置为租户单例（upsert 语义）：尚不存在时按新建处理
        if (op.target === 'methodology-config') {
          op.action = 'create';
        } else {
          return reply.code(404).send({ error: `未找到要修改的对象：${op.subject || RESOURCE_DEFS[op.target].label}。请说明名称，或改用新建。` });
        }
      }
      const action = op.action as 'create' | 'update';
      const impact = await affectedScenarios(store, op.target, current, request.tenantId);
      const analysisPermissionReason = analysisScenario && !admin && analysisScenario.createdBy !== request.userId
        ? '只能修改自己创建的历史场景及其评分配置，已转为通用建议'
        : undefined;
      const scopeDecision = decideScope({
        admin,
        userId: request.userId,
        target: op.target,
        action,
        current,
        affected: impact,
        hasContextScenario: Boolean(analysisScenario ?? contextScenario),
        general: op.general || !!analysisPermissionReason,
        generalReason: analysisPermissionReason ?? op.generalReason,
      });
      if (current) expectedRevisions[current.id] = revisionOf(current);

      // 通用/共享内容：只记录，不修改业务数据
      if (scopeDecision.scope === 'general') {
        const generalOp: VoiceConfigOperation = {
          key: `op-${opIndex}`,
          kind: op.target === 'scenario' ? (action === 'create' ? 'create-scenario' : 'update-scenario') : 'update-resource',
          target: op.target,
          id: current?.id,
          name: op.resourceName,
          patch: jsonSafe(op.fields) as Patch,
          general: true,
          generalReason: scopeDecision.reason,
        };
        planOperations.push(generalOp);
        opPlans.push({ op, scope: 'general', scopeReason: scopeDecision.reason, primary: generalOp, impact, resolvedResourceId: current?.id, diagnosis: preparedAnalysis?.diagnosis });
        continue;
      }

      if (op.target === 'scenario') {
        const fieldsWithBindings: Patch = {
          ...op.fields,
          // 空数组是 LLM 输出模板里的占位符，不是"清空"指令，只有非空才转发
          ...(op.skillPointNames?.length ? { skillPointNames: op.skillPointNames } : {}),
          ...(op.scoreItemNames?.length ? { scoreItemNames: op.scoreItemNames } : {}),
          ...(op.drillScriptName ? { drillScriptName: op.drillScriptName } : {}),
        };
        const { patch, bindings, bindingsProvided } = await buildScenarioPatch(store, request.tenantId, fieldsWithBindings);
        const basePersona = buildPersonaPatch(op.persona ?? {});
        const { personaPatch, behaviorBands } = pushPersonaOps(planOperations, op, basePersona, current);
        if (behaviorBands) personaPatch.behaviorBands = behaviorBands;

        let primary: VoiceConfigOperation;
        if (op.action === 'create') {
          const scenarioName = asText(op.fields.name) ?? op.resourceName ?? '新场景';
          const personaName = (personaPatch.name as string) ?? `${scenarioName}角色`;
          const personaKey = `persona-${opIndex}`;
          const createPersonaOp: VoiceConfigOperation = {
            key: personaKey,
            kind: 'create-persona',
            target: 'persona',
            name: personaName,
            patch: { ...personaPatch, name: personaName } as Patch,
          };
          planOperations.push(createPersonaOp);
          const scenarioPatch: Patch = { ...patch };
          // 新建场景始终带上绑定：未指定技能点时用租户默认技能点，显式空白清单视为清空
          scenarioPatch.skillPointIds = bindings.skillPointIds;
          scenarioPatch.scoreItemIds = bindings.scoreItemIds;
          if (bindings.drillScriptId) scenarioPatch.drillScriptId = bindings.drillScriptId;
          const createScenarioOp: VoiceConfigOperation = {
            key: `op-${opIndex}`,
            kind: 'create-scenario',
            target: 'scenario',
            patch: scenarioPatch,
            ref: personaKey,
          };
          planOperations.push(createScenarioOp);
          primary = createScenarioOp;
        } else {
          const scenarioPatch: Patch = { ...patch };
          if (bindingsProvided) {
            // 更新场景时绑定为增量合并（"绑定X"不应清掉已有绑定）；空数组占位符已在转发时过滤，未提及的绑定类型不动
            if (Array.isArray(fieldsWithBindings.skillPointNames) && fieldsWithBindings.skillPointNames.length) {
              scenarioPatch.skillPointIds = [...new Set([...(current.skillPointIds ?? []), ...bindings.skillPointIds])];
            }
            if (Array.isArray(fieldsWithBindings.scoreItemNames) && fieldsWithBindings.scoreItemNames.length) {
              scenarioPatch.scoreItemIds = [...new Set([...(current.scoreItemIds ?? []), ...bindings.scoreItemIds])];
            }
            if (bindings.drillScriptId) scenarioPatch.drillScriptId = bindings.drillScriptId;
          }
          const personaChanged = Object.keys(personaPatch).length > 0;
          let personaRef: string | undefined;
          if (personaChanged) {
            const personaId = current.personaConfigId;
            if (!personaId) {
              // 场景未绑定角色：无法更新不存在的角色，改为新建并绑定，保证计划可执行
              const personaName = (personaPatch.name as string) ?? `${current.name}角色`;
              const createOp: VoiceConfigOperation = {
                key: `persona-${opIndex}`,
                kind: 'create-persona',
                target: 'persona',
                name: personaName,
                patch: { ...personaPatch, name: personaName } as Patch,
              };
              planOperations.push(createOp);
              personaRef = createOp.key;
            } else {
              const shared = await isPersonaShared(store, request.tenantId, personaId, current.id);
              if (shared) {
                const copyOp: VoiceConfigOperation = {
                  key: `persona-${opIndex}`,
                  kind: 'copy-persona',
                  target: 'persona',
                  id: personaId,
                  patch: personaPatch as Patch,
                };
                planOperations.push(copyOp);
                personaRef = copyOp.key;
              } else {
              planOperations.push({
                kind: 'update-persona',
                target: 'persona',
                id: personaId,
                patch: personaPatch as Patch,
              });
              }
            }
          }
          if (personaRef) scenarioPatch.personaConfigId = { __ref: personaRef };
          const updateScenarioOp: VoiceConfigOperation = {
            key: `op-${opIndex}`,
            kind: 'update-scenario',
            target: 'scenario',
            id: current.id,
            expectedVersion: current.version ?? 1,
            patch: scenarioPatch,
          };
          planOperations.push(updateScenarioOp);
          primary = updateScenarioOp;
        }
        opPlans.push({ op, scope: scopeDecision.scope, scopeReason: scopeDecision.reason, primary, impact, resolvedResourceId: current?.id });
        continue;
      }

      // 非场景资源
      // 追加语义：LLM 给出 xxxAppend 字段时，与当前资源文本合并（judgePromptAppend → judgePrompt 追加），避免全文重写失败
      const mergedFields: Patch = { ...op.fields };
      for (const key of Object.keys(mergedFields)) {
        if (!key.endsWith('Append')) continue;
        const base = key.slice(0, -'Append'.length);
        const addition = asText(mergedFields[key]);
        delete mergedFields[key];
        if (!addition) continue;
        const existing = typeof current?.[base] === 'string' ? (current[base] as string).trim() : '';
        mergedFields[base] = existing && !existing.includes(addition) ? `${existing}\n${addition}` : (existing || addition);
      }
      let clean: Patch;
      try { clean = cleanPatch(op.target, mergedFields); } catch (error) {
        return reply.code(422).send({ error: error instanceof Error ? error.message : '提取结果无效' });
      }
      // 防覆盖护栏：长文本字段的整体替换必须保留原文开头，否则视为误覆盖（追加请用 xxxAppend）
      if (current && (op.target === 'score-item' || op.target === 'drill-script')) {
        for (const field of ['judgePrompt', 'behaviorAnchor', 'content']) {
          const before = typeof current[field] === 'string' ? (current[field] as string).trim() : '';
          const next = typeof clean[field] === 'string' ? (clean[field] as string).trim() : undefined;
          if (next && before.length > 200 && !next.includes(before.slice(0, 80))) {
            return reply.code(422).send({ error: `字段 ${field} 的修改未保留原有内容，属于整体覆盖。请改用「${field}Append」追加说明，或输出包含原文的完整合并文本。` });
          }
        }
      }
      // 测验题的引用字段允许用名称，服务端解析为租户内 ID；解析失败直接回读错误
      if (op.target === 'quiz-question') {
        try {
          clean = await resolveQuizRefs(store, request.tenantId, clean);
        } catch (error) {
          return reply.code(422).send({ error: error instanceof Error ? error.message : '引用解析失败' });
        }
      }

      // 产品知识库：一个租户只允许一个默认库
      if (op.target === 'product-kb' && op.action === 'create') {
        const existing = await store.getProductKB(request.tenantId);
        if (existing) {
          return reply.code(409).send({ error: '机构产品知识库已存在，请改为修改现有知识库' });
        }
      }
      // 场景指引：一个场景只允许一条，存在则转为修改
      if (op.target === 'scenario-guidance' && op.action === 'create' && contextScenario) {
        const existingGuidance = await store.getScenarioGuidance(contextScenario.id);
        if (existingGuidance) {
          return reply.code(409).send({ error: '该场景已有指引配置，请改为修改现有配置' });
        }
      }

      if (scopeDecision.scope === 'copy-on-write') {
        const copyKey = `op-${opIndex}`;
        const copyOp: VoiceConfigOperation = {
          key: copyKey,
          kind: 'copy-resource',
          target: op.target,
          id: current.id,
          name: op.resourceName ?? nameOf(op.target, current),
          patch: clean,
        };
        planOperations.push(copyOp);
        const binding = BINDING_FIELD[op.target];
        const bindingScenario = analysisScenario ?? contextScenario;
        if (binding && bindingScenario) {
          expectedRevisions[bindingScenario.id] = revisionOf(bindingScenario);
          planOperations.push({
            kind: 'update-scenario',
            target: 'scenario',
            id: bindingScenario.id,
            expectedVersion: bindingScenario.version ?? 1,
            patch: {},
            rebind: { field: binding.field, mode: binding.mode, oldId: current.id, ref: copyKey },
          });
        }
        opPlans.push({ op, scope: 'copy-on-write', scopeReason: scopeDecision.reason, primary: copyOp, impact, resolvedResourceId: current.id, diagnosis: preparedAnalysis?.diagnosis });
      } else {
        const resourceOp: VoiceConfigOperation = {
          key: `op-${opIndex}`,
          kind: op.action === 'create' ? 'create-resource' : 'update-resource',
          target: op.target,
          id: current?.id,
          name: op.resourceName,
          patch: clean,
        };
        planOperations.push(resourceOp);
        if (preparedAnalysis?.needsBinding && analysisScenario) {
          expectedRevisions[analysisScenario.id] = revisionOf(analysisScenario);
          planOperations.push({
            kind: 'update-scenario',
            target: 'scenario',
            id: analysisScenario.id,
            expectedVersion: analysisScenario.version ?? 1,
            patch: { scoreItemIds: [...new Set([...(analysisScenario.scoreItemIds ?? []), current.id])] },
          });
        }
        opPlans.push({ op, scope: 'direct', scopeReason: scopeDecision.reason, primary: resourceOp, impact, resolvedResourceId: current?.id, diagnosis: preparedAnalysis?.diagnosis });
      }
    }

    const operationsPayload = opPlans.map((plan, index) => ({
      index,
      target: plan.op.target,
      action: plan.op.action,
      subject: plan.op.subject,
      resourceName: plan.op.resourceName,
      fields: jsonSafe(plan.op.fields) as Patch,
      persona: jsonSafe(plan.op.persona ?? {}) as Patch,
      skillPointNames: plan.op.skillPointNames ?? [],
      scoreItemNames: plan.op.scoreItemNames ?? [],
      drillScriptName: plan.op.drillScriptName ?? '',
      conversation: jsonSafe(plan.op.conversation ?? {}) as Patch,
      resolvedResourceId: plan.resolvedResourceId,
      scope: plan.scope,
      scopeReason: plan.scopeReason,
      impact: plan.impact,
      // 服务端权限策略判定的通用/共享作用域同样视为 general（与 LLM 标记一致对外呈现）
      general: plan.scope === 'general' || plan.op.general === true,
      generalReason: plan.scope === 'general' ? (plan.scopeReason ?? plan.op.generalReason) : plan.op.generalReason,
      planKind: plan.primary.kind,
      diagnosis: plan.diagnosis,
    }));

    const general = operationsPayload.some((op) => op.general);
    const allGeneral = operationsPayload.every((op) => op.general);
    const now = new Date().toISOString();
    const command: VoiceEditCommand = {
      id: randomUUID(),
      tenantId: request.tenantId,
      userId: request.userId,
      source: 'voice-config',
      target: operations[0].target,
      resourceId: opPlans.find((p) => p.resolvedResourceId)?.resolvedResourceId,
      action: operations[0].action as 'create' | 'update',
      text: text.slice(0, 6000),
      transcript,
      patch: Object.assign({}, ...operationsPayload.map((op) => op.fields)) as Patch,
      general,
      generalReason: operationsPayload.find((op) => op.generalReason)?.generalReason,
      affectedScenarioIds: [...new Set(opPlans.flatMap((p) => p.impact.map((s) => s.id)))],
      status: allGeneral ? 'pending_review' : 'previewed',
      createdAt: now,
      updatedAt: now,
      subject: operations[0].subject,
      resourceName: operations[0].resourceName,
      scope: allGeneral ? 'general' : (operationsPayload.find((op) => op.scope === 'copy-on-write') ? 'copy-on-write' : 'direct'),
      scopeReason: operationsPayload.find((op) => op.scopeReason)?.scopeReason,
      impactScenarios: opPlans.flatMap((p) => p.impact),
      plan: {
        scope: allGeneral ? 'general' : 'direct',
        reason: operationsPayload.find((op) => op.scopeReason)?.scopeReason,
        operations: planOperations,
      },
      personaPatch: operations[0].persona && Object.keys(operations[0].persona).length ? operations[0].persona : undefined,
      skillPointNames: operations[0].skillPointNames,
      scoreItemNames: operations[0].scoreItemNames,
      drillScriptName: operations[0].drillScriptName,
      diagnoses: opPlans.flatMap((plan) => plan.diagnosis ? [plan.diagnosis] : []),
    };
    await store.saveVoiceEditCommand(command);

    return {
      transcript,
      reply: parsed.reply ?? '已生成配置预览',
      operations: operationsPayload,
      general,
      hasPrivate: !allGeneral,
      commandId: command.id,
      expectedRevisions,
    };
  });

  app.get<{ Querystring: { general?: string } }>('/library/voice-config/logs', async (request) => {
    const general = request.query.general === undefined ? undefined : request.query.general === '1';
    const items = await store.listVoiceEditCommands({
      tenantId: request.tenantId,
      userId: isAdmin(request.userRole) ? undefined : request.userId,
      general,
    });
    return { items };
  });

  app.patch<{ Params: { id: string }; Body: { status?: VoiceEditCommand['status']; reviewNote?: string } }>(
    '/library/voice-config/logs/:id',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const command = await store.getVoiceEditCommand(request.params.id);
      if (!command || command.tenantId !== request.tenantId) return reply.code(404).send({ error: '命令不存在' });
      const status = request.body?.status;
      if (status && !['pending_review', 'in_review', 'resolved', 'rejected'].includes(status)) return reply.code(400).send({ error: '处理状态无效' });
      const updated: VoiceEditCommand = {
        ...command,
        status: status ?? command.status,
        reviewNote: request.body?.reviewNote ?? command.reviewNote,
        reviewedBy: request.userId,
        updatedAt: new Date().toISOString(),
      };
      await store.saveVoiceEditCommand(updated);
      return updated;
    }
  );

  /* ---------------- 实时语音识别通道（WebSocket） ---------------- */
  // 语音配置边说边识别：客户端持续发送 PCM16 二进制帧，服务端实时下发 asr_partial，
  // stop 时下发 asr_final。与 asr-stream（新手指引）同一套协议，但不依赖会话。
  app.get<{ Querystring: { token?: string } }>(
    '/library/voice-config/asr-stream',
    { websocket: true },
    async (socket, req) => {
      const token = req.query.token;
      const payload = token ? verifyToken(token) : null;
      if (!payload) {
        req.log.warn(
          {
            hasToken: !!token,
            tokenFailReason: token ? tokenFailReason(token) : '缺少 token',
          },
          'voice-config asr-stream WS 鉴权失败，关闭连接（4401）'
        );
        socket.close(4401, '未登录或登录已过期');
        return;
      }
      req.log.info({ userId: payload.userId, provider: speech.asr.name }, 'voice-config asr-stream WS 已建立');

      // 每连接只允许一轮未完成的识别：round 单调递增，过期轮次回调一律丢弃
      let round = 0;
      let asrStream: ASRStream | null = null;
      let latestText = '';
      let latestIsFinal = false;
      let finishRequested = false;

      const send = (msg: Record<string, unknown>) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      };

      const closeStream = () => {
        if (asrStream) {
          asrStream.close();
          asrStream = null;
        }
      };

      const complete = (myRound: number) => {
        if (myRound !== round) return;
        send({ type: 'asr_final', text: latestText });
        finishRequested = false;
        closeStream();
      };

      const startRound = () => {
        round++;
        const myRound = round;
        closeStream();
        latestText = '';
        latestIsFinal = false;
        finishRequested = false;
        asrStream = speech.asr.createStream({
          onPartial: (text) => {
            if (myRound !== round) return;
            latestText = text;
            latestIsFinal = false;
            send({ type: 'asr_partial', text });
          },
          // paraformer 句末会多次回调（累计文本）：实时刷新字幕，finish 后才出 asr_final
          onFinal: (text) => {
            if (myRound !== round) return;
            latestText = text;
            latestIsFinal = true;
            send({ type: 'asr_partial', text });
            if (finishRequested) complete(myRound);
          },
          onFinished: () => {
            if (myRound === round && finishRequested) complete(myRound);
          },
          onError: (err) => {
            if (myRound !== round) return;
            req.log.warn({ err: err.message, provider: speech.asr.name }, 'voice-config asr-stream ASR 流错误');
            send({ type: 'error', message: `ASR：${err.message}` });
          },
        });
      };

      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          // 首个音频帧自动开轮（未显式发 start 也能识别）
          if (!asrStream) startRound();
          asrStream?.write(data);
          return;
        }
        let msg: { type?: string };
        try {
          msg = JSON.parse(data.toString());
        } catch {
          send({ type: 'error', message: '无法解析的消息（期望 JSON 文本帧或二进制音频帧）' });
          return;
        }
        switch (msg.type) {
          case 'start':
            startRound();
            break;
          case 'finish':
            finishRequested = true;
            if (!asrStream) {
              finishRequested = false;
              send({ type: 'asr_final', text: latestText });
            } else if (latestIsFinal) {
              complete(round);
            } else {
              asrStream.finish();
            }
            break;
          case 'cancel':
            round++;
            finishRequested = false;
            closeStream();
            break;
          default:
            send({ type: 'error', message: `未知消息类型: ${msg.type ?? '(空)'}` });
        }
      });

      socket.on('close', () => {
        req.log.info({ userId: payload.userId }, 'voice-config asr-stream WS 关闭');
        round++;
        closeStream();
      });
      socket.on('error', (err: Error) => {
        req.log.warn({ err: err.message }, 'voice-config asr-stream WS 错误');
        round++;
        closeStream();
      });
    }
  );
}

/** 事务式执行计划：按顺序执行，任一步失败抛错（调用方返回 400） */
async function executePlan(
  store: Store,
  operations: VoiceConfigOperation[],
  context: CommandContext,
  tenantId: string,
  userId: string
): Promise<Record<string, unknown>> {
  const ids: Record<string, string> = {};
  const results: Record<string, unknown> = {};

  for (const op of operations) {
    switch (op.kind) {
      case 'create-persona': {
        const payload = { ...(op.patch as Patch) };
        const persona: PersonaConfig = {
          id: randomUUID(),
          tenantId,
          name: String(payload.name ?? op.name ?? '客户'),
          background: personaBackground(payload),
          elementIds: (payload.elementIds as string[]) ?? [],
          behaviorBands: (payload.behaviorBands as PersonaConfig['behaviorBands']) ?? [],
          knowledgeBoundary: (payload.knowledgeBoundary as PersonaConfig['knowledgeBoundary']) ?? { mustNotKnow: [], loadedKnowledge: [] },
          version: 1,
          createdBy: userId,
          updatedBy: userId,
        };
        // 计划补丁中的展示字段一并落库，避免只建出「有背景没属性」的空角色
        for (const key of ['name', 'occupation', 'industry', 'personalityTags', 'objections', 'hiddenInfo', 'decisionStyle', 'voiceProfile', 'avatar'] as const) {
          const value = (payload as Record<string, unknown>)[key];
          if (value !== undefined) (persona as unknown as Record<string, unknown>)[key] = value;
        }
        persona.background = personaBackground(persona);
        await store.savePersonaConfig(persona);
        if (op.key) ids[op.key] = persona.id;
        results.persona = { id: persona.id, name: persona.name };
        break;
      }
      case 'update-persona':
      case 'copy-persona': {
        const current = await store.getPersonaConfig(op.id!);
        if (!current || current.tenantId !== tenantId) throw new Error('角色不存在或跨租户');
        const patch = op.patch as Patch;
        const merged: PersonaConfig = {
          ...current,
          ...patch,
          behaviorBands: (patch.behaviorBands as PersonaConfig['behaviorBands']) ?? current.behaviorBands,
          knowledgeBoundary: (patch.knowledgeBoundary as PersonaConfig['knowledgeBoundary']) ?? current.knowledgeBoundary,
          id: op.kind === 'copy-persona' ? randomUUID() : current.id,
          version: op.kind === 'copy-persona' ? 1 : (current.version ?? 0) + 1,
          createdBy: op.kind === 'copy-persona' ? userId : current.createdBy,
          updatedBy: userId,
        };
        if (backgroundKeysPresent(patch)) merged.background = personaBackground(merged);
        await store.savePersonaConfig(merged);
        if (op.key) ids[op.key] = merged.id;
        results.persona = { id: merged.id, name: merged.name };
        break;
      }
      case 'create-scenario': {
        const personaId = op.ref ? ids[op.ref] : undefined;
        const patch = resolveRefs(op.patch, ids) as Patch;
        const scenario: Scenario = {
          id: randomUUID(),
          tenantId,
          name: String(patch.name ?? '未命名场景'),
          personaConfigId: String(personaId ?? patch.personaConfigId ?? ''),
          skillPointIds: (patch.skillPointIds as string[]) ?? [],
          scoreItemIds: (patch.scoreItemIds as string[]) ?? [],
          successCriteria: (patch.successCriteria as Scenario['successCriteria']) ?? { passScore: 60 },
          durationMinutes: Number(patch.durationMinutes ?? 10),
          difficulty: Number(patch.difficulty ?? 1),
          category: patch.category as Scenario['category'],
          flowType: (patch.flowType as Scenario['flowType']) ?? 'generic',
          sceneType: (patch.sceneType as Scenario['sceneType']) ?? 'practical',
          status: (patch.status as Scenario['status']) ?? 'draft',
          description: patch.description as string | undefined,
          methodology: patch.methodology as string | undefined,
          source: (patch.source as string) ?? '自建',
          productKBId: patch.productKBId as string | undefined,
          drillScriptId: patch.drillScriptId as string | undefined,
          coverageTopics: patch.coverageTopics as string[] | undefined,
          script: patch.script as Scenario['script'],
          participants: patch.participants as ScenarioParticipant[] | undefined,
          conversation: patch.conversation as Scenario['conversation'],
          version: 1,
          createdBy: userId,
          updatedBy: userId,
        };
        const error = validateScenarioDraft(scenario, { skillPointIds: scenario.skillPointIds ?? [], scoreItemIds: scenario.scoreItemIds ?? [] });
        if (error) throw new Error(error);
        await store.saveScenario(scenario);
        if (op.key) ids[op.key] = scenario.id;
        results.scenario = { id: scenario.id, name: scenario.name };
        break;
      }
      case 'update-scenario': {
        const current = await store.getScenario(op.id!);
        if (!current || current.tenantId !== tenantId) throw new Error('场景不存在或跨租户');
        // 乐观锁：即使调用方没传 expectedRevisions，也按预览时的版本复核
        if (op.expectedVersion !== undefined && (current.version ?? 1) !== op.expectedVersion) {
          throw new Error('资源已被其他用户修改，请重新生成预览');
        }
        const patch = resolveRefs(op.patch, ids) as Patch;
        const next: Scenario = { ...current };
        for (const [key, value] of Object.entries(patch)) {
          if (key === 'name' || key === 'description' || key === 'methodology' || key === 'source' || key === 'productKBId' || key === 'drillScriptId') {
            if (value === '' || value === null) delete (next as any)[key];
            else (next as any)[key] = value;
          } else if (value === undefined) {
            delete (next as any)[key];
          } else {
            (next as any)[key] = value;
          }
        }
        if (patch.personaConfigId !== undefined) next.personaConfigId = String(patch.personaConfigId);
        if (op.rebind) {
          const newId = ids[op.rebind.ref];
          if (!newId) throw new Error('重绑引用无效');
          if (op.rebind.mode === 'single') {
            (next as any)[op.rebind.field] = newId;
          } else {
            const list = ((next as any)[op.rebind.field] as string[]) ?? [];
            if (list.includes(op.rebind.oldId)) {
              (next as any)[op.rebind.field] = list.map((id) => (id === op.rebind!.oldId ? newId : id));
            } else {
              (next as any)[op.rebind.field] = [...list, newId];
            }
          }
        }
        next.version = (current.version ?? 0) + 1;
        next.updatedBy = userId;
        const error = validateScenarioDraft(next, {
          skillPointIds: next.skillPointIds ?? [],
          scoreItemIds: next.scoreItemIds ?? [],
        });
        if (error) throw new Error(error);
        await store.saveScenario(next);
        if (op.key) ids[op.key] = next.id;
        results.scenario = { id: next.id, name: next.name };
        break;
      }
      case 'create-resource':
      case 'update-resource':
      case 'copy-resource': {
        const target = op.target as Target;
        if (!TARGETS.includes(target)) throw new Error('资源类型无效');
        const clean = resolveRefs(op.patch, ids) as Patch;
        const current = op.id ? await getResource(store, target, op.id, tenantId) : undefined;
        if ((op.kind === 'update-resource' || op.kind === 'copy-resource') && !current) throw new Error('资源不存在或跨租户');
        if (op.kind === 'copy-resource') {
          const copy = { ...(current as any), ...clean, id: randomUUID(), tenantId, createdBy: userId, updatedBy: userId };
          const item = await applyResource(store, target, undefined, copy as Patch, tenantId, userId);
          const id = (item as any).id;
          if (op.key) ids[op.key] = id;
          results.resource = { id, name: (item as any).name };
        } else {
          const item = await applyResource(store, target, op.id, clean, tenantId, userId);
          const id = (item as any).id ?? op.id!;
          if (op.key) ids[op.key] = id;
          results.resource = { id, name: (item as any).name };
        }
        break;
      }
      default:
        throw new Error(`不支持的执行操作：${(op as VoiceConfigOperation).kind}`);
    }
  }
  return results;
}
