import { afterEach, expect, it, vi } from 'vitest';
import { MemoryStore } from '@grasp-mvp/infra';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import type { LLMGateway, Scenario, ScoreItemDef, Session } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';
import { clearScoringCache, preScoreSession, scoreSessionWithCache } from './scoring.js';

const scenario: Scenario = {
  id: 'scenario-scoring-cache',
  tenantId: 'tenant-demo',
  name: '预评分测试',
  personaConfigId: 'persona-parent',
  skillPointIds: ['sp-value'],
  successCriteria: { passScore: 60 },
  durationMinutes: 20,
  difficulty: 1,
};

const def: ScoreItemDef = {
  id: 'item-scoring-cache',
  tenantId: 'tenant-demo',
  skillPointId: 'sp-value',
  name: '回答质量',
  behaviorAnchor: '回答清晰完整',
  judgePrompt: '按档位评分',
  weight: 1,
  levels: [
    { key: 'poor', label: '差', score: 30, description: '不完整' },
    { key: 'good', label: '好', score: 90, description: '清晰完整' },
  ],
  layer: 'company',
  isObservation: false,
};

function makeSession(): Session {
  return {
    id: 'session-scoring-cache',
    tenantId: 'tenant-demo',
    userId: 'user-trainee-1',
    scenarioId: scenario.id,
    mode: 'practice',
    status: 'active',
    transcript: [
      { seq: 1, speaker: 'persona', text: '请介绍课程。', at: '2026-01-01T10:00:00Z' },
      { seq: 2, speaker: 'trainee', text: '课程通过故事和游戏培养孩子兴趣。', at: '2026-01-01T10:00:10Z' },
      { seq: 3, speaker: 'persona', text: '怎么安排试听？', at: '2026-01-01T10:00:20Z' },
      { seq: 4, speaker: 'trainee', text: '周六上午十点可以，我来安排老师。', at: '2026-01-01T10:00:30Z' },
    ],
    emotionTrace: [],
    hintsUsed: 0,
    startedAt: '2026-01-01T10:00:00Z',
  };
}

function makeGateway(count: () => void): LLMGateway {
  return {
    forTask: () => new MockLLMProvider(() => {
      count();
      return JSON.stringify({ levelKey: 'good', quote: '课程通过故事和游戏培养孩子兴趣', quoteTurnSeq: 2, rationale: '回答完整', betterScript: '' });
    }),
  };
}

afterEach(() => {
  clearScoringCache('session-scoring-cache');
  vi.useRealTimers();
});

it('主动评分立即执行并取消待执行预评分，相同快照继续复用缓存', async () => {
  vi.useFakeTimers();
  const store = new MemoryStore();
  await store.upsertScoreItemDef(def);
  let llmCalls = 0;
  const ctx = { store, gateway: makeGateway(() => { llmCalls += 1; }) } as unknown as RouteContext;
  const session = makeSession();

  preScoreSession(ctx, session, scenario);
  expect(llmCalls).toBe(0);
  const first = await scoreSessionWithCache(ctx, session, scenario);
  const callsAfterFirst = llmCalls;
  expect(callsAfterFirst).toBeGreaterThan(0);

  await vi.advanceTimersByTimeAsync(15_000);
  expect(llmCalls).toBe(callsAfterFirst);
  const cached = await scoreSessionWithCache(ctx, session, scenario);
  expect(cached.id).toBe(first.id);
  expect(llmCalls).toBe(callsAfterFirst);
});

it('连续新回合只在空闲后执行最新快照预评分', async () => {
  vi.useFakeTimers();
  const store = new MemoryStore();
  await store.upsertScoreItemDef(def);
  let llmCalls = 0;
  const ctx = { store, gateway: makeGateway(() => { llmCalls += 1; }) } as unknown as RouteContext;
  const session = makeSession();
  const updated: Session = {
    ...session,
    transcript: [
      ...session.transcript,
      { seq: 5, speaker: 'persona', text: '好的。', at: '2026-01-01T10:00:40Z' },
      { seq: 6, speaker: 'trainee', text: '谢谢，到时候见。', at: '2026-01-01T10:00:50Z' },
    ],
  };

  preScoreSession(ctx, session, scenario);
  await vi.advanceTimersByTimeAsync(5_000);
  preScoreSession(ctx, updated, scenario);
  await vi.advanceTimersByTimeAsync(14_999);
  expect(llmCalls).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(llmCalls).toBeGreaterThan(0);

  const callsAfterPreScore = llmCalls;
  await scoreSessionWithCache(ctx, updated, scenario);
  expect(llmCalls).toBe(callsAfterPreScore);
});
