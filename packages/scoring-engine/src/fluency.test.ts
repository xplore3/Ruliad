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

it('成串嗯啊等填充词刚达到阈值时扣10分', () => {
  const result = analyzeReceptionFluency(makeSession([
    { seq: 1, speaker: 'trainee', text: '嗯，啊，呃，我们会先了解孩子的情况。', at: '2026-01-01T10:00:00Z' },
  ]));
  expect(result.deduction).toBe(10);
  expect(result.fillerCount).toBe(3);
  expect(result.rationale).toContain('全局扣10分');
});

it('多次重复字词触发扣分', () => {
  const result = analyzeReceptionFluency(makeSession([
    { seq: 1, speaker: 'trainee', text: '我我我想了解一下这这这个课程怎么安排。', at: '2026-01-01T10:00:00Z' },
  ]));
  expect(result.deduction).toBe(10);
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
  expect(result.deduction).toBe(10);
  expect(result.disruptedPauseCount).toBe(3);
});

it('多轮高频使用填充词即使单轮未达阈值也扣20分', () => {
  const turns = [1, 2, 3, 4, 5].map((seq) => ({
    seq,
    speaker: 'trainee' as const,
    text: '嗯，啊，我们会先了解孩子的兴趣和基础，再安排适合的课程与学习节奏。',
    at: '2026-01-01T10:00:00Z',
  }));
  const result = analyzeReceptionFluency(makeSession(turns));
  expect(result.deduction).toBe(20);
  expect(result.fillerCount).toBe(10);
  expect(result.affectedTurns).toBe(5);
});

it('咨询接待忌讳项在LLM扣分之外只追加一次语声语调10分', async () => {
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
  expect(result.score).toBe(10);
  expect(result.isDeduction).toBe(true);
  expect(result.rationale).toContain('其他忌讳未触犯');
  expect(result.rationale.match(/全局扣10分/g)).toHaveLength(1);
});


it('多轮少量语气词属于正常润色，不扣分', () => {
  const turns = Array.from({ length: 6 }, (_, index) => ({
    seq: index + 1,
    speaker: 'trainee' as const,
    text: '嗯，我们会先了解孩子的兴趣和基础，再安排适合的课程与学习节奏。',
    at: '2026-01-01T10:00:00Z',
  }));
  const result = analyzeReceptionFluency(makeSession(turns));
  expect(result.deduction).toBe(0);
  expect(result.fillerCount).toBe(6);
  expect(result.turns).toHaveLength(6);
  expect(result.affectedTurns).toBe(0);
});


it('这个那个就是等常见填充词成串出现时触发扣分', () => {
  const result = analyzeReceptionFluency(makeSession([
    { seq: 1, speaker: 'trainee', text: '这个，那个，就是说，我们会先了解孩子的情况。', at: '2026-01-01T10:00:00Z' },
  ]));
  expect(result.fillerCount).toBe(3);
  expect(result.deduction).toBe(10);
});

it('正常表达中的这个就是不误报为填充词', () => {
  const result = analyzeReceptionFluency(makeSession([
    { seq: 1, speaker: 'trainee', text: '这个课程会先带孩子熟悉棋盘，其实这就是通过小游戏培养兴趣。', at: '2026-01-01T10:00:00Z' },
  ]));
  expect(result.fillerCount).toBe(0);
  expect(result.deduction).toBe(0);
});

it('最近演练中的正常衔接表达和单次口误不扣分', () => {
  const result = analyzeReceptionFluency(makeSession([
    { seq: 17, speaker: 'trainee', text: '实话实说啊，确实也有一些孩子坐不住的那我们的教学呢会以兴趣为导向，尽量让课堂的生动有趣。这样孩子如果看动画片呢可以做很久。所以呢其实如果说孩子确实有兴趣，那这个时间呢对他们来说可能就是一种快乐的享受，就在玩就能坐得住了。', at: '2026-01-01T10:00:00Z' },
    { seq: 19, speaker: 'trainee', text: '那实话实说啊，就是通过一节两节的课呢，要看出孩子有没有天赋呢，确实比较困难。但是呢我们可以看出孩子有没有兴趣。呃，法国思想家蒙恬说兴趣是天赋的征兆嘛。孩子在这方面有兴趣的话呢，其实某种程度上就值得培养。因为很可能呢他能做这件事情获得成就感，也就可能说天赋就不错。', at: '2026-01-01T10:00:00Z' },
    { seq: 27, speaker: 'trainee', text: '呃，可以是可以可以自己教。但是问题呢就是很多家长他也不是围棋专业的。我们培训机构呢就是会更有效率的让孩子提高哦，节约孩子的时间。', at: '2026-01-01T10:00:00Z' },
  ]));
  expect(result.fillerCount).toBe(2);
  expect(result.repetitionCount).toBe(1);
  expect(result.deduction).toBe(0);
});

it('多轮演练只有个别轮次停顿偏高时按整体表现不扣分', () => {
  const turns = Array.from({ length: 16 }, (_, index) =>
    voiceTurn(index + 1, '宝贝，不着急，我们慢慢看，想清楚再告诉老师。', [], 2200)
  );
  const naturalPauses = [
    { atMs: 800, durationMs: 700 },
    { atMs: 2000, durationMs: 700 },
    { atMs: 3200, durationMs: 700 },
  ];
  turns[7] = voiceTurn(8, '我们先了解孩子的兴趣，再安排适合的课程。', naturalPauses);
  turns[15] = voiceTurn(16, '您可以带孩子先来体验，之后再决定是否报名。', naturalPauses);

  const result = analyzeReceptionFluency(makeSession(turns));
  expect(result.turns.filter((turn) => turn.severe)).toHaveLength(2);
  expect(result.deduction).toBe(0);
  expect(result.rationale).toContain('个别句中停顿');
  expect(result.rationale).toContain('耐心停顿');
});

it('严重停顿刚覆盖整场四分之一轮次时扣10分', () => {
  const turns = Array.from({ length: 8 }, (_, index) =>
    voiceTurn(index + 1, '我们会先了解孩子的兴趣和基础，再安排课程。', [], 2200)
  );
  const disruptedPauses = [
    { atMs: 800, durationMs: 700 },
    { atMs: 2000, durationMs: 700 },
    { atMs: 3200, durationMs: 700 },
  ];
  turns[1] = voiceTurn(2, '这个课程会先带孩子熟悉棋盘。', disruptedPauses);
  turns[4] = voiceTurn(5, '之后老师会安排小游戏和对局。', disruptedPauses);

  const result = analyzeReceptionFluency(makeSession(turns));
  expect(result.turns.filter((turn) => turn.severe)).toHaveLength(2);
  expect(result.deduction).toBe(10);
});

it('异常轮次增加时扣分从10分逐步提高到40分', () => {
  const disruptedPauses = [
    { atMs: 800, durationMs: 700 },
    { atMs: 2000, durationMs: 700 },
    { atMs: 3200, durationMs: 700 },
  ];
  const deductions = [2, 3, 4, 6].map((severeCount) => {
    const turns = Array.from({ length: 8 }, (_, index) =>
      voiceTurn(
        index + 1,
        '我们会先了解孩子的兴趣和基础，再安排课程。',
        index < severeCount ? disruptedPauses : [],
        index < severeCount ? 800 : 2200,
      )
    );
    return analyzeReceptionFluency(makeSession(turns)).deduction;
  });

  expect(deductions).toEqual([10, 20, 30, 40]);
});
