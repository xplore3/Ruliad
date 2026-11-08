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

it('A说两遍或三遍都只是一组重复，不扣分', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '我们会先了解孩子的情况。',
    '我们会先了解孩子的情况。',
    '我们会先了解孩子的情况。',
  ]));
  expect(result.groups).toHaveLength(1);
  expect(result.deduction).toBe(0);
});

it('A和B各说两遍只有两组重复，不扣分', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '我们会先了解孩子的情况。',
    '我们会先了解孩子的情况。',
    '试听课会让孩子熟悉围棋规则。',
    '试听课会让孩子熟悉围棋规则。',
  ]));
  expect(result.groups).toHaveLength(2);
  expect(result.deduction).toBe(0);
});

it('A、B、C各说两遍即三组重复，触发全局扣10分', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '我们会先了解孩子的兴趣和基础，再安排合适的课程。',
    '先了解孩子的兴趣与基础，然后安排合适的课程。',
    '试听课会让孩子熟悉围棋规则。',
    '试听会让孩子熟悉围棋规则。',
    '缺课后可以按照机构政策安排补课。',
    '缺课后可以按照机构政策安排补课。',
  ]));
  expect(result.deduction).toBe(10);
  expect(result.groups).toHaveLength(3);
  expect(result.groups.map((group) => group.turnSeqs)).toEqual([[1, 2], [3, 4], [5, 6]]);
  expect(result.affectedTurns).toBe(6);
});

it('不同问题和不同意思不会因为都谈课程而误扣', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '我们会先了解孩子的兴趣和基础，再安排合适的课程。',
    '试听课会让孩子通过故事和游戏熟悉围棋规则。',
    '报名后如果临时外出，可以按照机构政策冻结课程。',
  ]));
  expect(result.deduction).toBe(0);
});

it('至少12次且分布在3轮的无意义表达才触发简洁沟通扣分', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '嗯，啊，呃，这个，我们会先了解孩子情况。',
    '那个，就是，然后，其实，课程安排是这样的。',
    '嗯，啊，呃，这个，我们会安排试听。',
  ]));
  expect(result.meaninglessCount).toBe(12);
  expect(result.deduction).toBe(10);
});

it('少量语气词和包含实际信息的这个课程不扣分', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '嗯，我们会先了解孩子情况。',
    '这个课程会培养孩子兴趣。',
    '其实这个问题需要结合孩子基础来看。',
    '呃，我们会安排试听。',
    '啊，欢迎家长过来。',
    '嗯，到时候见。',
  ]));
  expect(result.meaninglessCount).toBe(4);
  expect(result.deduction).toBe(0);
});

it('简洁沟通扣10分与语声语调扣40分分别累加', async () => {
  const session = makeSession([
    '嗯，啊，呃，这个课程对孩子很有帮助',
    '嗯，啊，呃，这个课程对孩子很有帮助',
    '嗯，啊，呃，试听可以了解老师',
    '嗯，啊，呃，试听可以了解老师',
    '嗯，啊，呃，缺课可以安排补课',
    '嗯，啊，呃，缺课可以安排补课',
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
  expect(result.score).toBe(50);
  expect(result.rationale).toContain('全局扣40分');
  expect(result.rationale).toContain('全局扣10分');
});

it('扣分理由列出每次语义重复原句及逐轮填充词证据', () => {
  const result = analyzeReceptionRepetition(makeSession([
    '我们会先了解孩子的兴趣和基础，再安排合适的课程。嗯，啊，呃，这个',
    '先了解孩子的兴趣与基础，然后安排合适的课程。那个，就是，然后，其实',
    '试听课会让孩子熟悉围棋规则。嗯，啊，呃，这个',
    '试听会让孩子熟悉围棋规则。',
    '缺课后可以按照机构政策安排补课。',
    '缺课后可以按照机构政策安排补课。',
  ]));
  expect(result.deduction).toBe(10);
  expect(result.rationale).toContain('第1轮“我们会先了解孩子的兴趣和基础”');
  expect(result.rationale).toContain('第2轮“先了解孩子的兴趣与基础”');
  expect(result.rationale).toContain('无实际信息的语气或填充表达共12次：第1轮“嗯”、“啊”、“呃”、“这个”');
  expect(result.rationale).toContain('第2轮“那个”、“就是”、“然后”、“其实”');
  expect(result.rationale).toContain('第3轮“嗯”、“啊”、“呃”、“这个”');
});
