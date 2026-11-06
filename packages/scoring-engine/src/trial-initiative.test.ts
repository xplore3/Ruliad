import { expect, it } from 'vitest';
import { RECEPTION_QUESTION_POOL, type Scenario, type ScoreItemDef, type Session } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { judgeItem } from './judge.js';
import { analyzeReceptionTrialInvitation } from './trial-invitation.js';

const scenario: Scenario = {
  id: 'scenario-drill-inquiry',
  tenantId: 'tenant-demo',
  name: '咨询接待',
  personaConfigId: 'persona-parent',
  skillPointIds: ['sp-closing'],
  successCriteria: { passScore: 70 },
  durationMinutes: 25,
  difficulty: 1,
  category: '咨询接待',
};

const def: ScoreItemDef = {
  id: 'reception-trial-initiative',
  tenantId: 'tenant-demo',
  skillPointId: 'sp-closing',
  name: '主动性确定试听时间',
  behaviorAnchor: '主动提出试听即得100分',
  judgePrompt: '主动提出试听即得100分',
  weight: 10,
  levels: [],
  layer: 'company',
  isObservation: false,
  category: '咨询接待',
  scoringMode: 'score',
};

function makeSession(text: string): Session {
  return {
    id: 'session-trial-initiative',
    tenantId: 'tenant-demo',
    userId: 'user-trainee-1',
    scenarioId: scenario.id,
    mode: 'practice',
    status: 'completed',
    transcript: [{ seq: 1, speaker: 'trainee', text, at: '2026-01-01T10:00:00Z' }],
    emotionTrace: [],
    hintsUsed: 0,
    receptionQuestions: RECEPTION_QUESTION_POOL.slice(0, 10).map((item) => ({ ...item })),
    startedAt: '2026-01-01T10:00:00Z',
  };
}

const gateway = {
  forTask: () => {
    throw new Error('主动性评分不应调用LLM');
  },
};

it.each([
  '您什么时候方便试听？我给您安排。',
  '你需要试听吗？',
  '要不要试听？',
  '我给您安排试听。',
  '您看孩子什么时候方便，我这边提前安排老师。',
])('主动提出试听“%s”本项得100分', async (text) => {
  const result = await judgeItem(def, makeSession(text), gateway, scenario);
  expect(result.score).toBe(100);
  expect(result.rationale).toContain('主动提出试听');
});

it('封闭式邀约只在忌讳项扣5分，不影响主动性100分', async () => {
  const session = makeSession('你需要试听吗？');
  const result = await judgeItem(def, session, gateway, scenario);
  expect(result.score).toBe(100);
  const invitation = await analyzeReceptionTrialInvitation(session, {
    forTask: () => new MockLLMProvider(() => JSON.stringify({ triggered: true, quoteTurnSeq: 1, reason: '封闭式试听提问' })),
  });
  expect(invitation.deduction).toBe(5);
});

it('客户给过机会后仍未主动提出试听得0分', async () => {
  const result = await judgeItem(def, makeSession('好的，我没有其他补充了。'), gateway, scenario);
  expect(result.score).toBe(0);
  expect(result.rationale).toContain('最后一次邀约机会');
  expect(result.betterScript).toContain('您什么时候方便试听？我给您安排。');
});
