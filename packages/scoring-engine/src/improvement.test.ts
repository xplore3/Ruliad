import { expect, it } from 'vitest';
import type { Scenario, ScoreItemDef, ScoreItemResult } from '@grasp-mvp/core';
import { buildImprovementGoal } from './improvement.js';
import { buildFallbackSummary } from './summary.js';

const defs: ScoreItemDef[] = [
  { id: 'a', tenantId: 't', skillPointId: 'sp', name: '项目A', behaviorAnchor: '', judgePrompt: '', weight: 20, levels: [], layer: 'company', isObservation: false },
  { id: 'b', tenantId: 't', skillPointId: 'sp', name: '项目B', behaviorAnchor: '', judgePrompt: '', weight: 80, levels: [], layer: 'company', isObservation: false },
  { id: 'taboo', tenantId: 't', skillPointId: 'sp', name: '忌讳项', behaviorAnchor: '', judgePrompt: '', weight: 0, levels: [], layer: 'company', isObservation: false, deductionOnly: true },
];

function item(id: string, score: number, deduction = false): ScoreItemResult {
  const def = defs.find((entry) => entry.id === id)!;
  return {
    itemId: id,
    itemName: def.name,
    skillPointId: def.skillPointId,
    levelKey: 'score',
    levelLabel: '得分',
    score,
    quote: '',
    quoteTurnSeq: 0,
    rationale: `${def.name}的具体问题`,
    betterScript: `${def.name}的具体建议`,
    confidence: 1,
    judgeAgree: true,
    isReference: false,
    isObservation: false,
    isDeduction: deduction,
    layer: 'company',
  };
}

it('合规红线优先于所有改进目标', () => {
  const goal = buildImprovementGoal([item('taboo', 40, true)], defs, [{ ruleId: 'redline', kind: 'redline', detail: '保证提分', fatal: true }]);
  expect(goal.title).toBe('避免合规红线话术');
  expect(goal.rationale).toBe('保证提分');
});

it('独立扣分按对最终总分的实际影响优先', () => {
  const goal = buildImprovementGoal([item('a', 100), item('b', 100), item('taboo', 40, true)], defs, []);
  expect(goal.title).toBe('忌讳项');
  expect(goal.impact).toBe(40);
});

it('普通评分项按权重计算对总分的影响', () => {
  const goal = buildImprovementGoal([item('a', 0), item('b', 90)], defs, []);
  expect(goal.title).toBe('项目A');
  expect(goal.impact).toBe(20);
});

it('满分项即使生成改进候选也不能成为改进目标', () => {
  const perfect = {
    ...item('b', 100),
    itemName: '告知优惠',
    improvementCandidates: [{ title: '告知优惠', impact: 100, rationale: '已经告知优惠', suggestion: '避免再次触发同类问题' }],
  };
  const weakness = {
    ...item('a', 50),
    itemName: '服务用语亲切度',
    improvementCandidates: [{ title: '服务用语亲切度', impact: 50, rationale: '缺少确认回应', suggestion: '先复述并确认客户需求' }],
  };
  const goal = buildImprovementGoal([perfect, weakness], defs, []);
  expect(goal.title).toBe('服务用语亲切度');
  expect(goal.suggestion).toBe('先复述并确认客户需求');
});

it('忌讳扣分和普通失分统一按最终分数损失比较', () => {
  const goal = buildImprovementGoal([item('a', 0), item('b', 100), item('taboo', 40, true)], defs, []);
  expect(goal.title).toBe('忌讳项');
  expect(goal.impact).toBe(32);
});

it('同一忌讳项内只选择影响最大的具体错误', () => {
  const taboo = {
    ...item('taboo', 50, true),
    improvementCandidates: [
      { title: '简洁沟通', impact: 10, rationale: '重复表达', suggestion: '同一意思只说一次' },
      { title: '语声语调', impact: 40, rationale: '填充词过多', suggestion: '减少填充词' },
    ],
  };
  const goal = buildImprovementGoal([taboo], defs, []);
  expect(goal.title).toBe('语声语调');
  expect(goal.suggestion).toBe('减少填充词');
});

it('教练回退总结只讲一个改进目标', () => {
  const scenario: Scenario = {
    id: 's', tenantId: 't', name: '咨询接待', personaConfigId: 'p', skillPointIds: [], successCriteria: { passScore: 70 }, durationMinutes: 25, difficulty: 1,
  };
  const summary = buildFallbackSummary(scenario, {
    totalScore: 50,
    passed: false,
    fatalViolation: false,
    items: [item('a', 90), item('taboo', 40, true)],
    defs,
    fillerTotal: 20,
    improvementGoal: { title: '语声语调', impact: 40, rationale: '填充词过多', suggestion: '减少填充词' },
  });
  expect(summary).toContain('最需要改进：语声语调');
  expect(summary).toContain('具体建议：减少填充词');
  expect(summary).not.toContain('扣分项');
  expect(summary).not.toContain('口头禅出现');
  expect(summary.match(/最需要改进/g)).toHaveLength(1);
});


it('旧报告的对答得当拆到单题且只给一条建议', () => {
  const reception = {
    ...item('a', 49.6),
    itemName: '对答得当',
    rationale: '第1题《问题一》：50/100。第一题评语\n第2题《问题二》：45/100。第二题评语',
    betterScript: '第1题：第一条建议\n第2题：第二条建议',
  };
  const goal = buildImprovementGoal([reception], defs, []);
  expect(goal.title).toBe('对答得当：第2题');
  expect(goal.rationale).toBe('第2题《问题二》：45/100。第二题评语');
  expect(goal.suggestion).toBe('第2题：第二条建议');
  expect(goal.rationale).not.toContain('\n');
  expect(goal.suggestion).not.toContain('\n');
});
