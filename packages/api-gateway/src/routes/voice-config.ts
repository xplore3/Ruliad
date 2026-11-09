import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  ChatMessage,
  PersonaConfig,
  Scenario,
  ScenarioParticipant,
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
  action: 'create' | 'update';
  subject: string;
  resourceName?: string;
  fields: Patch;
  persona?: Patch;
  skillPointNames?: string[];
  scoreItemNames?: string[];
  drillScriptName?: string;
  conversation?: Patch;
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
  const exact = all.find((item) => normalize(nameOf(target, item)) === q);
  if (exact) return exact;
  return all.find((item) => matchesName(nameOf(target, item), q));
}

/** 对象名称与用户描述是否匹配（忽略大小写/空白，支持包含关系） */
function matchesName(name: string, q: string): boolean {
  const n = normalize(name);
  return !!n && (n === q || n.includes(q) || q.includes(n));
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
  if (args.general) return { scope: 'general', reason: args.generalReason };
  if (args.admin) return { scope: 'direct' };
  if (args.action === 'create') return { scope: 'direct' };
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
  if (args.target === 'product-kb' || args.target === 'scenario-guidance') {
    return { scope: 'general', reason: '公共知识库/场景指引属于共享资源，已转为通用建议' };
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

    const names = await availableNames(store, request.tenantId);
    const prompt = [
      '你是销售陪练系统的「语音自动场景创建和配置」助手。用户用自然语言描述要创建或修改的场景、场景配置或资源库对象。',
      '',
      '【第一步：判断操作对象】',
      `- target 只能是：${TARGETS.join(' / ')}`,
      '  scenario=对练场景；persona=陪练角色；skill-point=技能点；element=角色要素；product-kb=产品知识库；',
      '  demo-faq=示范问答；demo-script=示范剧本；drill-script=演练剧本；score-item=评分标准；golden-case=评分回归案例；',
      '  briefing-standard=讲解标准；realism-standard=演练真实度标准；scenario-guidance=场景指引配置。',
      '- action = create 或 update。',
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
      '【第三步：通用性判断】',
      '若涉及跨场景规则、公共产品事实、合规规范、通用提示词/评分规则/系统能力，或要修改被多个场景共用的资源：general=true 并给出 generalReason。',
      '',
      '【第四步：混合指令拆分】',
      '若一条指令同时包含「私有/场景专属」与「通用」两部分，返回多个 operations，每部分一条；通用部分 general=true。',
      '',
      `【当前租户可用资源】${JSON.stringify(names)}`,
      context.scenarioId ? `【当前正在编辑的场景 ID】${context.scenarioId}` : '',
      context.form ? `【当前编辑表单快照（供理解，不是数据库）】${JSON.stringify(context.form)}` : '',
      '',
      '严格返回 JSON（不要输出多余文字）：',
      '{"reply":"一句话中文摘要","operations":[{"target":"scenario","action":"update","subject":"首次电话邀约","resourceName":"","fields":{},"persona":{},"skillPointNames":[],"scoreItemNames":[],"drillScriptName":"","conversation":{},"general":false,"generalReason":""}]}',
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
    if (rawOperations.length === 0) return reply.code(422).send({ error: '没有识别到操作内容，请换个说法重试' });

    const operations: ParsedOperation[] = [];
    for (const raw of rawOperations) {
      const target = raw.target as Target;
      if (!target || !TARGETS.includes(target)) {
        return reply.code(422).send({ error: `无法识别的操作对象类型：${String(raw.target ?? '')}` });
      }
      operations.push({
        target,
        action: raw.action === 'create' ? 'create' : 'update',
        subject: String(raw.subject ?? ''),
        resourceName: raw.resourceName ? String(raw.resourceName) : undefined,
        fields: (raw.fields ?? {}) as Patch,
        persona: (raw.persona ?? {}) as Patch,
        skillPointNames: Array.isArray(raw.skillPointNames) ? raw.skillPointNames : undefined,
        scoreItemNames: Array.isArray(raw.scoreItemNames) ? raw.scoreItemNames : undefined,
        drillScriptName: raw.drillScriptName ? String(raw.drillScriptName) : undefined,
        conversation: (raw.conversation ?? {}) as Patch,
        general: raw.general === true,
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
      const current = (await locateResource(store, request.tenantId, op.target, op.action, op.subject, context)) as any;
      if (op.action === 'update' && !current) {
        return reply.code(404).send({ error: `未找到要修改的对象：${op.subject || RESOURCE_DEFS[op.target].label}。请说明名称，或改用新建。` });
      }
      const impact = await affectedScenarios(store, op.target, current, request.tenantId);
      const scopeDecision = decideScope({
        admin,
        userId: request.userId,
        target: op.target,
        action: op.action,
        current,
        affected: impact,
        hasContextScenario: Boolean(contextScenario),
        general: op.general,
        generalReason: op.generalReason,
      });
      if (current) expectedRevisions[current.id] = revisionOf(current);

      // 通用/共享内容：只记录，不修改业务数据
      if (scopeDecision.scope === 'general') {
        const generalOp: VoiceConfigOperation = {
          key: `op-${opIndex}`,
          kind: op.target === 'scenario' ? (op.action === 'create' ? 'create-scenario' : 'update-scenario') : 'update-resource',
          target: op.target,
          id: current?.id,
          name: op.resourceName,
          patch: jsonSafe(op.fields) as Patch,
          general: true,
          generalReason: scopeDecision.reason,
        };
        planOperations.push(generalOp);
        opPlans.push({ op, scope: 'general', scopeReason: scopeDecision.reason, primary: generalOp, impact, resolvedResourceId: current?.id });
        continue;
      }

      if (op.target === 'scenario') {
        const { patch, bindings, bindingsProvided } = await buildScenarioPatch(store, request.tenantId, op.fields);
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
          if (bindingsProvided || !bindings.skillPointIds.length) {
            scenarioPatch.skillPointIds = bindings.skillPointIds;
            scenarioPatch.scoreItemIds = bindings.scoreItemIds;
          }
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
            scenarioPatch.skillPointIds = bindings.skillPointIds;
            scenarioPatch.scoreItemIds = bindings.scoreItemIds;
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
      let clean: Patch;
      try { clean = cleanPatch(op.target, op.fields); } catch (error) {
        return reply.code(422).send({ error: error instanceof Error ? error.message : '提取结果无效' });
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
        if (binding && contextScenario) {
          planOperations.push({
            kind: 'update-scenario',
            target: 'scenario',
            id: contextScenario.id,
            expectedVersion: contextScenario.version ?? 1,
            patch: {},
            rebind: { field: binding.field, mode: binding.mode, oldId: current.id, ref: copyKey },
          });
        }
        opPlans.push({ op, scope: 'copy-on-write', scopeReason: scopeDecision.reason, primary: copyOp, impact, resolvedResourceId: current.id });
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
        opPlans.push({ op, scope: 'direct', scopeReason: scopeDecision.reason, primary: resourceOp, impact, resolvedResourceId: current?.id });
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
      general: plan.op.general === true,
      generalReason: plan.op.generalReason,
      planKind: plan.primary.kind,
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
      action: operations[0].action,
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
          if (value !== undefined) (persona as Record<string, unknown>)[key] = value;
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
