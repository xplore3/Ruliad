import { expect, it } from 'vitest';
import { RECEPTION_QUESTION_POOL, type LLMGateway, type ProductKB, type Scenario, type ScoreItemDef, type Session } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { judgeItem } from './judge.js';

const scores = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

it('对答得当逐题百分制评分并返回10题算术平均分', async () => {
  const prompts: string[] = [];
  const gateway: LLMGateway = {
    forTask: () => new MockLLMProvider((messages) => {
      prompts.push(messages.map((message) => message.content).join('\n'));
      return JSON.stringify({
        evaluations: scores.map((score, index) => ({
          score,
          rationale: `第${index + 1}题评分依据`,
          improvement: `第${index + 1}题具体改进建议`,
        })),
      });
    }),
  };
  const session: Session = {
    id: 'session-reception',
    tenantId: 'tenant-demo',
    userId: 'user-trainee-1',
    scenarioId: 'scenario-reception',
    mode: 'practice',
    status: 'completed',
    transcript: [{ seq: 1, speaker: 'trainee', text: '一周上一次课，试听当天报名有优惠。', at: '2026-01-01T10:00:00Z' }],
    emotionTrace: [],
    hintsUsed: 0,
    receptionQuestions: RECEPTION_QUESTION_POOL.slice(0, 10).map((item) => ({ ...item })),
    startedAt: '2026-01-01T10:00:00Z',
  };
  const scenario: Scenario = {
    id: 'scenario-reception',
    tenantId: 'tenant-demo',
    name: '咨询接待',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-value'],
    successCriteria: { passScore: 60 },
    durationMinutes: 20,
    difficulty: 1,
    category: '咨询接待',
  };
  const def: ScoreItemDef = {
    id: 'item-reception-answers',
    tenantId: 'tenant-demo',
    skillPointId: 'sp-value',
    name: '对答得当',
    behaviorAnchor: '按详解逐题评价',
    judgePrompt: '每题满分100分',
    weight: 30,
    levels: [],
    layer: 'company',
    isObservation: false,
    category: '咨询接待',
    scoringMode: 'score',
  };
  const institutionKB: ProductKB = {
    id: 'kb-institution-custom',
    tenantId: 'tenant-demo',
    name: '培训机构定制资料库',
    version: 1,
    entries: [{ id: 'faq-4', kind: 'faq', title: '一周上几次课', content: '每周一次，每次90分钟。' }],
    effectiveAt: '2026-01-01T00:00:00Z',
  };

  const result = await judgeItem(def, session, gateway, scenario, undefined, undefined, institutionKB);
  expect(result.score).toBe(55);
  expect(result.levelLabel).toBe('10题平均分');
  expect(result.rationale).toContain('第1题');
  expect(result.rationale).toContain('第10题');
  expect(result.rationale).toContain('具体改进建议');
  expect(result.betterScript).toContain('第10题具体改进建议');
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toContain('未提及试听当天报名优惠也扣50分');
  expect(prompts[0]).toContain('每周一次，每次90分钟');
  expect(prompts[0]).toContain('一周上一次课，试听当天报名有优惠');
});
