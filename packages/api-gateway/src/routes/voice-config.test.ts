import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { MemoryStore } from '@grasp-mvp/infra';
import type { PersonaConfig, ProductKB, Scenario, ScoreReport } from '@grasp-mvp/core';
import { voiceConfigRoutes } from './voice-config.js';
import type { RouteContext } from '../ctx.js';

interface Op {
  target: string;
  action: 'create' | 'update' | 'analyze-update';
  subject: string;
  resourceName?: string;
  fields?: Record<string, unknown>;
  persona?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  analysis?: { category?: string; scenarioName?: string; aspect?: string };
  general?: boolean;
  generalReason?: string;
}

async function setup(
  role: 'admin' | 'trainee' = 'admin',
  operation: Op = { target: 'scenario', action: 'update', subject: '原场景', fields: { name: '语音修改后的场景' } },
  chatImpl?: (messages: Array<{ role: string; content: string }>) => Promise<{ model: string; content: string }>,
) {
  const store = new MemoryStore();
  const persona: PersonaConfig = {
    id: 'persona-1', tenantId: 'tenant-demo', name: '原角色', background: '客户背景', elementIds: [],
    behaviorBands: [{ key: 'calm', minArousal: 0, maxArousal: 1, instruction: '自然回应' }],
    knowledgeBoundary: { mustNotKnow: [], loadedKnowledge: [] }, version: 1, createdBy: 'admin-1',
  };
  await store.savePersonaConfig(persona);
  await store.saveSkillPoint({ id: 'skill-1', tenantId: 'tenant-demo', name: '需求挖掘' });
  await store.upsertScoreItemDef({
    id: 'score-1', tenantId: 'tenant-demo', skillPointId: 'skill-1', name: '需求挖掘标准', behaviorAnchor: '',
    judgePrompt: '', weight: 1, levels: [{ key: 'pass', label: '达标', score: 100, description: '' }],
    layer: 'company', isObservation: false, category: '电销',
  });
  const baseScenario: Scenario = {
    id: 'scenario-1', tenantId: 'tenant-demo', name: '原场景', personaConfigId: 'persona-1',
    skillPointIds: ['skill-1'], scoreItemIds: ['score-1'], successCriteria: { passScore: 60 },
    durationMinutes: 10, difficulty: 1, category: '电销', flowType: 'generic', status: 'draft', version: 1,
  };
  await store.saveScenario(baseScenario);
  await store.saveScenario({ ...baseScenario, id: 'scenario-2', name: '第二场景' });
  // 未绑定角色的场景，用于验证「补建角色后绑定」
  await store.saveScenario({ ...baseScenario, id: 'scenario-3', name: '裸场景', personaConfigId: '' });
  // 默认机构知识库
  const kb: ProductKB = {
    id: 'kb-1', tenantId: 'tenant-demo', name: '机构产品知识库', version: 1, entries: [], effectiveAt: new Date().toISOString(),
  };
  await store.saveProductKB(kb);

  const chat = vi.fn(async (_messages: Array<{ role: string; content: string }>) => ({
    model: 'mock',
    content: JSON.stringify({ reply: '已生成', operations: [operation] }),
  }));
  if (chatImpl) {
    chat.mockImplementation(chatImpl);
  }
  const transcribe = vi.fn(async () => '语音指令');
  const app = Fastify();
  await app.register(multipart);
  app.addHook('onRequest', async (request) => {
    request.userId = role === 'admin' ? 'admin-1' : 'trainee-1';
    request.userRole = role;
    request.tenantId = 'tenant-demo';
  });
  const ctx = {
    store,
    gateway: { forTask: () => ({ chat }) },
    speech: { asr: { transcribe } },
  } as unknown as RouteContext;
  await app.register((instance) => voiceConfigRoutes(instance, ctx), { prefix: '/api/v1' });
  return { app, store, chat, transcribe };
}

it('admin 文字指令预览并落地场景修改，过期预览不会覆盖他人修改', async () => {
  const { app, store } = await setup();
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '把原场景改名', context: { scenarioId: 'scenario-1' } },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ commandId: string; expectedRevisions: Record<string, string>; hasPrivate: boolean; operations: Array<{ scope: string; planKind: string }> }>();
    expect(body.hasPrivate).toBe(true);
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0].scope).toBe('direct');
    expect(body.operations[0].planKind).toBe('update-scenario');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: { scenarioId: 'scenario-1' } },
    });
    expect(applied.statusCode).toBe(200);
    const saved = await store.getScenario('scenario-1');
    expect(saved?.name).toBe('语音修改后的场景');
    expect(saved?.version).toBe(2);

    const stale = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: { scenarioId: 'scenario-1' } },
    });
    expect(stale.statusCode).toBe(409);
  } finally { await app.close(); }
});

it('场景未绑定角色时修改角色描述，自动补建角色并绑定，避免空指针失败', async () => {
  const { app, store } = await setup('admin', {
    target: 'scenario', action: 'update', subject: '裸场景',
    persona: { name: '客户乙', roleIndustry: '制造业', personalities: ['强势'] },
    conversation: { speechRate: 2, challenge: 4, interruptLevel: 'strong' },
  });
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '给裸场景换一个强势角色', context: { scenarioId: 'scenario-3' } },
    });
    expect(preview.statusCode).toBe(200);
    const command = await store.getVoiceEditCommand(preview.json<{ commandId: string }>().commandId);
    const kinds = command!.plan!.operations.map((op) => op.kind);
    expect(kinds).toContain('create-persona');
    expect(kinds).toContain('update-scenario');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: command!.id, expectedRevisions: preview.json().expectedRevisions, context: { scenarioId: 'scenario-3' } },
    });
    expect(applied.statusCode).toBe(200);
    const scenario = await store.getScenario('scenario-3');
    expect(scenario?.personaConfigId).toBeTruthy();
    const bound = await store.getPersonaConfig(scenario!.personaConfigId);
    expect(bound?.name).toBe('客户乙');
    expect(bound?.industry).toBe('制造业');
    expect(bound?.personalityTags).toEqual(['强势']);
    expect(bound?.behaviorBands).toHaveLength(3);
  } finally { await app.close(); }
});

it('普通用户修改被多场景共用的角色：生成副本并重绑当前场景，原角色不变', async () => {
  const { app, store } = await setup('trainee', {
    target: 'persona', action: 'update', subject: '原角色',
    fields: { decisionStyle: '先同意后比价' },
  });
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '把原角色的决策风格改一下', context: { scenarioId: 'scenario-1' } },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ commandId: string; expectedRevisions: Record<string, string>; operations: Array<{ scope: string; planKind: string }> }>();
    expect(body.operations[0].scope).toBe('copy-on-write');
    expect(body.operations[0].planKind).toBe('copy-resource');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: { scenarioId: 'scenario-1' } },
    });
    expect(applied.statusCode).toBe(200);
    const scenario = await store.getScenario('scenario-1');
    expect(scenario?.personaConfigId).not.toBe('persona-1');
    const copy = await store.getPersonaConfig(scenario!.personaConfigId);
    expect(copy?.decisionStyle).toBe('先同意后比价');
    expect(copy?.version).toBe(1);
    const original = await store.getPersonaConfig('persona-1');
    expect(original?.decisionStyle).toBeUndefined();
    expect(original?.version).toBe(1);
    // 另一场景仍引用原角色
    expect((await store.getScenario('scenario-2'))?.personaConfigId).toBe('persona-1');
  } finally { await app.close(); }
});

it('通用建议只进入待处理队列，不修改业务数据', async () => {
  const { app, store } = await setup('trainee', {
    target: 'product-kb', action: 'update', subject: '机构产品知识库', general: true, generalReason: '公共产品事实',
    fields: { name: '机构产品知识库' },
  });
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '更新公共产品知识', context: { scenarioId: 'scenario-1' } },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().general).toBe(true);
    expect(preview.json().hasPrivate).toBe(false);

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: preview.json<{ commandId: string }>().commandId, context: { scenarioId: 'scenario-1' } },
    });
    expect(applied.statusCode).toBe(202);
    expect(applied.json().pendingReview).toBe(true);
    const kb = await store.getProductKB('tenant-demo');
    expect(kb?.version).toBe(1);
    const commands = await store.listVoiceEditCommands({ tenantId: 'tenant-demo', userId: 'trainee-1', general: true });
    expect(commands).toHaveLength(1);
    expect(commands[0].status).toBe('pending_review');
  } finally { await app.close(); }
});


/** 意图分流：第一轮 chat 是意图分类，第二轮是评分解读 */
function scoreExplainChatMock(responses: string[]) {
  let call = 0;
  return async () => ({ model: 'mock', content: responses[Math.min(call++, responses.length - 1)] });
}

async function seedCompletedSessionWithReport(store: MemoryStore) {
  await store.createSession({
    id: 'sess-1', tenantId: 'tenant-demo', userId: 'admin-1', scenarioId: 'scenario-1',
    mode: 'practice', status: 'completed', transcript: [], emotionTrace: [], hintsUsed: 0,
    startedAt: '2024-01-02T00:00:00.000Z', endedAt: '2024-01-02T00:10:00.000Z',
  });
  const report: ScoreReport = {
    id: 'report-1', sessionId: 'sess-1', totalScore: 62, baseScore: 78, confidenceIndex: 0.8,
    passed: false, fatalViolation: false,
    skillScores: [{ skillPointId: 'skill-1', skillPointName: '需求挖掘', score: 40, maxScore: 100 }],
    items: [{
      itemId: 'score-1', itemName: '需求挖掘标准', skillPointId: 'skill-1',
      levelKey: 'fail', levelLabel: '未达标', score: 40,
      quote: '我们这个月预算已经用完了', quoteTurnSeq: 3,
      rationale: '客户提出预算异议后没有追问需求，直接放弃推进',
      betterScript: '可以先问"您目前最想解决的是什么问题"',
      confidence: 0.9, judgeAgree: true, isReference: false, isObservation: false, layer: 'company',
    }],
    violations: [],
    ruleStats: {
      interruptions: 1, fillerCounts: { 然后: 5 }, coverageHits: [], coverageMisses: ['预算'],
      talkRatio: 0.55, avgSpeechRate: 210, pauseCount: 2,
    },
    createdAt: '2024-01-02T00:11:00.000Z',
  };
  await store.saveScoreReport(report);
}

it('询问上一场评分原因：读取同场景最近一场报告并返回答读，不产生编辑命令', async () => {
  const { app, store } = await setup('admin', undefined, scoreExplainChatMock([
    JSON.stringify({ intent: 'score_explain', scenarioName: '' }),
    JSON.stringify({ answer: '主要失分在需求挖掘：客户提出预算异议后没有追问，直接放弃推进。' }),
  ]));
  await seedCompletedSessionWithReport(store);
  try {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '上一场为什么需求挖掘得分这么低', context: { scenarioId: 'scenario-1' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      scoreExplain: { scenarioName: string; sessionId: string; totalScore: number; passed: boolean; answer: string };
      commandId?: string;
    }>();
    expect(body.scoreExplain.scenarioName).toBe('原场景');
    expect(body.scoreExplain.sessionId).toBe('sess-1');
    expect(body.scoreExplain.totalScore).toBe(62);
    expect(body.scoreExplain.passed).toBe(false);
    expect(body.scoreExplain.answer).toContain('需求挖掘');
    expect(body.commandId).toBeUndefined();

    const commands = await store.listVoiceEditCommands({ tenantId: 'tenant-demo', userId: 'admin-1' });
    expect(commands).toHaveLength(0);
  } finally { await app.close(); }
});

it('场景下没有已完成的练习记录时，评分解读返回 422', async () => {
  const { app } = await setup('admin', undefined, scoreExplainChatMock([
    JSON.stringify({ intent: 'score_explain', scenarioName: '' }),
  ]));
  try {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '上一场各项评分的原因是什么', context: { scenarioId: 'scenario-1' } },
    });
    expect(res.statusCode).toBe(422);
  } finally { await app.close(); }
});

it('无上下文场景（独立语音编辑页/新场景草稿）：回退到该用户最近一场已完成对练', async () => {
  const { app, store } = await setup('admin', undefined, scoreExplainChatMock([
    JSON.stringify({ intent: 'score_explain', scenarioName: '' }),
    JSON.stringify({ answer: '基于你最近一场对练的评分报告解读。' }),
  ]));
  await seedCompletedSessionWithReport(store);
  try {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '上一场为什么需求挖掘得分这么低' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ scoreExplain: { scenarioName: string; sessionId: string; totalScore: number; answer: string } }>();
    expect(body.scoreExplain.sessionId).toBe('sess-1');
    expect(body.scoreExplain.totalScore).toBe(62);
    expect(body.scoreExplain.scenarioName).toBe('原场景');
    expect(body.scoreExplain.answer).toContain('最近一场');
  } finally { await app.close(); }
});

/** 共享同一 store 的另一个身份视角（用于隔离性测试） */
async function secondApp(store: MemoryStore, userId: string, tenantId: string, role: 'admin' | 'trainee' = 'admin') {
  const chat = vi.fn(async () => ({ model: 'mock', content: JSON.stringify({ reply: '已生成', operations: [] }) }));
  const app = Fastify();
  await app.register(multipart);
  app.addHook('onRequest', async (request) => {
    request.userId = userId;
    request.userRole = role;
    request.tenantId = tenantId;
  });
  const ctx = {
    store,
    gateway: { forTask: () => ({ chat }) },
    speech: { asr: { transcribe: vi.fn(async () => '') } },
  } as unknown as RouteContext;
  await app.register((instance) => voiceConfigRoutes(instance, ctx), { prefix: '/api/v1' });
  return { app };
}

it('语音音频先 ASR 转写再生成预览，确认后才落库', async () => {
  const { app, store, transcribe } = await setup('admin');
  try {
    const boundary = '----voice-config-audio';
    const payload = Buffer.from([
      `--${boundary}\r\nContent-Disposition: form-data; name="context"\r\n\r\n${JSON.stringify({ scenarioId: 'scenario-1' })}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      'audio-bytes',
      `\r\n--${boundary}--\r\n`,
    ].join(''));
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config', payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(preview.statusCode).toBe(200);
    expect(transcribe).toHaveBeenCalledTimes(1);
    const body = preview.json<{ transcript: string; commandId: string; expectedRevisions: Record<string, string> }>();
    expect(body.transcript).toBe('语音指令');
    // 预览阶段不落库
    expect((await store.getScenario('scenario-1'))?.name).toBe('原场景');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: { scenarioId: 'scenario-1' } },
    });
    expect(applied.statusCode).toBe(200);
    expect((await store.getScenario('scenario-1'))?.name).toBe('语音修改后的场景');
    expect((await store.getVoiceEditCommand(body.commandId))?.transcript).toBe('语音指令');
  } finally { await app.close(); }
});

it('语音新建场景：自动补建角色并绑定，数据写入资源库', async () => {
  const { app, store } = await setup('admin', {
    target: 'scenario', action: 'create', subject: '首次电话邀约',
    fields: { name: '首次电话邀约', category: '电销', duration: 15, successCriteria: 80 },
    persona: { name: '采购经理', roleIndustry: '制造业', personalities: ['爱压价'] },
    conversation: { speechRate: 3, challenge: 4, interruptLevel: 'strong' },
  });
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '新建一个电销场景「首次电话邀约」，客户是爱压价的采购经理，时长 15 分钟、及格分 80', context: {} },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ commandId: string; expectedRevisions: Record<string, string>; operations: Array<{ planKind: string }> }>();
    const command = await store.getVoiceEditCommand(body.commandId);
    expect(command!.plan!.operations.map((op) => op.kind)).toEqual(['create-persona', 'create-scenario']);
    expect(body.operations[0].planKind).toBe('create-scenario');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: {} },
    });
    expect(applied.statusCode).toBe(200);
    const scenarios = await store.listScenarios('tenant-demo');
    const created = scenarios.find((s) => s.name === '首次电话邀约');
    expect(created).toBeTruthy();
    expect(created?.createdBy).toBe('admin-1');
    expect(created?.tenantId).toBe('tenant-demo');
    expect(created?.durationMinutes).toBe(15);
    expect(created?.personaConfigId).toBeTruthy();
    // 默认绑定租户技能点
    expect(created?.skillPointIds).toContain('skill-1');
    const persona = await store.getPersonaConfig(created!.personaConfigId);
    expect(persona?.name).toBe('采购经理');
    expect(persona?.personalityTags).toEqual(['爱压价']);
    expect(persona?.industry).toBe('制造业');
    expect(persona?.behaviorBands).toHaveLength(3);
  } finally { await app.close(); }
});

it('语音新建资源库条目（技能点）直接落库，带租户与创建人', async () => {
  const { app, store } = await setup('admin', {
    target: 'skill-point', action: 'create', subject: '价值表达',
    fields: { name: '价值表达', description: '讲清客户价值' },
  });
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '新增价值表达技能点', context: {} },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ commandId: string; expectedRevisions: Record<string, string>; operations: Array<{ scope: string }> }>();
    expect(body.operations[0].scope).toBe('direct');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: {} },
    });
    expect(applied.statusCode).toBe(200);
    const skills = await store.listSkillPoints('tenant-demo');
    const created = skills.find((s) => s.name === '价值表达');
    expect(created).toBeTruthy();
    expect(created?.tenantId).toBe('tenant-demo');
    // 其它租户看不到该资源
    expect((await store.listSkillPoints('tenant-other')).some((s) => s.name === '价值表达')).toBe(false);
  } finally { await app.close(); }
});

it('命令归属校验：同租户其他用户或跨租户不能应用他人命令', async () => {
  const first = await setup('trainee');
  try {
    const preview = await first.app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '把原角色的决策风格改一下', context: { scenarioId: 'scenario-1' } },
    });
    expect(preview.statusCode).toBe(200);
    const { commandId } = preview.json<{ commandId: string }>();

    const otherUser = await secondApp(first.store, 'trainee-2', 'tenant-demo', 'trainee');
    try {
      const stolen = await otherUser.app.inject({
        method: 'POST', url: '/api/v1/library/voice-config',
        payload: { apply: true, commandId, context: { scenarioId: 'scenario-1' } },
      });
      expect(stolen.statusCode).toBe(404);
    } finally { await otherUser.app.close(); }

    const otherTenant = await secondApp(first.store, 'admin-1', 'tenant-other', 'admin');
    try {
      const stolen = await otherTenant.app.inject({
        method: 'POST', url: '/api/v1/library/voice-config',
        payload: { apply: true, commandId, context: { scenarioId: 'scenario-1' } },
      });
      expect(stolen.statusCode).toBe(404);
    } finally { await otherTenant.app.close(); }

    // 原数据未被改动
    expect((await first.store.getPersonaConfig('persona-1'))?.decisionStyle).toBeUndefined();
  } finally { await first.app.close(); }
});

it('命令日志按用户与租户隔离：普通用户仅见自己，管理员见本租户全部', async () => {
  const { app, store } = await setup('trainee');
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '把原角色的决策风格改一下', context: { scenarioId: 'scenario-1' } },
    });
    expect(preview.statusCode).toBe(200);

    const own = await app.inject({ method: 'GET', url: '/api/v1/library/voice-config/logs' });
    expect(own.statusCode).toBe(200);
    const ownItems = own.json<{ items: Array<{ userId: string }> }>().items;
    expect(ownItems).toHaveLength(1);
    expect(ownItems[0].userId).toBe('trainee-1');

    const adminView = await secondApp(store, 'admin-1', 'tenant-demo', 'admin');
    try {
      const all = await adminView.app.inject({ method: 'GET', url: '/api/v1/library/voice-config/logs' });
      expect(all.json<{ items: unknown[] }>().items.length).toBeGreaterThanOrEqual(1);
    } finally { await adminView.app.close(); }

    const otherTenant = await secondApp(store, 'admin-2', 'tenant-other', 'admin');
    try {
      const none = await otherTenant.app.inject({ method: 'GET', url: '/api/v1/library/voice-config/logs' });
      expect(none.json<{ items: unknown[] }>().items).toHaveLength(0);
    } finally { await otherTenant.app.close(); }
  } finally { await app.close(); }
});

it('普通用户修改他人创建的场景：转为通用建议，不直接改动数据', async () => {
  const { app, store } = await setup('trainee');
  try {
    // scenario-1 的 createdBy 不是 trainee-1（setup 中未设置，属于其他用户）
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '把原场景的难度改成挑战', context: { scenarioId: 'scenario-1' } },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ commandId: string; general: boolean; operations: Array<{ scope: string }> }>();
    expect(body.general).toBe(true);
    expect(body.operations[0].scope).toBe('general');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, context: { scenarioId: 'scenario-1' } },
    });
    expect(applied.statusCode).toBe(202);
    expect(applied.json().pendingReview).toBe(true);
    expect((await store.getScenario('scenario-1'))?.name).toBe('原场景');

  } finally { await app.close(); }
});

it('语音新建测验题：场景/技能点名称自动解析为 ID 并写入资源库', async () => {
  const { app, store } = await setup('admin', {
    target: 'quiz-question', action: 'create', subject: '压价应对测验', resourceName: '压价应对测验',
    fields: {
      scenarioId: '原场景', skillPointId: '需求挖掘', type: 'single_choice',
      prompt: '客户说「太贵了」时，第一步应该做什么？',
      options: [{ id: 'a', label: '直接降价' }, { id: 'b', label: '先问预算和诉求' }],
      correctAnswer: ['b'], score: 10,
    },
  });
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '给原场景加一道关于压价的测验题', context: { scenarioId: 'scenario-1' } },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ commandId: string; expectedRevisions: Record<string, string>; operations: Array<{ scope: string; planKind: string }> }>();
    expect(body.operations[0].scope).toBe('direct');
    expect(body.operations[0].planKind).toBe('create-resource');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: { scenarioId: 'scenario-1' } },
    });
    expect(applied.statusCode).toBe(200);
    const quizzes = await store.listQuizQuestions('tenant-demo');
    const created = quizzes.find((q) => q.prompt.includes('太贵了'));
    expect(created).toBeTruthy();
    // 名称引用被解析为租户内 ID
    expect(created?.scenarioId).toBe('scenario-1');
    expect(created?.skillPointId).toBe('skill-1');
    expect(created?.correctAnswer).toEqual(['b']);
    expect(created?.options).toEqual([{ id: 'a', label: '直接降价' }, { id: 'b', label: '先问预算和诉求' }]);
    expect(created?.createdBy).toBe('admin-1');
    expect(created?.tenantId).toBe('tenant-demo');
    // 其它租户看不到该题
    expect((await store.listQuizQuestions('tenant-other')).some((q) => q.prompt.includes('太贵了'))).toBe(false);
  } finally { await app.close(); }
});

it('测验题引用不存在的场景：预览阶段直接报错，不生成落库计划', async () => {
  const { app, store } = await setup('admin', {
    target: 'quiz-question', action: 'create', subject: '压价应对测验',
    fields: {
      scenarioId: '不存在的场景', type: 'short_answer', prompt: '客户压价怎么办？',
      correctAnswer: '先问预算', score: 5,
    },
  });
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '新建一道测验题', context: {} },
    });
    expect(preview.statusCode).toBe(422);
    expect(preview.json<{ error: string }>().error).toContain('未找到引用的场景');
    expect(await store.listQuizQuestions('tenant-demo')).toHaveLength(0);
  } finally { await app.close(); }
});

it('admin 语音修改方法论配置：直接落库且租户内保持单例', async () => {
  const { app, store } = await setup('admin', {
    target: 'methodology-config', action: 'update', subject: '方法论配置',
    fields: { name: '电销方法论', passScore: 75, skillWeights: { 'skill-1': 0.7 }, fillerWords: ['呃', '那个'] },
  });
  try {
    const first = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '把方法论配置的及格分改成 75', context: {} },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{ commandId: string; operations: Array<{ scope: string; planKind: string }> }>();
    expect(firstBody.operations[0].scope).toBe('direct');
    expect(firstBody.operations[0].planKind).toBe('create-resource');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: firstBody.commandId, context: {} },
    });
    expect(applied.statusCode).toBe(200);
    const config = await store.getMethodologyConfig('tenant-demo');
    expect(config?.name).toBe('电销方法论');
    expect(config?.passScore).toBe(75);
    expect(config?.skillWeights).toEqual({ 'skill-1': 0.7 });
    expect(config?.fillerWords).toEqual(['呃', '那个']);
    expect(config?.createdBy).toBe('admin-1');
    const id = config!.id;

    // 再次修改：沿用同一单例 id，不重复创建
    const second = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '调整方法论权重', context: {} },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<{ commandId: string; expectedRevisions: Record<string, string> }>();
    expect(secondBody.expectedRevisions[id]).toBeTruthy();
    const appliedAgain = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: secondBody.commandId, expectedRevisions: secondBody.expectedRevisions, context: {} },
    });
    expect(appliedAgain.statusCode).toBe(200);
    // 沿用同一单例：id 不变，未重复创建
    expect((await store.getMethodologyConfig('tenant-demo'))?.id).toBe(id);
    expect((await store.getMethodologyConfig('tenant-demo'))?.passScore).toBe(75);
  } finally { await app.close(); }
});

it('普通用户修改方法论配置（租户共享配置）：转为通用建议，不直接落库', async () => {
  const { app, store } = await setup('trainee', {
    target: 'methodology-config', action: 'update', subject: '方法论配置',
    fields: { passScore: 75 },
  });
  await store.upsertMethodologyConfig({
    id: 'methodology-1', tenantId: 'tenant-demo', name: '默认方法论',
    skillWeights: {}, redlinePhrases: [], fillerWords: [], passScore: 60, createdBy: 'admin-1',
  });
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '把方法论配置的及格分改成 75', context: { scenarioId: 'scenario-1' } },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ commandId: string; general: boolean; operations: Array<{ scope: string; generalReason?: string }> }>();
    expect(body.general).toBe(true);
    expect(body.operations[0].scope).toBe('general');
    expect(body.operations[0].generalReason).toContain('方法论配置');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, context: { scenarioId: 'scenario-1' } },
    });
    expect(applied.statusCode).toBe(202);
    expect(applied.json().pendingReview).toBe(true);
    // 共享配置未被改动
    expect((await store.getMethodologyConfig('tenant-demo'))?.passScore).toBe(60);
  } finally { await app.close(); }
});


async function seedGroundAnalysis(store: MemoryStore, userId: string) {
  const base = (await store.getScenario('scenario-1'))!;
  await store.upsertScoreItemDef({
    id: 'ground-other', tenantId: 'tenant-demo', skillPointId: 'skill-1', name: '地推礼貌礼仪',
    behaviorAnchor: '保持礼貌', judgePrompt: '只评礼貌', weight: 1,
    levels: [{ key: 'pass', label: '达标', score: 100, description: '礼貌' }],
    layer: 'company', isObservation: false, category: '地推',
  });
  await store.upsertScoreItemDef({
    id: 'ground-taboo', tenantId: 'tenant-demo', skillPointId: 'skill-1', name: '地推销售忌讳',
    behaviorAnchor: '原有地推忌讳锚定', judgePrompt: '原有地推忌讳判定说明', weight: 0,
    levels: [], layer: 'company', isObservation: false, category: '地推',
    scoringMode: 'score', deductionOnly: true,
  });
  await store.saveScenario({
    ...base, id: 'ground-old', name: '较早的地推演练', category: '地推', flowType: 'ground_push',
    scoreItemIds: ['ground-taboo'], createdBy: userId, version: 1,
  });
  await store.saveScenario({
    ...base, id: 'ground-latest', name: '最近的地推演练', category: '地推', flowType: 'ground_push',
    scoreItemIds: ['ground-other'], createdBy: userId, version: 1,
  });
  await store.createSession({
    id: 'ground-session-old', tenantId: 'tenant-demo', userId, scenarioId: 'ground-old', mode: 'practice', status: 'completed',
    transcript: [], emotionTrace: [], hintsUsed: 0,
    startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:10:00.000Z',
  });
  await store.createSession({
    id: 'ground-session-latest', tenantId: 'tenant-demo', userId, scenarioId: 'ground-latest', mode: 'practice', status: 'completed',
    transcript: [
      { seq: 1, speaker: 'trainee', text: '我我我想了解一下这这这个课程怎么安排。', at: '2026-01-02T10:01:00.000Z' },
    ],
    emotionTrace: [], hintsUsed: 0,
    startedAt: '2026-01-02T10:00:00.000Z', endedAt: '2026-01-02T10:10:00.000Z',
  });
  for (const sessionId of ['ground-session-old', 'ground-session-latest']) {
    await store.saveScoreReport({
      id: `report-${sessionId}`, sessionId, totalScore: 70, passed: true, fatalViolation: false,
      skillScores: [], items: [], violations: [],
      ruleStats: { interruptions: 0, fillerCounts: {}, coverageHits: [], coverageMisses: [], talkRatio: 1, avgSpeechRate: 240, pauseCount: 0 },
      createdAt: '2026-01-02T10:11:00.000Z',
    });
  }
}

function analysisChatMock(operation: Op, response: Record<string, unknown>) {
  return async (messages: Array<{ role: string; content: string }>) => {
    const system = messages[0]?.content ?? '';
    if (system.includes('评分配置诊断助手')) return { model: 'mock', content: JSON.stringify(response) };
    if (system.includes('意图分类器')) return { model: 'mock', content: JSON.stringify({ intent: 'edit', scenarioName: '' }) };
    return { model: 'mock', content: JSON.stringify({ reply: '已生成', operations: [operation] }) };
  };
}

const groundAnalysisResponse = {
  scoreItemId: 'ground-taboo',
  summary: '历史报告没有覆盖磕绊证据，需要补充表达流畅度规则',
  reasons: ['历史评分项的判定说明未包含磕绊证据'],
  evidence: ['转写中存在连续重复字词'],
  behaviorAnchorAddition: '表达流畅度（磕磕绊绊）：关注成串填充词、持续重复断句和频繁句中停顿，由系统按整场表现分档扣分。',
  judgePromptAddition: '磕磕绊绊由系统固定规则独立判定，score 和 dimensions 不要重复计入该项。',
};

const groundFluencyOperation: Op = {
  target: 'score-item', action: 'analyze-update', subject: '上次地推场景的评分标准',
  analysis: { category: '地推', aspect: '磕磕绊绊' }, fields: {}, general: true, generalReason: '模型误标为通用规则',
};

it('诊断并修改：定位最近地推演练，保留原标准并追加磕绊规则和场景绑定', async () => {
  const { app, store } = await setup('admin', groundFluencyOperation, analysisChatMock(groundFluencyOperation, groundAnalysisResponse));
  await seedGroundAnalysis(store, 'admin-1');
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '帮我找一下上次地推场景中，评分标准没有参考说话磕磕绊绊的原因，并把磕磕绊绊加入到评分标准中', context: {} },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{
      commandId: string;
      expectedRevisions: Record<string, string>;
      operations: Array<{
        scope: string;
        fields: Record<string, string>;
        diagnosis: { session: { id: string }; reasons: string[]; proposedChanges: string[] };
      }>;
    }>();
    expect(body.operations[0].scope).toBe('direct');
    expect(body.operations[0].diagnosis.session.id).toBe('ground-session-latest');
    expect(body.operations[0].diagnosis.reasons.join('\n')).toContain('当前未绑定');
    expect(body.operations[0].diagnosis.proposedChanges.join('\n')).toContain('保留原有绑定');
    expect(body.operations[0].fields.behaviorAnchor).toContain('原有地推忌讳锚定');
    expect(body.operations[0].fields.behaviorAnchor).toContain('磕磕绊绊');
    expect(body.operations[0].fields.judgePrompt).toContain('原有地推忌讳判定说明');
    expect(body.expectedRevisions['ground-latest']).toBeTruthy();

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: {} },
    });
    expect(applied.statusCode).toBe(200);
    const scoreItems = await store.listScoreItemDefs('tenant-demo');
    const taboo = scoreItems.find((item) => item.id === 'ground-taboo')!;
    expect(taboo.behaviorAnchor).toContain('原有地推忌讳锚定');
    expect(taboo.behaviorAnchor).toContain('表达流畅度（磕磕绊绊）');
    expect(taboo.judgePrompt).toContain('不要重复计入');
    expect((await store.getScenario('ground-latest'))?.scoreItemIds).toEqual(['ground-other', 'ground-taboo']);
    expect((await store.getScenario('ground-old'))?.scoreItemIds).toEqual(['ground-taboo']);
    expect((await store.getVoiceEditCommand(body.commandId))?.diagnoses?.[0].session.id).toBe('ground-session-latest');
  } finally { await app.close(); }
});

it('诊断并修改：普通用户复制共享评分标准并重绑最近场景，不改原资源', async () => {
  const { app, store } = await setup('trainee', groundFluencyOperation, analysisChatMock(groundFluencyOperation, groundAnalysisResponse));
  await seedGroundAnalysis(store, 'trainee-1');
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '分析上次地推为什么没有评价磕磕绊绊并加入评分标准', context: {} },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ commandId: string; expectedRevisions: Record<string, string>; operations: Array<{ scope: string }> }>();
    expect(body.operations[0].scope).toBe('copy-on-write');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: {} },
    });
    expect(applied.statusCode).toBe(200);
    const original = (await store.listScoreItemDefs('tenant-demo')).find((item) => item.id === 'ground-taboo')!;
    expect(original.behaviorAnchor).toBe('原有地推忌讳锚定');
    const latest = await store.getScenario('ground-latest');
    const boundIds = latest?.scoreItemIds ?? [];
    expect(boundIds).toHaveLength(2);
    expect(boundIds[0]).toBe('ground-other');
    expect(boundIds[1]).not.toBe('ground-taboo');
    const copy = (await store.listScoreItemDefs('tenant-demo')).find((item) => item.id === boundIds[1])!;
    expect(copy.behaviorAnchor).toContain('原有地推忌讳锚定');
    expect(copy.behaviorAnchor).toContain('表达流畅度（磕磕绊绊）');
    expect((await store.getScenario('ground-old'))?.scoreItemIds).toEqual(['ground-taboo']);
  } finally { await app.close(); }
});

it('诊断并修改：没有已完成地推演练时明确报错，不生成修改计划', async () => {
  const { app, store } = await setup('admin', groundFluencyOperation, analysisChatMock(groundFluencyOperation, groundAnalysisResponse));
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '分析上次地推的磕磕绊绊评分并修改', context: {} },
    });
    expect(preview.statusCode).toBe(404);
    expect(preview.json<{ error: string }>().error).toContain('未找到已完成的地推演练');
    const commands = await store.listVoiceEditCommands({ tenantId: 'tenant-demo' });
    expect(commands).toHaveLength(0);
  } finally { await app.close(); }
});


it('通用诊断并修改：支持电销场景和预算异议维度，不依赖固定评分项名称', async () => {
  const operation: Op = {
    target: 'score-item', action: 'analyze-update', subject: '需求挖掘标准',
    analysis: { category: '电销', scenarioName: '原场景', aspect: '预算异议' }, fields: {},
  };
  const response = {
    scoreItemId: 'score-1', summary: '预算异议没有形成独立判定依据',
    reasons: ['原评分标准只覆盖一般需求追问，没有明确预算异议的处理证据'],
    evidence: ['客户明确表示本月预算已经用完'],
    behaviorAnchorAddition: '预算异议处理：客户提出预算限制时，应继续确认预算范围、采购优先级和替代方案，不得直接放弃需求挖掘。',
    judgePromptAddition: '将预算异议处理纳入本项评分，引用客户预算限制后的学员回应作为证据。',
  };
  const { app, store } = await setup('admin', operation, analysisChatMock(operation, response));
  await seedCompletedSessionWithReport(store);
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '分析上次电销中原场景的预算异议为什么没评分，并把预算异议加入需求挖掘标准', context: {} },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{
      commandId: string;
      expectedRevisions: Record<string, string>;
      operations: Array<{ diagnosis: { aspect: string; scoreItem: { id: string } }; fields: Record<string, string> }>;
    }>();
    expect(body.operations[0].diagnosis.aspect).toBe('预算异议');
    expect(body.operations[0].diagnosis.scoreItem.id).toBe('score-1');
    expect(body.operations[0].fields.behaviorAnchor).toContain('预算异议处理');

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: {} },
    });
    expect(applied.statusCode).toBe(200);
    const saved = (await store.listScoreItemDefs('tenant-demo')).find((item) => item.id === 'score-1')!;
    expect(saved.behaviorAnchor).toContain('预算异议处理');
    expect(saved.judgePrompt).toContain('将预算异议处理纳入');
    expect((await store.getScenario('scenario-1'))?.scoreItemIds).toEqual(['score-1']);
  } finally { await app.close(); }
});

it('通用诊断并修改：定量标准同步更新计分规则并保留原指标', async () => {
  const operation: Op = {
    target: 'score-item', action: 'analyze-update', subject: '需求挖掘标准',
    analysis: { category: '电销', aspect: '语速' }, fields: {},
  };
  const originalRule = {
    blocks: [{
      label: '表达流畅度', maxScore: 100,
      metrics: [{ metric: 'fluencyScore', points: [{ value: 0, score: 0 }, { value: 100, score: 100 }] }],
    }],
  } satisfies import('@grasp-mvp/core').QuantitativeRule;
  const updatedRule = {
    blocks: [
      { ...originalRule.blocks[0], maxScore: 80 },
      {
        label: '语速', maxScore: 20,
        metrics: [{ metric: 'speechRateCpm', points: [{ value: 120, score: 20 }, { value: 280, score: 100 }, { value: 480, score: 20 }] }],
      },
    ],
  };
  const response = {
    scoreItemId: 'score-1', summary: '原定量规则缺少语速指标',
    reasons: ['当前定量计分只有表达流畅度，文案修改不足以影响得分'],
    evidence: ['报告包含真实语速统计'],
    behaviorAnchorAddition: '语速：结合真实语速评价表达是否清晰适中。',
    judgePromptAddition: '语速得分由定量规则计算，评语引用语速表现。',
    quantitativeRule: updatedRule,
  };
  const { app, store } = await setup('admin', operation, analysisChatMock(operation, response));
  await seedCompletedSessionWithReport(store);
  const original = (await store.listScoreItemDefs('tenant-demo')).find((item) => item.id === 'score-1')!;
  await store.upsertScoreItemDef({ ...original, scoringMode: 'score', quantitativeRule: originalRule });
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { text: '看看上次电销评分为啥没参考语速，把语速加入评分标准', context: {} },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ commandId: string; expectedRevisions: Record<string, string> }>();
    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/voice-config',
      payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions, context: {} },
    });
    expect(applied.statusCode).toBe(200);
    const saved = (await store.listScoreItemDefs('tenant-demo')).find((item) => item.id === 'score-1')!;
    expect(saved.quantitativeRule?.blocks).toHaveLength(2);
    expect(saved.quantitativeRule?.blocks[0].maxScore).toBe(80);
    expect(saved.quantitativeRule?.blocks[0].metrics[0].metric).toBe('fluencyScore');
    expect(saved.quantitativeRule?.blocks[1].metrics[0].metric).toBe('speechRateCpm');
  } finally { await app.close(); }
});
