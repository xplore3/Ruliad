import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { MemoryStore } from '@grasp-mvp/infra';
import type { Scenario } from '@grasp-mvp/core';
import { resourceAiRoutes } from './resource-ai.js';
import type { RouteContext } from '../ctx.js';

async function setup(role: 'admin' | 'trainee' = 'admin', patch: Record<string, unknown> = { name: '语音修改后的场景' }) {
  const store = new MemoryStore();
  await store.savePersonaConfig({
    id: 'persona-1', tenantId: 'tenant-demo', name: '客户', background: '客户背景', elementIds: [],
    behaviorBands: [{ key: 'calm', minArousal: 0, maxArousal: 1, instruction: '自然回应' }],
    knowledgeBoundary: { mustNotKnow: [], loadedKnowledge: [] }, version: 1,
  });
  await store.saveSkillPoint({ id: 'skill-1', tenantId: 'tenant-demo', name: '需求挖掘' });
  await store.upsertScoreItemDef({
    id: 'score-1', tenantId: 'tenant-demo', skillPointId: 'skill-1', name: '需求挖掘标准', behaviorAnchor: '',
    judgePrompt: '', weight: 1, levels: [{ key: 'pass', label: '达标', score: 100, description: '' }],
    layer: 'company', isObservation: false, category: '电销',
  });
  const scenario: Scenario = {
    id: 'scenario-1', tenantId: 'tenant-demo', name: '原场景', personaConfigId: 'persona-1',
    skillPointIds: ['skill-1'], scoreItemIds: ['score-1'], successCriteria: { passScore: 60 },
    durationMinutes: 10, difficulty: 1, category: '电销', flowType: 'generic', status: 'published', version: 1,
  };
  await store.saveScenario(scenario);
  await store.saveScenario({ ...scenario, id: 'scenario-other', tenantId: 'tenant-other' });

  const chat = vi.fn(async () => ({ model: 'mock', content: JSON.stringify({ reply: '已生成', patch }) }));
  const transcribe = vi.fn(async () => '把场景名称改为语音修改后的场景');
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
  await app.register((instance) => resourceAiRoutes(instance, ctx), { prefix: '/api/v1' });
  return { app, store, chat, transcribe };
}

it('admin 预览并应用场景修改，过期预览不会覆盖后续修改', async () => {
  const { app, store } = await setup();
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'scenario', id: 'scenario-1', text: '修改名称' },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ patch: Record<string, unknown>; expectedRevision: string; commandId: string }>();
    expect(body.patch).toEqual({ name: '语音修改后的场景' });

    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'scenario', id: 'scenario-1', patch: body.patch, expectedRevision: body.expectedRevision, commandId: body.commandId, apply: true },
    });
    expect(applied.statusCode).toBe(200);
    const saved = await store.getScenario('scenario-1');
    expect(saved?.name).toBe('语音修改后的场景');
    expect(saved?.version).toBe(2);
    expect(saved?.updatedBy).toBe('admin-1');

    const stale = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'scenario', id: 'scenario-1', patch: { name: '覆盖他人' }, expectedRevision: body.expectedRevision, commandId: body.commandId, apply: true },
    });
    expect(stale.statusCode).toBe(409);
    expect((await store.getScenario('scenario-1'))?.name).toBe('语音修改后的场景');
  } finally { await app.close(); }
});

it('语音输入经 ASR 生成预览，但不直接落库', async () => {
  const { app, store, transcribe } = await setup();
  try {
    const boundary = '----resource-ai-test';
    const payload = Buffer.from([
      `--${boundary}\r\nContent-Disposition: form-data; name="target"\r\n\r\nscenario\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="id"\r\n\r\nscenario-1\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      'audio',
      `\r\n--${boundary}--\r\n`,
    ].join(''));
    const response = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit', payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().transcript).toBe('把场景名称改为语音修改后的场景');
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect((await store.getScenario('scenario-1'))?.name).toBe('原场景');
  } finally { await app.close(); }
});

it('普通用户的共享修改只进入待处理队列，跨租户资源返回 404', async () => {
  const { app, store } = await setup('trainee');
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'scenario', id: 'scenario-1', text: '修改共享场景' },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{ commandId: string; expectedRevision: string; patch: Record<string, unknown>; general: boolean }>();
    expect(body.general).toBe(true);
    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'scenario', id: 'scenario-1', patch: body.patch, expectedRevision: body.expectedRevision, commandId: body.commandId, apply: true },
    });
    expect(applied.statusCode).toBe(202);
    expect(applied.json().pendingReview).toBe(true);
    expect((await store.getScenario('scenario-1'))?.name).toBe('原场景');
    const commands = await store.listVoiceEditCommands({ tenantId: 'tenant-demo', userId: 'trainee-1', general: true });
    expect(commands).toHaveLength(1);
    expect(commands[0].status).toBe('pending_review');
  } finally { await app.close(); }

  const admin = await setup();
  try {
    const missing = await admin.app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'scenario', id: 'scenario-other', text: '修改' },
    });
    expect(missing.statusCode).toBe(404);
  } finally { await admin.app.close(); }
});

it('同一语音链路也能新建资源库条目', async () => {
  const { app, store } = await setup('admin', { name: '价值表达', description: '讲清客户价值' });
  try {
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'skill-point', text: '新增价值表达技能点' },
    });
    const body = preview.json<{ patch: Record<string, unknown>; expectedRevision: string; commandId: string }>();
    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'skill-point', patch: body.patch, expectedRevision: body.expectedRevision, commandId: body.commandId, apply: true },
    });
    expect(applied.statusCode).toBe(200);
    expect((await store.listSkillPoints('tenant-demo')).some((item) => item.name === '价值表达')).toBe(true);
  } finally { await app.close(); }
});


it('普通用户可直接修改自己创建的场景，命令标记为已应用', async () => {
  const { app, store } = await setup('trainee');
  try {
    const current = await store.getScenario('scenario-1');
    await store.saveScenario({ ...current!, createdBy: 'trainee-1' });
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'scenario', id: 'scenario-1', text: '修改自己的场景' },
    });
    const body = preview.json<{ commandId: string; expectedRevision: string; patch: Record<string, unknown>; general: boolean }>();
    expect(body.general).toBe(false);
    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'scenario', id: 'scenario-1', patch: body.patch, expectedRevision: body.expectedRevision, commandId: body.commandId, apply: true },
    });
    expect(applied.statusCode).toBe(200);
    expect((await store.getScenario('scenario-1'))?.name).toBe('语音修改后的场景');
    expect((await store.getVoiceEditCommand(body.commandId))?.status).toBe('applied');
  } finally { await app.close(); }
});

it('admin 的通用修改也进入统一队列，可记录处理结果', async () => {
  const { app, store, chat } = await setup();
  try {
    chat.mockResolvedValueOnce({
      model: 'mock',
      content: JSON.stringify({ reply: '通用问题', patch: { description: '建议统一话术规范' }, general: true, generalReason: '涉及所有场景的通用规范' }),
    });
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'scenario', id: 'scenario-1', text: '希望所有场景都统一规范' },
    });
    const body = preview.json<{ commandId: string; expectedRevision: string; patch: Record<string, unknown> }>();
    const applied = await app.inject({
      method: 'POST', url: '/api/v1/library/ai-edit',
      payload: { target: 'scenario', id: 'scenario-1', patch: body.patch, expectedRevision: body.expectedRevision, commandId: body.commandId, apply: true },
    });
    expect(applied.statusCode).toBe(202);
    expect((await store.getScenario('scenario-1'))?.description).toBeUndefined();
    const reviewed = await app.inject({
      method: 'PATCH', url: `/api/v1/voice-edit-commands/${body.commandId}`,
      payload: { status: 'resolved', reviewNote: '已纳入统一规范' },
    });
    expect(reviewed.statusCode).toBe(200);
    expect((await store.getVoiceEditCommand(body.commandId))?.status).toBe('resolved');
  } finally { await app.close(); }
});
