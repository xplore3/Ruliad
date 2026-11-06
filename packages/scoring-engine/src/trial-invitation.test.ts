import { expect, it } from 'vitest';
import type { Scenario, ScoreItemDef, Session } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { analyzeReceptionTrialInvitation } from './trial-invitation.js';
import { judgeItem } from './judge.js';

function makeSession(text: string): Session {
  return {
    id: 'session-trial-invitation',
    tenantId: 'tenant-demo',
    userId: 'user-trainee-1',
    scenarioId: 'scenario-reception',
    mode: 'practice',
    status: 'completed',
    transcript: [{ seq: 1, speaker: 'trainee', text, at: '2026-01-01T10:00:00Z' }],
    emotionTrace: [],
    hintsUsed: 0,
    startedAt: '2026-01-01T10:00:00Z',
  };
}

it.each([
  '您想让孩子试听吗？',
  '要不要试听？',
  '需要我给您安排试听课吗？',
  '可以带孩子来试听吗？',
])('封闭式试听邀约“%s”全局扣5分', (text) => {
  const result = analyzeReceptionTrialInvitation(makeSession(text));
  expect(result.deduction).toBe(5);
  expect(result.rationale).toContain('您什么时候方便试听？我给您安排。');
});

it.each([
  '您什么时候方便试听？我给您安排。',
  '您看周六还是周日方便，我给您安排试听。',
  '我们有免费试听课，您可以带孩子参加。',
  '试听课多长时间？',
])('非封闭式邀约“%s”不扣分', (text) => {
  expect(analyzeReceptionTrialInvitation(makeSession(text)).deduction).toBe(0);
});

it('咨询接待忌讳项追加封闭式试听邀约5分', async () => {
  const scenario: Scenario = {
    id: 'scenario-reception',
    tenantId: 'tenant-demo',
    name: '咨询接待',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-compliance'],
    successCriteria: { passScore: 70 },
    durationMinutes: 25,
    difficulty: 1,
    category: '咨询接待',
  };
  const def: ScoreItemDef = {
    id: 'reception-taboo',
    tenantId: 'tenant-demo',
    skillPointId: 'sp-compliance',
    name: '咨询接待忌讳事项',
    behaviorAnchor: '独立扣分项',
    judgePrompt: '其他忌讳',
    weight: 0,
    levels: [],
    layer: 'company',
    isObservation: false,
    category: '咨询接待',
    scoringMode: 'score',
    deductionOnly: true,
  };
  const result = await judgeItem(def, makeSession('您想让孩子试听吗？'), {
    forTask: () => new MockLLMProvider(() => JSON.stringify({ score: 0, rationale: '其他忌讳未触犯' })),
  }, scenario);
  expect(result.score).toBe(5);
  expect(result.rationale).toContain('全局扣5分');
  expect(result.betterScript).toContain('您什么时候方便试听？我给您安排。');
});
