import { expect, it } from 'vitest';
import type { Scenario, ScoreItemDef, Session, TranscriptTurn } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { analyzeReceptionRepetition } from './repetition.js';
import { judgeItem } from './judge.js';

function makeSession(texts: string[]): Session {
  const transcript: TranscriptTurn[] = texts.map((text, index) => ({
    seq: index + 1,
    speaker: 'trainee',
    text,
    at: '2026-01-01T10:00:00Z',
  }));
  return {
    id: 'session-repetition',
    tenantId: 'tenant-demo',
    userId: 'user-trainee-1',
    scenarioId: 'scenario-reception',
    mode: 'practice',
    status: 'completed',
    transcript,
    emotionTrace: [],
    hintsUsed: 0,
    startedAt: '2026-01-01T10:00:00Z',
  };
}

it('同一句话偶尔出现两次不扣分', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '我们会先了解孩子的情况。',
    '我们会先了解孩子的情况。',
  ]));
  expect(result.deduction).toBe(0);
});

it('同一句话出现三次触发全局扣10分', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '我们会先了解孩子的情况。',
    '我们会先了解孩子的情况。',
    '我们会先了解孩子的情况。',
  ]));
  expect(result.deduction).toBe(10);
  expect(result.groups[0].count).toBe(3);
  expect(result.affectedTurns).toBe(3);
});

it('近义改写后反复表达同一意思也触发扣分', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '我们会先了解孩子的兴趣和基础，再安排合适的课程。',
    '先了解孩子的兴趣与基础，然后安排合适的课程。',
    '我们会先了解孩子兴趣及基础，再安排合适课程。',
  ]));
  expect(result.deduction).toBe(10);
  expect(result.groups[0].turnSeqs).toEqual([1, 2, 3]);
});

it('不同问题和不同意思不会因为都谈课程而误扣', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '我们会先了解孩子的兴趣和基础，再安排合适的课程。',
    '试听课会让孩子通过故事和游戏熟悉围棋规则。',
    '报名后如果临时外出，可以按照机构政策冻结课程。',
  ]));
  expect(result.deduction).toBe(0);
});

it('简洁沟通扣10分与语声语调扣40分分别累加', async () => {
  const session = makeSession(Array(3).fill('这个，那个，这个课程对孩子很有帮助'));
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
  const result = await judgeItem(def, session, {
    forTask: () => new MockLLMProvider(() => JSON.stringify({ score: 0, rationale: '其他忌讳未触犯' })),
  }, scenario);
  expect(result.score).toBe(50);
  expect(result.rationale).toContain('全局扣40分');
  expect(result.rationale).toContain('全局扣10分');
});
