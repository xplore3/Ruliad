import { expect, it } from 'vitest';
import type { LLMGateway, Scenario, Session } from '@grasp-mvp/core';
import { MemoryStore } from '@grasp-mvp/infra';
import { runTurn } from './turn.js';
import type { RouteContext } from '../ctx.js';

async function setup(lastChance: boolean, substantive: boolean) {
  const now = new Date().toISOString();
  const store = new MemoryStore();
  const scenario: Scenario = {
    id: 'scenario-ground-progress',
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
    id: `session-ground-progress-${lastChance}-${substantive}`,
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
    groundPushLastChance: lastChance,
  };
  await store.createSession(session);
  const gateway: LLMGateway = {
    forTask: () => ({
      name: 'mock',
      chat: async (messages) => {
        const prompt = String(messages[0]?.content);
        if (prompt.includes('客户耐心判定器')) return { content: '{"offPoint":false}', model: 'mock' };
        if (prompt.includes('地推主动推进判定器')) return { content: JSON.stringify({ substantive, reason: substantive ? '明确引导填写信息并支付' : '只有空泛邀请，没有当场行动' }), model: 'mock' };
        if (prompt.includes('一致性')) return { content: '{"pass":true,"reasons":[]}', model: 'mock' };
        return { content: '嗯，您接着说。', model: 'mock' };
      },
    }),
  };
  return { store, session, scenario, ctx: { store, gateway } as unknown as RouteContext };
}

it('首次缺乏实质推进时客户给最后机会，不结束演练', async () => {
  const { store, session, scenario, ctx } = await setup(false, false);
  const result = await runTurn(ctx, session, scenario, '我们老师都很有经验，您可以过来看看。');
  expect(result?.timeUp).toBe(false);
  expect(result?.personaTurn?.text).toBe('好的，我回去琢磨琢磨。');
  const saved = await store.getSession(session.id);
  expect(saved?.groundPushLastChance).toBe(true);
  expect(saved?.completionStatus).toBeUndefined();
});

it('最后机会后仍无实质推进时强制结束并记为未完成', async () => {
  const { store, session, scenario, ctx } = await setup(true, false);
  const result = await runTurn(ctx, session, scenario, '好的，那您回去考虑一下吧。');
  expect(result?.timeUp).toBe(true);
  expect(result?.personaTurn?.text).toContain('先走了');
  const saved = await store.getSession(session.id);
  expect(saved?.completionStatus).toBe('incomplete');
  expect(saved?.completionReason).toContain('最后推进机会');
  expect(saved?.completionReason).toContain('没有当场行动');
});

it('最后机会后作出实质成交动作时继续演练', async () => {
  const { store, session, scenario, ctx } = await setup(true, true);
  const result = await runTurn(ctx, session, scenario, '来，您拿上邀请函，在这边填一下姓名和电话，您是微信还是支付宝？');
  expect(result?.timeUp).toBe(false);
  expect(result?.personaTurn?.text).toBe('嗯，您接着说。');
  const saved = await store.getSession(session.id);
  expect(saved?.completionStatus).toBeUndefined();
});
