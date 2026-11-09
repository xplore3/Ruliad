import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  BriefingStandard,
  DemoFaq,
  DemoScript,
  DrillScript,
  Element,
  GoldenCase,
  PersonaConfig,
  ProductKB,
  RealismStandard,
  Scenario,
  ScenarioGuidance,
  ScoreItemDef,
  SkillPoint,
  VoiceEditCommand,
} from '@grasp-mvp/core';
import { SCORE_CATEGORIES } from '@grasp-mvp/core';
import type { Store } from '@grasp-mvp/infra';
import type { RouteContext } from '../ctx.js';
import { requireRoles } from '../auth.js';

export const TARGETS = [
  'scenario', 'persona', 'skill-point', 'element', 'product-kb', 'demo-faq', 'demo-script',
  'drill-script', 'score-item', 'golden-case', 'briefing-standard', 'realism-standard', 'scenario-guidance',
] as const;
export type Target = (typeof TARGETS)[number];
export type Patch = Record<string, unknown>;

export const RESOURCE_DEFS: Record<Target, { label: string; fields: string[]; schema: string }> = {
  scenario: {
    label: '对练场景',
    fields: ['name', 'category', 'flowType', 'description', 'personaConfigId', 'skillPointIds', 'scoreItemIds', 'passScore', 'durationMinutes', 'difficulty', 'coverageTopics', 'productKBId', 'drillScriptId', 'methodology', 'source', 'sceneType', 'script', 'participants', 'conversation', 'status'],
    schema: 'name/category/flowType/description/methodology/source/sceneType/status 为字符串；category=地推|电销|咨询接待|现场成交，flowType=generic|ground_push|reception，sceneType=drill|practical，status=draft|published；personaConfigId/productKBId/drillScriptId 为资源 ID；skillPointIds/scoreItemIds/coverageTopics 为字符串数组；passScore/durationMinutes/difficulty 为数字；script/participants/conversation 为对象。',
  },
  persona: {
    label: '陪练角色',
    fields: ['name', 'background', 'age', 'occupation', 'industry', 'personalityTags', 'decisionStyle', 'objections', 'hiddenInfo', 'elementIds', 'productKBId', 'behaviorBands', 'knowledgeBoundary', 'voiceProfile', 'avatar'],
    schema: 'name/background/occupation/industry/decisionStyle/avatar 为字符串；age 为正数；personalityTags/objections/hiddenInfo/elementIds 为字符串数组；behaviorBands/knowledgeBoundary/voiceProfile 按当前结构修改。',
  },
  'skill-point': { label: '技能点', fields: ['name', 'description', 'assetName', 'author', 'source', 'locked'], schema: 'name 必填；description/assetName/author/source 为字符串；locked 为布尔。' },
  element: { label: '角色要素', fields: ['name', 'type', 'content', 'dynamics'], schema: 'name/content 必填；type=C|E|B|S；dynamics 为情绪动力学对象或 null。' },
  'product-kb': { label: '产品知识库', fields: ['name', 'entries'], schema: 'name 必填；entries 为数组，每项 id/kind/title/content/frequency，kind=keypoint|redline|competitor|faq。修改、删除或新增条目都在 entries 中完整表达。' },
  'demo-faq': { label: '示范问答', fields: ['category', 'question', 'referenceAnswer', 'difficulty', 'skillPointIds', 'frequency'], schema: 'category/question 必填；referenceAnswer 字符串；difficulty 1-3；skillPointIds 字符串数组；frequency 数字。' },
  'demo-script': { label: '示范剧本', fields: ['category', 'name', 'lines', 'variables', 'faqPick', 'faqPoolRef'], schema: 'category/name 必填；lines 为 {role:sales|customer|child|narrator,text,arousal?,excitement?,soft?} 数组；variables/faqPick/faqPoolRef 按当前结构。' },
  'drill-script': { label: '演练剧本', fields: ['category', 'name', 'content'], schema: 'category=地推|电销|咨询接待|现场成交；name/content 必填。' },
  'score-item': {
    label: '评分标准',
    fields: ['skillPointId', 'name', 'behaviorAnchor', 'judgePrompt', 'weight', 'levels', 'layer', 'isObservation', 'category', 'scoringMode', 'deductionOnly', 'quantitativeRule', 'voiceChannel'],
    schema: 'skillPointId/name 必填；weight 数字；levels 为档位数组；layer=company|team|personal；category=地推|电销|咨询接待|现场成交；scoringMode=levels|score；isObservation/deductionOnly 布尔；quantitativeRule/voiceChannel 按当前结构。',
  },
  'golden-case': { label: '评分回归案例', fields: ['name', 'transcript', 'expected'], schema: 'name/transcript/expected 必填；transcript 为 {seq,speaker:trainee|persona,text} 数组；expected 为 {itemId,levelKey} 数组。' },
  'briefing-standard': { label: '讲解标准', fields: ['name', 'category', 'description', 'example'], schema: 'name/category/description 必填；example 可选字符串。' },
  'realism-standard': { label: '演练真实度标准', fields: ['name', 'category', 'description'], schema: 'name/category/description 必填。' },
  'scenario-guidance': {
    label: '场景指引',
    fields: ['scenarioId', 'name', 'qualifyQuestions', 'demoScriptId', 'keyPoints', 'briefingStandardIds', 'realismStandardIds', 'difficultyLevels', 'defaultDifficulty', 'duration', 'liveIntro', 'voiceProfile', 'scoringFocus'],
    schema: 'scenarioId/name 必填；qualifyQuestions/keyPoints/briefingStandardIds/realismStandardIds/scoringFocus 为字符串数组；demoScriptId 可为 null；duration/liveIntro/voiceProfile/difficultyLevels 按当前结构。',
  },
};

export function revisionOf(item: unknown): string {
  return createHash('sha256').update(JSON.stringify(item ?? null)).digest('hex');
}

export function nameOf(target: Target, item: unknown): string {
  const value = item as { name?: string; question?: string; scenarioId?: string } | null;
  return value?.name ?? value?.question ?? (target === 'scenario-guidance' ? value?.scenarioId : undefined) ?? '';
}

export async function getResource(store: Store, target: Target, id: string | undefined, tenantId: string): Promise<unknown | undefined> {
  if (!id) return undefined;
  let item: any;
  switch (target) {
    case 'scenario': item = await store.getScenario(id); break;
    case 'persona': item = await store.getPersonaConfig(id); break;
    case 'skill-point': item = await store.getSkillPoint(id); break;
    case 'element': item = await store.getElement(id); break;
    case 'product-kb': item = id === 'default' ? await store.getProductKB(tenantId) : await store.getProductKBById(id); break;
    case 'demo-faq': item = await store.getDemoFaq(id); break;
    case 'demo-script': item = await store.getDemoScript(id); break;
    case 'drill-script': item = await store.getDrillScript(id); break;
    case 'score-item': item = (await store.listScoreItemDefs(tenantId)).find((entry) => entry.id === id); break;
    case 'golden-case': item = (await store.listGoldenCases(tenantId)).find((entry) => entry.id === id); break;
    case 'briefing-standard': item = (await store.listBriefingStandards(tenantId)).find((entry) => entry.id === id); break;
    case 'realism-standard': item = (await store.listRealismStandards(tenantId)).find((entry) => entry.id === id); break;
    case 'scenario-guidance': item = await store.getScenarioGuidanceById(id); break;
  }
  if (!item || (item.tenantId !== tenantId && !(target === 'golden-case' && !item.tenantId))) return undefined;
  return item;
}

export async function listResources(store: Store, target: Target, tenantId: string): Promise<unknown[]> {
  switch (target) {
    case 'scenario': return store.listScenarios(tenantId);
    case 'persona': return store.listPersonaConfigs(tenantId);
    case 'skill-point': return store.listSkillPoints(tenantId);
    case 'element': return store.listElements({ tenantId });
    case 'product-kb': { const kb = await store.getProductKB(tenantId); return kb ? [kb] : []; }
    case 'demo-faq': return store.listDemoFaqs(tenantId);
    case 'demo-script': return store.listDemoScripts(tenantId);
    case 'drill-script': return store.listDrillScripts(tenantId);
    case 'score-item': return store.listScoreItemDefs(tenantId);
    case 'golden-case': return store.listGoldenCases(tenantId);
    case 'briefing-standard': return store.listBriefingStandards(tenantId);
    case 'realism-standard': return store.listRealismStandards(tenantId);
    case 'scenario-guidance': return store.listScenarioGuidances(tenantId);
  }
}

export function cleanPatch(target: Target, patch: Patch): Patch {
  const allowed = new Set(RESOURCE_DEFS[target].fields);
  const clean: Patch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) throw new Error(`不支持的字段: ${key}`);
    clean[key] = value;
  }
  if (Object.keys(clean).length === 0) throw new Error('没有可应用的修改');
  return clean;
}

export async function validateReferences(store: Store, target: Target, item: any, tenantId: string): Promise<string | null> {
  if (target === 'scenario') {
    if (!item.name?.trim() || !item.personaConfigId || !item.skillPointIds?.length) return '场景名称、角色和技能点必填';
    if (!SCORE_CATEGORIES.includes(item.category)) return '场景分类无效';
    if (!Number.isFinite(item.successCriteria?.passScore) || item.successCriteria.passScore < 0 || item.successCriteria.passScore > 100) return '及格分必须为 0-100';
    if (!Number.isFinite(item.durationMinutes) || item.durationMinutes < 1 || item.durationMinutes > 60) return '时长必须为 1-60 分钟';
    if (item.status === 'published' && !item.scoreItemIds?.length) return '发布场景至少绑定一条评分标准';
    const persona = await store.getPersonaConfig(item.personaConfigId);
    if (!persona || persona.tenantId !== tenantId) return '角色不存在或跨租户';
    for (const id of item.skillPointIds) {
      const skill = await store.getSkillPoint(id);
      if (!skill || skill.tenantId !== tenantId) return '技能点不存在或跨租户';
    }
    const scoreItems = await store.listScoreItemDefs(tenantId);
    for (const id of item.scoreItemIds ?? []) {
      const score = scoreItems.find((entry) => entry.id === id);
      if (!score || (score.category && score.category !== item.category)) return '评分标准不存在、跨租户或分类不一致';
    }
    if (item.drillScriptId) {
      const script = await store.getDrillScript(item.drillScriptId);
      if (!script || script.tenantId !== tenantId || script.category !== item.category) return '演练剧本不存在、跨租户或分类不一致';
    }
    if (item.productKBId) {
      const kb = await store.getProductKBById(item.productKBId);
      if (!kb || kb.tenantId !== tenantId) return '知识库不存在或跨租户';
    }
  }
  if (target === 'persona') {
    if (!item.name?.trim() || !item.background?.trim() || !item.behaviorBands?.length) return '角色姓名、背景、行为档位必填';
    for (const id of item.elementIds ?? []) {
      const element = await store.getElement(id);
      if (!element || (element.tenantId !== undefined && element.tenantId !== tenantId)) return '角色要素不存在或跨租户';
    }
    if (item.productKBId) {
      const kb = await store.getProductKBById(item.productKBId);
      if (!kb || kb.tenantId !== tenantId) return '知识库不存在或跨租户';
    }
  }
  if (target === 'score-item') {
    const skill = await store.getSkillPoint(item.skillPointId);
    if (!skill || skill.tenantId !== tenantId) return '评分标准技能点不存在或跨租户';
  }
  if (target === 'scenario-guidance') {
    const scenario = await store.getScenario(item.scenarioId);
    if (!scenario || scenario.tenantId !== tenantId) return '指引绑定场景不存在或跨租户';
    if (item.demoScriptId) {
      const script = await store.getDemoScript(item.demoScriptId);
      if (!script || script.tenantId !== tenantId) return '示范剧本不存在或跨租户';
    }
    const briefing = await store.listBriefingStandards(tenantId);
    const realism = await store.listRealismStandards(tenantId);
    if ((item.briefingStandardIds ?? []).some((id: string) => !briefing.some((entry) => entry.id === id))) return '讲解标准引用无效';
    if ((item.realismStandardIds ?? []).some((id: string) => !realism.some((entry) => entry.id === id))) return '真实度标准引用无效';
  }
  return null;
}

export function validateRequired(target: Target, item: any): string | null {
  if (target === 'skill-point' && !item.name?.trim()) return '技能点名称必填';
  if (target === 'element' && (!item.name?.trim() || !item.content?.trim() || !['C', 'E', 'B', 'S'].includes(item.type))) return '要素名称、正文、类型无效';
  if (target === 'product-kb' && (!item.name?.trim() || !Array.isArray(item.entries))) return '知识库名称和条目必填';
  if (target === 'demo-faq' && (!item.category?.trim() || !item.question?.trim())) return '示范问答分类和问题必填';
  if (target === 'demo-script' && (!item.category?.trim() || !item.name?.trim() || !item.lines?.length)) return '示范剧本分类、名称、台词必填';
  if (target === 'drill-script' && (!item.name?.trim() || !item.content?.trim() || !SCORE_CATEGORIES.includes(item.category))) return '演练剧本分类、名称、内容无效';
  if (target === 'score-item' && (!item.name?.trim() || !item.skillPointId || (item.scoringMode !== 'score' && !item.levels?.length))) return '评分标准名称、技能点、档位必填';
  if (target === 'golden-case' && (!item.name?.trim() || !item.transcript?.length || !item.expected?.length)) return '回归案例名称、对话、期望判定必填';
  if ((target === 'briefing-standard' || target === 'realism-standard') && (!item.name?.trim() || !item.category?.trim() || !item.description?.trim())) return '标准名称、分类、说明必填';
  if (target === 'scenario-guidance' && (!item.name?.trim() || !item.scenarioId || !Array.isArray(item.qualifyQuestions))) return '指引名称、绑定场景、资格问题数组必填';
  return null;
}

export async function applyResource(store: Store, target: Target, id: string | undefined, patch: Patch, tenantId: string, userId: string): Promise<unknown> {
  const current = await getResource(store, target, id, tenantId) as any;
  const item: any = {
    ...(current ?? {}),
    ...patch,
    id: current?.id ?? randomUUID(),
    tenantId: current ? current.tenantId : tenantId,
    createdBy: current?.createdBy ?? userId,
    updatedBy: userId,
  };
  const requiredError = validateRequired(target, item);
  if (requiredError) throw new Error(requiredError);
  const referenceError = await validateReferences(store, target, item, tenantId);
  if (referenceError) throw new Error(referenceError);

  switch (target) {
    case 'scenario': {
      const passScore = item.passScore ?? item.successCriteria?.passScore;
      delete item.passScore;
      item.successCriteria = { passScore };
      item.version = (current?.version ?? 0) + 1;
      item.status = item.status ?? 'draft';
      item.sceneType = item.sceneType ?? 'practical';
      item.flowType = item.flowType ?? 'generic';
      item.difficulty = item.difficulty ?? 1;
      item.scoreItemIds = item.scoreItemIds ?? [];
      item.createdBy = current?.createdBy ?? userId;
      item.updatedBy = userId;
      await store.saveScenario(item as Scenario);
      return item;
    }
    case 'persona':
      item.version = (current?.version ?? 0) + 1;
      item.elementIds = item.elementIds ?? [];
      item.knowledgeBoundary = item.knowledgeBoundary ?? { mustNotKnow: [], loadedKnowledge: [] };
      await store.savePersonaConfig(item as PersonaConfig);
      return item;
    case 'skill-point': await store.saveSkillPoint(item as SkillPoint); return item;
    case 'element':
      item.layer = current?.layer ?? 'tenant';
      item.version = (current?.version ?? 0) + 1;
      await store.saveElement(item as Element);
      return item;
    case 'product-kb': {
      const existingDefault = await store.getProductKB(tenantId);
      if (!current && existingDefault) throw new Error('机构知识库已存在，请编辑现有记录');
      item.id = current?.id ?? existingDefault?.id ?? item.id;
      item.version = (current?.version ?? existingDefault?.version ?? 0) + 1;
      item.effectiveAt = new Date().toISOString();
      await store.saveProductKB(item as ProductKB);
      return item;
    }
    case 'demo-faq': await store.saveDemoFaq(item as DemoFaq); return item;
    case 'demo-script': await store.saveDemoScript(item as DemoScript); return item;
    case 'drill-script': await store.saveDrillScript(item as DrillScript); return item;
    case 'score-item':
      item.weight = item.weight ?? 1;
      item.layer = item.layer ?? 'company';
      item.isObservation = item.isObservation ?? false;
      item.levels = item.levels ?? [];
      await store.upsertScoreItemDef(item as ScoreItemDef);
      return item;
    case 'golden-case': await store.saveGoldenCase(item as GoldenCase); return item;
    case 'briefing-standard': await store.saveBriefingStandard(item as BriefingStandard); return item;
    case 'realism-standard': await store.saveRealismStandard(item as RealismStandard); return item;
    case 'scenario-guidance': {
      item.demoScriptId = item.demoScriptId ?? null;
      item.keyPoints = item.keyPoints ?? [];
      item.briefingStandardIds = item.briefingStandardIds ?? [];
      item.realismStandardIds = item.realismStandardIds ?? [];
      item.difficultyLevels = item.difficultyLevels ?? [];
      item.defaultDifficulty = item.defaultDifficulty ?? 1;
      item.scoringFocus = item.scoringFocus ?? [];
      item.duration = item.duration ?? { targetMinutes: 10, countdownSeconds: 600 };
      item.liveIntro = item.liveIntro ?? { narration: '', goal: '' };
      item.voiceProfile = item.voiceProfile ?? { style: '', arousal: 0.5 };
      const existing = await store.getScenarioGuidance(item.scenarioId);
      if (existing && existing.id !== item.id) throw new Error('该场景已有指引配置');
      await store.saveScenarioGuidance(item as ScenarioGuidance);
      return item;
    }
  }
}

export async function affectedScenarios(store: Store, target: Target, current: any, tenantId: string): Promise<Array<{ id: string; name: string }>> {
  if (!current) return [];
  const scenarios = await store.listScenarios(tenantId);
  let affected = scenarios;
  if (target === 'scenario') affected = scenarios.filter((item) => item.id === current.id);
  else if (target === 'persona') affected = scenarios.filter((item) => item.personaConfigId === current.id);
  else if (target === 'drill-script') affected = scenarios.filter((item) => item.drillScriptId === current.id);
  else if (target === 'score-item') affected = scenarios.filter((item) => item.scoreItemIds?.includes(current.id));
  else if (target === 'product-kb') affected = scenarios.filter((item) => item.productKBId === current.id);
  else if (target === 'scenario-guidance') affected = scenarios.filter((item) => item.id === current.scenarioId);
  else return [];
  return affected.map((item) => ({ id: item.id, name: item.name }));
}

function parseJson(content: string): { reply?: string; patch?: Patch; general?: boolean; generalReason?: string } {
  try { return JSON.parse(content); } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* 落到统一错误 */ }
    }
    return { reply: '无法理解修改内容，请换个说法', patch: {} };
  }
}

function fieldValue(fields: any, key: string): unknown {
  const field = fields?.[key];
  const value = Array.isArray(field) ? field[0] : field;
  return value?.type === 'field' ? value.value : undefined;
}

export async function resourceAiRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway, speech } = ctx;
  const isAdmin = (role: string) => role === 'admin' || role === 'platform';

  app.get<{ Querystring: { target?: Target } }>('/library/resource-items', async (request, reply) => {
    const target = request.query.target;
    if (!target || !TARGETS.includes(target)) return reply.code(400).send({ error: 'target 无效' });
    const all = await listResources(store, target, request.tenantId) as any[];
    const items = !isAdmin(request.userRole) && target === 'scenario'
      ? all.filter((item) => item.createdBy === request.userId)
      : all;
    return {
      items: items.map((item) => ({
        id: item.id,
        name: nameOf(target, item),
        revision: revisionOf(item),
        version: item.version,
        createdBy: item.createdBy,
        owned: item.createdBy === request.userId,
      })),
    };
  });

  app.post<{ Body: any }>('/library/ai-edit', async (request, reply) => {
    let target: Target | undefined;
    let id: string | undefined;
    let text: string | undefined;
    let transcript: string | undefined;
    let apply = false;
    let patch: Patch | undefined;
    let expectedRevision: string | undefined;
    let commandId: string | undefined;

    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: '缺少音频文件' });
      const fields = file.fields;
      target = fieldValue(fields, 'target') as Target;
      id = fieldValue(fields, 'id') as string || undefined;
      const audio = await file.toBuffer();
      transcript = (await speech.asr.transcribe(audio, (file.mimetype.split('/')[1] ?? 'wav').split(';')[0])).trim();
      if (!transcript) return reply.code(422).send({ error: '未识别到有效语音' });
      text = transcript;
    } else {
      const body = (request.body ?? {}) as any;
      target = body.target;
      id = body.id || undefined;
      text = body.text?.trim();
      apply = body.apply === true;
      patch = body.patch;
      expectedRevision = body.expectedRevision;
      commandId = body.commandId;
    }
    if (!target || !TARGETS.includes(target)) return reply.code(400).send({ error: 'target 无效' });
    const current = await getResource(store, target, id, request.tenantId) as any;
    if (id && !current) return reply.code(404).send({ error: '资源不存在或不属于本租户' });
    const affected = await affectedScenarios(store, target, current, request.tenantId);
    const affectedRecords = current
      ? await store.listScenarios(request.tenantId)
      : [];
    const affectedIds = new Set(affected.map((item) => item.id));
    const affectedOwnedByOther = affectedRecords.some((scenario) => affectedIds.has(scenario.id) && scenario.createdBy !== request.userId);

    if (apply) {
      if (!commandId) return reply.code(400).send({ error: 'commandId 必填，请先创建修改预览' });
      const command = await store.getVoiceEditCommand(commandId);
      if (!command || command.tenantId !== request.tenantId || command.userId !== request.userId) return reply.code(404).send({ error: '修改命令不存在' });
      if (command.target !== target || command.resourceId !== id) return reply.code(400).send({ error: '命令与操作对象不一致' });
      if (revisionOf(current) !== expectedRevision) return reply.code(409).send({ error: '资源已被其他用户修改，请重新生成修改预览' });
      let clean: Patch;
      try { clean = cleanPatch(target, patch ?? {}); } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : '修改内容无效' });
      }
      const admin = isAdmin(request.userRole);
      const owned = !current || current.createdBy === request.userId || (target === 'scenario-guidance' && affected.length === 1 && affectedRecords.every((scenario) => scenario.createdBy === request.userId));
      const crossScene = target !== 'scenario' && affected.length > 1;
      const needsReview = command.general || (!admin && (!owned || affectedOwnedByOther || crossScene));
      const nextCommand: VoiceEditCommand = {
        ...command,
        patch: clean,
        affectedScenarioIds: affected.map((item) => item.id),
        status: needsReview ? 'pending_review' : 'applied',
        general: command.general || (!admin && (!owned || affectedOwnedByOther || crossScene)),
        generalReason: command.generalReason ?? (!owned ? '涉及非本人创建的共享资源' : crossScene ? '修改会影响多个场景' : affectedOwnedByOther ? '影响其他用户的场景' : undefined),
        updatedAt: new Date().toISOString(),
      };
      await store.saveVoiceEditCommand(nextCommand);
      if (needsReview) {
        return reply.code(202).send({ pendingReview: true, command: nextCommand, affectedScenarios: affected });
      }
      try {
        const item = await applyResource(store, target, id, clean, request.tenantId, request.userId);
        return { item, revision: revisionOf(item), command: nextCommand };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : '保存失败' });
      }
    }
    if (!text) return reply.code(400).send({ error: 'text 或音频必填' });
    const definition = RESOURCE_DEFS[target];
    const prompt = [
      `你是销售陪练系统的${definition.label}编辑助手。`,
      '根据用户指令生成结构化修改对象，只返回需要修改的字段，不要返回 id、tenantId、version、createdBy、updatedBy。',
      `允许字段：${definition.fields.join(' / ')}`,
      `字段结构：${definition.schema}`,
      current ? `当前资源：${JSON.stringify(current)}` : '当前是新建资源，请根据指令补齐必要字段。',
      '未提及字段不要返回；清空文本使用空字符串，清空数组使用 []；不要编造资源 ID，引用已有资源时优先使用当前资源中的 ID。',
      '同时判断是否属于通用能力、公共数据、共享资源或多个场景共同的问题。若是，general=true，并在 generalReason 中用一句话提炼通用问题；否则 general=false。',
      '严格返回 {"reply":"修改摘要","patch":{...},"general":false,"generalReason":""}。',
    ].join('\n');
    const result = await gateway.forTask('extractor').chat([
      { role: 'system', content: prompt },
      { role: 'user', content: text.slice(0, 6000) },
    ], { jsonMode: true, temperature: 0.2 });
    const parsed = parseJson(result.content);
    const rawPatch = parsed.patch && typeof parsed.patch === 'object' ? parsed.patch : {};
    const admin = isAdmin(request.userRole);
    const owned = !current || current.createdBy === request.userId || (target === 'scenario-guidance' && affected.length === 1 && affectedRecords.every((scenario) => scenario.createdBy === request.userId));
    const crossScene = target !== 'scenario' && affected.length > 1;
    const general = parsed.general === true || (!admin && (!owned || affectedOwnedByOther || crossScene));
    const now = new Date().toISOString();
    const command: VoiceEditCommand = {
      id: randomUUID(), tenantId: request.tenantId, userId: request.userId, source: 'resource-ai', target,
      resourceId: id, action: id ? 'update' : 'create', text: text.slice(0, 6000), transcript, patch: rawPatch,
      general,
      generalReason: parsed.generalReason || (!owned ? '涉及非本人创建的共享资源' : crossScene ? '修改会影响多个场景' : affectedOwnedByOther ? '影响其他用户的场景' : undefined),
      affectedScenarioIds: affected.map((item) => item.id), status: general ? 'pending_review' : 'previewed', createdAt: now, updatedAt: now,
    };
    let clean: Patch;
    try { clean = cleanPatch(target, rawPatch); } catch (error) {
      await store.saveVoiceEditCommand(command);
      return reply.code(422).send({ error: error instanceof Error ? error.message : '提取结果无效', commandId: command.id });
    }
    command.patch = clean;
    await store.saveVoiceEditCommand(command);
    return {
      transcript,
      reply: parsed.reply ?? '已生成修改预览',
      patch: clean,
      expectedRevision: revisionOf(current),
      affectedScenarios: affected,
      commandId: command.id,
      general: command.general,
      generalReason: command.generalReason,
    };
  });

  app.post<{ Params: { id: string } }>('/voice-edit-commands/:id/applied', async (request, reply) => {
    const command = await store.getVoiceEditCommand(request.params.id);
    if (!command || command.tenantId !== request.tenantId || command.userId !== request.userId) {
      return reply.code(404).send({ error: '命令不存在' });
    }
    if (command.general) return reply.code(409).send({ error: '通用建议需统一处理，不能标记为直接应用' });
    const updated: VoiceEditCommand = { ...command, status: 'applied', updatedAt: new Date().toISOString() };
    await store.saveVoiceEditCommand(updated);
    return updated;
  });

  app.get<{ Querystring: { general?: string } }>('/voice-edit-commands', async (request) => {
    const general = request.query.general === undefined ? undefined : request.query.general === '1';
    const items = await store.listVoiceEditCommands({
      tenantId: request.tenantId,
      userId: isAdmin(request.userRole) ? undefined : request.userId,
      general,
    });
    return { items };
  });

  app.patch<{ Params: { id: string }; Body: { status?: VoiceEditCommand['status']; reviewNote?: string } }>(
    '/voice-edit-commands/:id',
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
}
