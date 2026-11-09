import { expect, it } from 'vitest';
import type { LLMGateway, Scenario, Session } from '@grasp-mvp/core';
import { MemoryStore } from '@grasp-mvp/infra';
import { runTurn } from './turn.js';
import type { RouteContext } from '../ctx.js';

const now = new Date().toISOString();
const scenario: Scenario = {
  id: 'scenario-turn-streaming',
  tenantId: 'tenant-demo',
  name: '地推',
  personaConfigId: 'persona-parent',
  skillPointIds: [],
  successCriteria: { passScore: 70 },
  durationMinutes: 20,
  difficulty: 1,
  category: '地推',
};

async function makeCtx(gateway: LLMGateway, session: Session) {
  const store = new MemoryStore();
  await store.createSession(session);
  return { store, ctx: { store, gateway } as unknown as RouteContext };
}

function makeSession(id: string): Session {
  return {
    id,
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
}

it('最终文本匹配的预测草稿直接复用，不再调用 actor 或重新合成首句', async () => {
  const warmupAudio = Buffer.from('warmup');
  let actorCalls = 0;
  let ttsCalls = 0;
  const gateway: LLMGateway = {
    forTask: () => ({
      name: 'mock',
      chat: async (messages) => {
        const prompt = String(messages[0]?.content);
        if (prompt.includes('地推主动推进判定器')) return { content: '{"substantive":true,"reason":"正在推进"}', model: 'mock' };
        if (prompt.includes('一致性审查员')) return { content: '{"pass":true,"reason":""}', model: 'mock' };
        actorCalls += 1;
        return { content: '不应重新生成。', model: 'mock' };
      },
    }),
  };
  const session = makeSession('session-precomputed-reply');
  const { ctx } = await makeCtx(gateway, session);
  const result = await runTurn(ctx, session, scenario, '您好，我在做少儿围棋活动介绍。', undefined, async () => {
    ttsCalls += 1;
    return null;
  }, {
    text: '好的，我了解一下。',
    shouldClose: false,
    asksChild: false,
    warmupAudio,
    warmupFormat: 'wav',
  });

  expect(result?.personaTurn?.text).toBe('好的，我了解一下。');
  expect(result?.warmupAudio).toBe(warmupAudio);
  expect(actorCalls).toBe(0);
  expect(ttsCalls).toBe(0);
});

it('流式 actor 生成第一个完整句时立即启动首句 TTS', async () => {
  const events: string[] = [];
  const gateway: LLMGateway = {
    forTask: () => ({
      name: 'mock-stream',
      chat: async (messages) => {
        const prompt = String(messages[0]?.content);
        if (prompt.includes('地推主动推进判定器')) return { content: '{"substantive":true,"reason":"正在推进"}', model: 'mock' };
        return { content: '{"pass":true,"reason":""}', model: 'mock' };
      },
      chatStream: async (_messages, _options, onDelta) => {
        onDelta?.('好的。', '好的。');
        await new Promise((resolve) => setTimeout(resolve, 5));
        onDelta?.('我了解一下。', '好的。我了解一下。');
        events.push('actor-done');
        return { content: '好的。我了解一下。', model: 'mock-stream' };
      },
    }),
  };
  const session = makeSession('session-streaming-reply');
  const { ctx } = await makeCtx(gateway, session);
  const result = await runTurn(ctx, session, scenario, '您好，我在做少儿围棋活动介绍。', undefined, async (text) => {
    events.push(`tts:${text}`);
    return { audio: Buffer.from('first-sentence'), format: 'wav' };
  });

  expect(events[0]).toBe('tts:好的。');
  expect(events[1]).toBe('actor-done');
  expect(result?.personaTurn?.text).toBe('好的。我了解一下。');
  expect(result?.warmupAudio?.toString()).toBe('first-sentence');
});
