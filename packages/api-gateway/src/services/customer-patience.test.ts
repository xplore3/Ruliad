import { expect, it } from 'vitest';
import type { LLMGateway, Scenario, Session } from '@grasp-mvp/core';
import { MemoryStore } from '@grasp-mvp/infra';
import { runTurn } from './turn.js';
import type { RouteContext } from '../ctx.js';

it('销售明显跑题时客户离场并强制结束演练', async () => {
  const now = new Date().toISOString();
  const store = new MemoryStore();
  const scenario: Scenario = {
    id: 'scenario-ground',
    tenantId: 'tenant-demo',
    name: '地推',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-closing'],
    successCriteria: { passScore: 70 },
    durationMinutes: 20,
    difficulty: 1,
    category: '地推',
  };
  const session: Session = {
    id: 'session-off-point',
    tenantId: 'tenant-demo',
    userId: 'user-1',
    scenarioId: scenario.id,
    mode: 'practice',
    status: 'active',
    transcript: [],
    emotionTrace: [],
    hintsUsed: 0,
    startedAt: now,
    liveStartedAt: now,
  };
  await store.createSession(session);
  const gateway: LLMGateway = {
    forTask: () => ({
      name: 'mock',
      chat: async (messages) => ({
        content: String(messages[0]?.content).includes('客户耐心判定器')
          ? '{"offPoint":true,"reason":"持续聊与演练无关的足球"}'
          : '嗯，您接着说。',
        model: 'mock',
      }),
    }),
  };
  const ctx = { store, gateway } as unknown as RouteContext;
  const result = await runTurn(ctx, session, scenario, 'C罗那个任意球真的太漂亮了，你觉得他以前那个队友怎么样？');

  expect(result?.timeUp).toBe(true);
  expect(result?.personaTurn?.text).toContain('先走了');
  expect((await store.getSession(session.id))?.transcript.at(-1)?.speaker).toBe('persona');
});

it('咨询接待不运行地推跑题强制离场判定', async () => {
  const now = new Date().toISOString();
  const store = new MemoryStore();
  const scenario: Scenario = {
    id: 'scenario-reception',
    tenantId: 'tenant-demo',
    name: '咨询接待',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-need'],
    successCriteria: { passScore: 70 },
    durationMinutes: 20,
    difficulty: 1,
    category: '咨询接待',
  };
  const session: Session = {
    id: 'session-reception-opening',
    tenantId: 'tenant-demo',
    userId: 'user-1',
    scenarioId: scenario.id,
    mode: 'practice',
    status: 'active',
    transcript: [],
    emotionTrace: [],
    hintsUsed: 0,
    startedAt: now,
    liveStartedAt: now,
  };
  await store.createSession(session);
  const gateway: LLMGateway = {
    forTask: () => ({
      name: 'mock',
      chat: async (messages) => {
        const prompt = String(messages[0]?.content);
        if (prompt.includes('客户耐心判定器')) throw new Error('咨询接待误调用了地推判定器');
        if (prompt.includes('一致性')) return { content: '{"pass":true,"reasons":[]}', model: 'mock' };
        return { content: '您好，很高兴为您服务。', model: 'mock' };
      },
    }),
  };
  const ctx = { store, gateway } as unknown as RouteContext;
  const result = await runTurn(ctx, session, scenario, '您好，文杰围棋，有什么能帮您的？');

  expect(result?.timeUp).toBe(false);
  expect(result?.personaTurn?.text).not.toContain('先走了');
  expect(result?.personaTurn?.text).toContain('很高兴');
});
