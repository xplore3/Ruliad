import { expect, it } from 'vitest';
import type { LLMGateway, Scenario, Session } from '@grasp-mvp/core';
import { MemoryStore } from '@grasp-mvp/infra';
import { runTurn } from './turn.js';
import type { RouteContext } from '../ctx.js';

const now = new Date().toISOString();
const scenario: Scenario = {
  id: 'scenario-ground-child-strategy',
  tenantId: 'tenant-demo',
  name: '地推',
  personaConfigId: 'persona-parent',
  skillPointIds: ['sp-closing'],
  successCriteria: { passScore: 70 },
  durationMinutes: 20,
  difficulty: 1,
  category: '地推',
};

function gateway(effective: boolean, target: 'child' | 'parent' = 'child', prompts: string[] = []): LLMGateway {
  return {
    forTask: () => ({
      name: 'mock',
      chat: async (messages) => {
        const prompt = String(messages[0]?.content);
        prompts.push(prompt);
        if (prompt.includes('对话对象分类器')) return { content: `{"target":"${target}"}`, model: 'mock' };
        if (prompt.includes('孩子沟通策略判定器')) return { content: JSON.stringify({ effective, reason: effective ? '先情感支持，故事有趣' : '没有有效铺垫' }), model: 'mock' };
        if (prompt.includes('客户耐心判定器')) return { content: '{"offPoint":false}', model: 'mock' };
        if (prompt.includes('地推主动推进判定器')) return { content: '{"substantive":true,"reason":"继续推进"}', model: 'mock' };
        if (prompt.includes('一致性')) return { content: '{"pass":true,"reasons":[]}', model: 'mock' };
        return { content: '嗯，您接着说。', model: 'mock' };
      },
    }),
  };
}

async function setup(options: { effective: boolean; attempt?: number; resolved?: boolean; target?: 'child' | 'parent'; prompts?: string[] }) {
  const store = new MemoryStore();
  const session: Session = {
    id: `child-strategy-${options.effective}-${options.attempt ?? 0}-${options.resolved ?? false}`,
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
    childAttemptCount: options.attempt ?? 0,
    childInterestResolved: options.resolved,
    startedAt: now,
    liveStartedAt: now,
  };
  await store.createSession(session);
  const ctx = { store, gateway: gateway(options.effective, options.target, options.prompts) } as unknown as RouteContext;
  return { store, session, ctx };
}

it('无有效铺垫直接问孩子时固定回答不喜欢并记录封闭式问题', async () => {
  const { store, session, ctx } = await setup({ effective: false });
  const result = await runTurn(ctx, session, scenario, '小朋友，你喜欢吗？');
  expect(result?.childTurn?.text).toBe('我不喜欢。');
  expect(result?.traineeTurn.groundChildClosedQuestion).toBe(true);
  expect((await store.getSession(session.id))?.childInterestResolved).toBe(false);
});

it('先情感支持再讲有趣故事后提问时孩子固定回答喜欢并解决末题', async () => {
  const { store, session, ctx } = await setup({ effective: true });
  const result = await runTurn(ctx, session, scenario, '小朋友，你喜欢吗？');
  expect(result?.childTurn?.text).toBe('我喜欢！');
  expect(result?.traineeTurn.groundChildClosedQuestion).toBeUndefined();
  expect((await store.getSession(session.id))?.childInterestResolved).toBe(true);
});

it('第二次仍不能合理说服孩子时记为卖邀请函失败', async () => {
  const { store, session, ctx } = await setup({ effective: false, attempt: 1 });
  const result = await runTurn(ctx, session, scenario, '你就说喜欢还是不喜欢？');
  expect(result?.timeUp).toBe(true);
  const saved = await store.getSession(session.id);
  expect(saved?.completionStatus).toBe('incomplete');
  expect(saved?.completionReason).toContain('卖邀请函失败');
});

it('提前解决孩子兴趣后向客户注入六连问末题替换规则', async () => {
  const prompts: string[] = [];
  const { session, ctx } = await setup({ effective: true, resolved: true, target: 'parent', prompts });
  const result = await runTurn(ctx, session, scenario, '来，您拿上邀请函，我给您介绍一下活动。');
  expect(result?.timeUp).toBe(false);
  expect(result?.personaTurn?.text).toBe('嗯，您接着说。');
  expect(prompts.some((prompt) => prompt.includes('六连问末题替换') && prompt.includes('孩子学的太多了') && prompt.includes('不得重复'))).toBe(true);
});

it('讲故事征求意见不算封闭式问题，孩子固定回答不想学', async () => {
  const { store, session, ctx } = await setup({ effective: false });
  const result = await runTurn(ctx, session, scenario, '小朋友，我给你讲个故事好不好啊？');
  expect(result?.childTurn?.text).toBe('我不想学。');
  expect(result?.traineeTurn.groundChildClosedQuestion).toBeUndefined();
  expect((await store.getSession(session.id))?.childStoryOffered).toBe(true);
});

it('讲故事征求意见后第二次仍无效时触发家长离开', async () => {
  const { store, session, ctx } = await setup({ effective: false, attempt: 1 });
  await runTurn(ctx, session, scenario, '小朋友，我给你讲个故事好不好啊？');
  const result = await runTurn(ctx, session, scenario, '那你到底想不想学？');
  expect(result?.timeUp).toBe(true);
  const saved = await store.getSession(session.id);
  expect(saved?.completionStatus).toBe('incomplete');
  expect(saved?.completionReason).toContain('卖邀请函失败');
});
