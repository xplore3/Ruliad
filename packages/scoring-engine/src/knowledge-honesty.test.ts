import { expect, it } from 'vitest';
import type { LLMGateway, ProductKB, Scenario, ScoreItemDef, Session } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { analyzeReceptionKnowledgeHonesty } from './knowledge-honesty.js';
import { judgeItem } from './judge.js';

const institutionKB: ProductKB = {
  id: 'kb-institution',
  tenantId: 'tenant-demo',
  name: '机构初始化资料',
  version: 1,
  entries: [
    { id: 'frequency', kind: 'faq', title: '课频', content: '每周一次课。' },
    { id: 'duration', kind: 'faq', title: '课时', content: '每次90分钟。' },
    { id: 'refund', kind: 'faq', title: '退费', content: '按合同政策可以退费。' },
  ],
  effectiveAt: '2026-01-01T00:00:00Z',
};

const session: Session = {
  id: 'session-knowledge-honesty',
  tenantId: 'tenant-demo',
  userId: 'user-trainee-1',
  scenarioId: 'scenario-reception',
  mode: 'practice',
  status: 'completed',
  transcript: [
    { seq: 1, speaker: 'trainee', text: '每周三次课。', at: '2026-01-01T10:00:00Z' },
    { seq: 2, speaker: 'trainee', text: '每次课三个小时。', at: '2026-01-01T10:00:00Z' },
    { seq: 3, speaker: 'trainee', text: '学费一律不能退。', at: '2026-01-01T10:00:00Z' },
  ],
  emotionTrace: [],
  hintsUsed: 0,
  startedAt: '2026-01-01T10:00:00Z',
};

function contradictions(turnSeqs: number[]) {
  return JSON.stringify({
    contradictions: turnSeqs.map((turnSeq) => ({
      turnSeq,
      question: '机构政策是什么？',
      claim: '学员错误说法',
      expected: '资料中的正确事实',
      reason: '明确事实冲突',
    })),
  });
}

it('两次明确资料冲突按记错或口误处理不扣分', async () => {
  const gateway: LLMGateway = { forTask: () => new MockLLMProvider(() => contradictions([1, 2])) };
  const result = await analyzeReceptionKnowledgeHonesty(session, gateway, institutionKB);
  expect(result.contradictionCount).toBe(2);
  expect(result.deduction).toBe(0);
});

it('超过两次明确资料冲突属于信口胡说全局扣40分', async () => {
  const gateway: LLMGateway = { forTask: () => new MockLLMProvider(() => contradictions([1, 2, 3])) };
  const result = await analyzeReceptionKnowledgeHonesty(session, gateway, institutionKB);
  expect(result.contradictionCount).toBe(3);
  expect(result.deduction).toBe(40);
  expect(result.rationale).toContain('我马上了解清楚再回复您');
});

it('同一轮多个冲突只计一次', async () => {
  const gateway: LLMGateway = { forTask: () => new MockLLMProvider(() => contradictions([1, 1, 2, 2])) };
  const result = await analyzeReceptionKnowledgeHonesty(session, gateway, institutionKB);
  expect(result.contradictionCount).toBe(2);
  expect(result.deduction).toBe(0);
});

it('解析失败不虚构冲突或扣分', async () => {
  const gateway: LLMGateway = { forTask: () => new MockLLMProvider(() => 'not-json') };
  const result = await analyzeReceptionKnowledgeHonesty(session, gateway, institutionKB);
  expect(result.deduction).toBe(0);
});

it('没有机构资料时不调用LLM且不扣分', async () => {
  const result = await analyzeReceptionKnowledgeHonesty(session, {
    forTask: () => { throw new Error('不应调用LLM'); },
  });
  expect(result.deduction).toBe(0);
});

it('咨询接待忌讳项累计超过两次资料冲突扣40分', async () => {
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
  const gateway: LLMGateway = {
    forTask: () => new MockLLMProvider((messages) => {
      const content = String(messages[0]?.content ?? '');
      return content.includes('机构资料事实核对')
        ? contradictions([1, 2, 3])
        : JSON.stringify({ score: 0, rationale: '其他忌讳未触犯' });
    }),
  };
  const result = await judgeItem(def, session, gateway, scenario, undefined, undefined, institutionKB);
  expect(result.score).toBe(40);
  expect(result.rationale).toContain('资料真实性');
  expect(result.rationale).toContain('全局扣40分');
});
