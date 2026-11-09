import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { MemoryStore } from '@grasp-mvp/infra';
import type { PersonaConfig, ProductKB, Scenario } from '@grasp-mvp/core';
import { voiceConfigRoutes } from './voice-config.js';
import type { RouteContext } from '../ctx.js';

interface Op {
  target: string;
  action: 'create' | 'update';
  subject: string;
  resourceName?: string;
  fields?: Record<string, unknown>;
  persona?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  general?: boolean;
  generalReason?: string;
}

async function setup(
  role: 'admin' | 'trainee' = 'admin',
  operation: Op = { target: 'scenario', action: 'update', subject: '原场景', fields: { name: '语音修改后的场景' } }
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

  const chat = vi.fn(async () => ({
    model: 'mock',
    content: JSON.stringify({ reply: '已生成', operations: [operation] }),
  }));
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
