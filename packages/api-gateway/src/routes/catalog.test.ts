import { expect, it } from 'vitest';
import Fastify from 'fastify';
import { MemoryStore } from '@grasp-mvp/infra';
import { catalogRoutes } from './catalog.js';
import { sessionsRoutes } from './sessions.js';
import type { RouteContext } from '../ctx.js';

async function setup(role: 'admin' | 'trainee' = 'admin') {
  const store = new MemoryStore();
  await store.saveSkillPoint({ id: 'skill-1', tenantId: 'tenant-demo', name: '需求挖掘' });
  await store.upsertScoreItemDef({
    id: 'score-1', tenantId: 'tenant-demo', skillPointId: 'skill-1', name: '需求挖掘', behaviorAnchor: '',
    judgePrompt: '', weight: 1, levels: [{ key: 'pass', label: '达标', score: 100, description: '' }],
    layer: 'company', isObservation: false, category: '电销',
  });
  await store.saveDrillScript({ id: 'drill-1', tenantId: 'tenant-demo', category: '电销', name: '电销剧本', content: '销售：您好' });
  const app = Fastify();
  let currentUserId = role === 'admin' ? 'admin-1' : 'trainee-1';
  app.addHook('onRequest', async (request) => {
    request.userId = currentUserId;
    request.userRole = role;
    request.tenantId = 'tenant-demo';
  });
  const ctx = {
    store,
    gateway: { forTask: () => ({ chat: async () => ({ model: 'mock', content: '{"firstSpeaker":"trainee","openingLine":""}' }) }) },
  } as unknown as RouteContext;
  await app.register((instance) => catalogRoutes(instance, ctx), { prefix: '/api/v1' });
  await app.register((instance) => sessionsRoutes(instance, ctx), { prefix: '/api/v1' });
  return { app, store, setUser: (userId: string) => { currentUserId = userId; } };
}

it('完整创建角色和可发布场景，并能创建真实练习会话', async () => {
  const { app, store } = await setup();
  try {
    const personaResponse = await app.inject({
      method: 'POST', url: '/api/v1/persona-configs',
      payload: {
        name: '采购经理', background: '重视预算与数据', occupation: '采购经理', industry: '零售',
        personalityTags: ['谨慎'], decisionStyle: '理性比较，需要数据佐证', objections: ['价格太高'], hiddenInfo: ['预算上限'],
        behaviorBands: [{ key: 'calm', minArousal: 0, maxArousal: 1, instruction: '自然回应' }],
      },
    });
    expect(personaResponse.statusCode).toBe(201);
    const persona = personaResponse.json<{ id: string; industry?: string }>();
    expect(persona.industry).toBe('零售');

    const created = await app.inject({
      method: 'POST', url: '/api/v1/scenarios',
      payload: {
        name: '首次电话邀约', personaConfigId: persona.id, skillPointIds: ['skill-1'], scoreItemIds: ['score-1'],
        drillScriptId: 'drill-1', category: '电销', flowType: 'generic', passScore: 80, durationMinutes: 12,
        difficulty: 2, sceneType: 'practical', status: 'published', script: { purpose: '获得下一步沟通机会' },
        conversation: { speechRate: 2, challenge: 3, interruptLevel: 'weak' },
      },
    });
    expect(created.statusCode).toBe(201);
    const scenario = created.json<ScenarioResponse>();
    expect(scenario.category).toBe('电销');
    expect(scenario.scoreItemIds).toEqual(['score-1']);
    expect(scenario.version).toBe(1);

    const conflict = await app.inject({
      method: 'PUT', url: `/api/v1/scenarios/${scenario.id}`,
      payload: { expectedVersion: 0, name: '不应覆盖' },
    });
    expect(conflict.statusCode).toBe(409);

    const updated = await app.inject({
      method: 'PUT', url: `/api/v1/scenarios/${scenario.id}`,
      payload: { expectedVersion: 1, passScore: 85 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);
    expect(updated.json().successCriteria.passScore).toBe(85);

    const session = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload: { scenarioId: scenario.id } });
    expect(session.statusCode).toBe(201);
    expect(session.json().session.scenarioId).toBe(scenario.id);
    expect(session.json().remainingSeconds).toBe(720);
    expect((await store.getSession(session.json().session.id))?.userId).toBe('admin-1');
  } finally { await app.close(); }
});

interface ScenarioResponse {
  id: string;
  category: string;
  scoreItemIds: string[];
  version: number;
}

it('普通用户不能修改共享角色，未发布场景不对普通用户展示', async () => {
  const { app, store } = await setup('trainee');
  try {
    const persona = await store.getPersonaConfig('missing');
    expect(persona).toBeUndefined();
    await store.savePersonaConfig({
      id: 'persona-1', tenantId: 'tenant-demo', name: '客户', background: '背景', elementIds: [],
      behaviorBands: [{ key: 'calm', minArousal: 0, maxArousal: 1, instruction: '回应' }],
      knowledgeBoundary: { mustNotKnow: [], loadedKnowledge: [] }, version: 1,
    });
    await store.saveScenario({
      id: 'draft-1', tenantId: 'tenant-demo', name: '草稿', personaConfigId: 'persona-1', skillPointIds: ['skill-1'],
      scoreItemIds: ['score-1'], successCriteria: { passScore: 60 }, durationMinutes: 10, difficulty: 1,
      category: '电销', flowType: 'generic', status: 'draft', version: 1,
    });
    const customize = await app.inject({ method: 'PATCH', url: '/api/v1/persona-configs/persona-1/customize', payload: { background: '越权修改' } });
    expect(customize.statusCode).toBe(403);
    expect((await store.getPersonaConfig('persona-1'))?.background).toBe('背景');
  } finally { await app.close(); }

  const trainee = await setup('trainee');
  try {
    await trainee.store.savePersonaConfig({
      id: 'persona-1', tenantId: 'tenant-demo', name: '客户', background: '背景', elementIds: [],
      behaviorBands: [{ key: 'calm', minArousal: 0, maxArousal: 1, instruction: '回应' }],
      knowledgeBoundary: { mustNotKnow: [], loadedKnowledge: [] }, version: 1,
    });
    await trainee.store.saveScenario({
      id: 'draft-1', tenantId: 'tenant-demo', name: '草稿', personaConfigId: 'persona-1', skillPointIds: ['skill-1'],
      scoreItemIds: ['score-1'], successCriteria: { passScore: 60 }, durationMinutes: 10, difficulty: 1,
      category: '电销', flowType: 'generic', status: 'draft', version: 1,
    });
    const list = await trainee.app.inject({ method: 'GET', url: '/api/v1/scenarios' });
    expect(list.json().scenarios).toEqual([]);
  } finally { await trainee.app.close(); }
});


it('普通用户可创建和修改自己的场景，其他用户不能覆盖', async () => {
  const { app, store, setUser } = await setup('trainee');
  try {
    const personaResponse = await app.inject({
      method: 'POST', url: '/api/v1/persona-configs',
      payload: {
        name: '私有客户', background: '个人场景角色',
        behaviorBands: [{ key: 'calm', minArousal: 0, maxArousal: 1, instruction: '回应' }],
      },
    });
    expect(personaResponse.statusCode).toBe(201);
    expect(personaResponse.json().createdBy).toBe('trainee-1');
    const created = await app.inject({
      method: 'POST', url: '/api/v1/scenarios',
      payload: {
        name: '我的场景', personaConfigId: personaResponse.json().id, skillPointIds: ['skill-1'], scoreItemIds: ['score-1'],
        category: '电销', flowType: 'generic', passScore: 60, durationMinutes: 10, difficulty: 1, status: 'published',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().createdBy).toBe('trainee-1');
    const scenarioId = created.json().id;

    setUser('trainee-2');
    const forbidden = await app.inject({
      method: 'PUT', url: `/api/v1/scenarios/${scenarioId}`,
      payload: { expectedVersion: 1, name: '他人修改' },
    });
    expect(forbidden.statusCode).toBe(403);
    expect((await store.getScenario(scenarioId))?.name).toBe('我的场景');

    setUser('trainee-1');
    const updated = await app.inject({
      method: 'PUT', url: `/api/v1/scenarios/${scenarioId}`,
      payload: { expectedVersion: 1, name: '本人修改' },
    });
    expect(updated.statusCode).toBe(200);
    expect((await store.getScenario(scenarioId))?.name).toBe('本人修改');
  } finally { await app.close(); }
});
