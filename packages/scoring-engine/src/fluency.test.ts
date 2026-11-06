import { expect, it } from 'vitest';
import type { Scenario, ScoreItemDef, Session, TranscriptTurn } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { analyzeReceptionFluency } from './fluency.js';
import { judgeItem } from './judge.js';

function voiceTurn(seq: number, text: string, pauses: Array<{ atMs: number; durationMs: number }>, averageMs = 800): TranscriptTurn {
  return {
    seq,
    speaker: 'trainee',
    text,
    at: '2026-01-01T10:00:00Z',
    voiceFeatures: {
      avgLoudnessDbfs: -26,
      loudnessRangeDb: 4,
      pitchVarSemitones: 2,
      voicedMs: 3000,
      prosody: {
        pitchCurve: [],
        loudnessCurve: Array.from({ length: 250 }, (_, index) => ({ atMs: index * 20, rms: 0.05 })),
        pauses,
        elongatedSegments: [],
        rhythm: { voicedMs: 3000, pauseMs: 2000, averageVoicedSegmentMs: averageMs },
        laughterCue: { status: 'unknown', reason: '' },
        performanceCue: { status: 'unknown', reason: '' },
      },
    },
  };
}

function makeSession(transcript: TranscriptTurn[]): Session {
  return {
    id: 'session-fluency',
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

it('单个语气词和句尾停顿不扣分', () => {
  const result = analyzeReceptionFluency(makeSession([
    voiceTurn(1, '嗯，我们会先带孩子熟悉棋盘，再通过小游戏培养兴趣。', [{ atMs: 4500, durationMs: 500 }], 2200),
  ]));
  expect(result.deduction).toBe(0);
  expect(result.fillerCount).toBe(1);
});

it('成串嗯啊等填充词触发全局扣40分', () => {
  const result = analyzeReceptionFluency(makeSession([
    { seq: 1, speaker: 'trainee', text: '嗯，啊，呃，我们会先了解孩子的情况。', at: '2026-01-01T10:00:00Z' },
  ]));
  expect(result.deduction).toBe(40);
  expect(result.fillerCount).toBe(3);
  expect(result.rationale).toContain('全局扣40分');
});

it('多次重复字词触发扣分', () => {
  const result = analyzeReceptionFluency(makeSession([
    { seq: 1, speaker: 'trainee', text: '我我我想了解一下这这这个课程怎么安排。', at: '2026-01-01T10:00:00Z' },
  ]));
  expect(result.deduction).toBe(40);
  expect(result.repetitionCount).toBe(2);
});

it('频繁句中停顿且停顿占比较高触发扣分', () => {
  const result = analyzeReceptionFluency(makeSession([
    voiceTurn(1, '我们会先了解孩子情况再安排课程。', [
      { atMs: 0, durationMs: 500 },
      { atMs: 800, durationMs: 700 },
      { atMs: 2000, durationMs: 700 },
      { atMs: 3200, durationMs: 700 },
      { atMs: 4500, durationMs: 500 },
    ]),
  ]));
  expect(result.deduction).toBe(40);
  expect(result.disruptedPauseCount).toBe(3);
});

it('多轮持续使用填充词即使单轮未达阈值也扣分', () => {
  const turns = [1, 2, 3].map((seq) => ({
    seq,
    speaker: 'trainee' as const,
    text: '嗯，啊，我们会先了解孩子的兴趣和基础，再安排适合的课程与学习节奏。',
    at: '2026-01-01T10:00:00Z',
  }));
  const result = analyzeReceptionFluency(makeSession(turns));
  expect(result.deduction).toBe(40);
  expect(result.fillerCount).toBe(6);
  expect(result.affectedTurns).toBe(3);
});

it('咨询接待忌讳项在LLM扣分之外只追加一次语声语调40分', async () => {
  const session = makeSession([
    { seq: 1, speaker: 'trainee', text: '嗯，啊，呃，我们会先了解孩子的情况。', at: '2026-01-01T10:00:00Z' },
  ]);
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
  expect(result.score).toBe(40);
  expect(result.isDeduction).toBe(true);
  expect(result.rationale).toContain('其他忌讳未触犯');
  expect(result.rationale.match(/全局扣40分/g)).toHaveLength(1);
});


it('六题测试汇总全部回答的持续填充词并逐题保留证据', () => {
  const turns = Array.from({ length: 6 }, (_, index) => ({
    seq: index + 1,
    speaker: 'trainee' as const,
    text: '嗯，我们会先了解孩子的兴趣和基础，再安排适合的课程与学习节奏。',
    at: '2026-01-01T10:00:00Z',
  }));
  const result = analyzeReceptionFluency(makeSession(turns));
  expect(result.deduction).toBe(40);
  expect(result.fillerCount).toBe(6);
  expect(result.turns).toHaveLength(6);
  expect(result.affectedTurns).toBe(6);
});


it('这个那个就是等常见填充词成串出现时触发扣分', () => {
  const result = analyzeReceptionFluency(makeSession([
    { seq: 1, speaker: 'trainee', text: '这个，那个，就是说，我们会先了解孩子的情况。', at: '2026-01-01T10:00:00Z' },
  ]));
  expect(result.fillerCount).toBe(3);
  expect(result.deduction).toBe(40);
});

it('正常表达中单个这个不触发扣分', () => {
  const result = analyzeReceptionFluency(makeSession([
    { seq: 1, speaker: 'trainee', text: '这个课程会先带孩子熟悉棋盘，再通过小游戏培养兴趣。', at: '2026-01-01T10:00:00Z' },
  ]));
  expect(result.fillerCount).toBe(1);
  expect(result.deduction).toBe(0);
});
