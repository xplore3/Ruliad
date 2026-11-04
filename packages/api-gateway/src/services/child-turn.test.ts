import { describe, expect, it } from 'vitest';
import type { LLMGateway, Scenario, Session } from '@grasp-mvp/core';
import { MemoryStore } from '@grasp-mvp/infra';
import { runTurn } from './turn.js';
import type { RouteContext } from '../ctx.js';

const now = new Date().toISOString();
const scenario: Scenario = {
  id: 'scenario-ground',
  tenantId: 'tenant-demo',
  name: '地推',
  personaConfigId: 'persona-parent',
  skillPointIds: ['sp-closing'],
  successCriteria: { passScore: 70 },
  durationMinutes: 20,
  difficulty: 1,
};

function gateway(childReply: string): LLMGateway {
  return {
    forTask: () => ({
      name: 'mock',
      chat: async (messages) => ({
        content: String(messages[0]?.content).includes('对话对象分类器') ? '{"target":"child"}' : childReply,
        model: 'mock',
      }),
    }),
  };
}

async function setup(childAttemptCount: number, childReply: string) {
  const store = new MemoryStore();
  const session: Session = {
    id: `child-attempt-${childAttemptCount}`,
    tenantId: 'tenant-demo',
    userId: 'user-1',
    scenarioId: scenario.id,
    mode: 'practice',
    status: 'active',
    transcript: [
      { seq: 1, speaker: 'persona', text: '宝贝，你想去吗？', at: now },
      { seq: 2, speaker: 'child', text: '不想去。', at: now },
    ],
    emotionTrace: [],
    hintsUsed: 0,
    childMode: true,
    childAttemptCount,
    startedAt: now,
    liveStartedAt: now,
  };
  await store.createSession(session);
  const ctx = { store, gateway: gateway(childReply) } as unknown as RouteContext;
  return { store, session, ctx };
}

describe('孩子沟通两轮机会', () => {
  it('第一轮仍抗拒时继续沟通并记录一轮', async () => {
    const { store, session, ctx } = await setup(0, '我不想玩。[[RESIST]]');
    const result = await runTurn(ctx, session, scenario, '我们直接去玩围棋好不好？');
    expect(result?.timeUp).toBe(false);
    expect(result?.childTurn?.text).toBe('我不想玩。');
    expect((await store.getSession(session.id))?.childAttemptCount).toBe(1);
  });

  it('第二轮仍抗拒时家长离场并强制结束', async () => {
    const { store, session, ctx } = await setup(1, '我还是不想去。[[RESIST]]');
    const result = await runTurn(ctx, session, scenario, '你再考虑一下，我们去玩围棋好不好？');
    expect(result?.timeUp).toBe(true);
    expect(result?.personaTurn?.text).toContain('我们先走了');
    expect(result?.childTurn).toBeUndefined();
    const saved = await store.getSession(session.id);
    expect(saved?.childAttemptCount).toBe(2);
    expect(saved?.childMode).toBe(false);
    expect(saved?.transcript.at(-1)?.speaker).toBe('persona');
  });

  it('第二轮已松动时不强制结束', async () => {
    const { session, ctx } = await setup(1, '哈哈，我想继续玩！[[OPEN]]');
    const result = await runTurn(ctx, session, scenario, '先尊重你的想法，再给你讲个搞笑故事，好不好？');
    expect(result?.timeUp).toBe(false);
    expect(result?.childTurn?.text).toBe('哈哈，我想继续玩！');
  });
});
