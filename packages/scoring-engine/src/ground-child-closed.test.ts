import { expect, it } from 'vitest';
import type { Scenario, ScoreItemDef, Session } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { analyzeGroundChildClosedQuestions } from './ground-child-closed.js';
import { judgeItem } from './judge.js';

function makeSession(): Session {
  return {
    id: 'ground-child-closed',
    tenantId: 'tenant-demo',
    userId: 'user-1',
    scenarioId: 'scenario-ground',
    mode: 'practice',
    status: 'completed',
    transcript: [
      { seq: 1, speaker: 'trainee', text: '小朋友，你喜欢吗？', addressedToChild: true, groundChildClosedQuestion: true, at: '2026-01-01T10:00:00Z' },
      { seq: 2, speaker: 'child', text: '我不喜欢。', at: '2026-01-01T10:00:01Z' },
      { seq: 3, speaker: 'trainee', text: '先尊重和鼓励孩子，再讲有趣故事。', addressedToChild: true, at: '2026-01-01T10:00:02Z' },
    ],
    emotionTrace: [],
    hintsUsed: 0,
    startedAt: '2026-01-01T10:00:00Z',
  };
}

it('无铺垫问孩子按每次10分扣地推忌讳，有铺垫提问不扣分', () => {
  const result = analyzeGroundChildClosedQuestions(makeSession());
  expect(result.deduction).toBe(10);
  expect(result.rationale).toContain('第1轮');
  expect(result.rationale).toContain('封闭式提问');
});

it('地推忌讳项追加孩子封闭式问题扣分', async () => {
  const scenario: Scenario = {
    id: 'scenario-ground',
    tenantId: 'tenant-demo',
    name: '地推',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-compliance'],
    successCriteria: { passScore: 70 },
    durationMinutes: 20,
    difficulty: 1,
    category: '地推',
  };
  const def: ScoreItemDef = {
    id: 'ground-taboo',
    tenantId: 'tenant-demo',
    skillPointId: 'sp-compliance',
    name: '地推销售忌讳',
    behaviorAnchor: '孩子封闭式问题每次扣10分',
    judgePrompt: '其他忌讳',
    weight: 0,
    levels: [],
    layer: 'company',
    isObservation: false,
    category: '地推',
    scoringMode: 'score',
    deductionOnly: true,
  };
  const result = await judgeItem(def, makeSession(), {
    forTask: () => new MockLLMProvider(() => JSON.stringify({ score: 0, rationale: '其他忌讳未触犯' })),
  }, scenario);
  expect(result.score).toBe(10);
  expect(result.rationale).toContain('孩子沟通');
  expect(result.betterScript).toContain('先尊重和鼓励孩子');
});
