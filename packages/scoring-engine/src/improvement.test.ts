import { expect, it } from 'vitest';
import type { LLMGateway, Scenario, ScoreItemDef, ScoreItemResult, Session, TranscriptTurn } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { buildGroundPushIncompleteGoal, buildGroundPushIncompleteGoalWithLLM, buildImprovementGoal } from './improvement.js';
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

function groundSession(transcript: TranscriptTurn[]): Session {
  return {
    id: 'session-ground-improvement',
    tenantId: 'tenant-demo',
    userId: 'user-trainee-1',
    scenarioId: 'scenario-ground',
    mode: 'practice',
    status: 'completed',
    completionStatus: 'incomplete',
    completionReason: '客户给了最后推进机会，但学员没有完成实质推进。',
    transcript,
    emotionTrace: [],
    hintsUsed: 0,
    startedAt: '2026-01-01T10:00:00Z',
  };
}

function turn(seq: number, speaker: TranscriptTurn['speaker'], text: string): TranscriptTurn {
  return { seq, speaker, text, at: '2026-01-01T10:00:00Z' };
}

it('客户看过但没接邀请函时只建议先完成递卡', () => {
  const goal = buildGroundPushIncompleteGoal(groundSession([
    turn(6, 'trainee', '这是体验卡，您拿着给您介绍一下。'),
    turn(7, 'persona', '客户看了一眼邀请卡，没接。'),
    turn(9, 'persona', '好的，我回去琢磨琢磨。'),
    turn(10, 'trainee', '好的，那你拿上回去琢磨一下。'),
  ]));

  expect(goal.title).toBe('先让家长拿上邀请函');
  expect(goal.rationale).toContain('实际接过邀请函');
  expect(goal.rationale).toContain('没有听清楚下一步');
  expect(goal.rationale).toContain('直接离开');
  expect(goal.suggestion).toContain('您拿上邀请函');
  expect(goal.suggestion).not.toMatch(/填写|电话|支付|周六|订一张|购买/);
});

it('接过介绍单但尚未购买时给出活动介绍和孩子沟通两项建议', () => {
  const goal = buildGroundPushIncompleteGoal(groundSession([
    turn(6, 'trainee', '这是活动介绍给您拿上。这次体验活动由老师带小朋友玩围棋游戏，边玩边学。'),
    turn(7, 'persona', '客户放慢脚步，接过介绍单看了看。'),
  ]));

  expect(goal.title).toBe('递卡后，把活动介绍清楚，并让孩子产生兴趣');
  expect(goal.rationale).toContain('客户已经接过介绍材料，递卡这一步已经完成');
  expect(goal.suggestion).toContain('试听活动流程、学校地址');
  expect(goal.suggestion).toContain('年龄、有没有基础');
  expect(goal.suggestion).toContain('2. 主动跟孩子沟通');
});

it('已经和孩子沟通时只保留活动介绍建议', () => {
  const goal = buildGroundPushIncompleteGoal(groundSession([
    turn(6, 'trainee', '这是活动介绍给您拿上。这次体验活动由老师带小朋友玩围棋游戏，边玩边学。'),
    turn(7, 'persona', '客户接过介绍单看了看。'),
    turn(8, 'trainee', '小朋友，你喜欢围棋吗？'),
  ]));

  expect(goal.title).toBe('递卡后，把试听活动介绍完整');
  expect(goal.rationale).toContain('你已经和孩子沟通过了');
  expect(goal.suggestion).toContain('1. 继续介绍试听活动流程');
  expect(goal.suggestion).not.toContain('2. 主动跟孩子沟通');
});

it('已经售卖但未登记信息时只建议填写姓名和电话', () => {
  const goal = buildGroundPushIncompleteGoal(groundSession([
    turn(6, 'trainee', '这次体验活动由老师带小朋友玩围棋游戏，学校在××大厦二层。我姓陈，这是我电话。邀请函5元，您现在给孩子订一张。'),
    turn(7, 'persona', '客户接过介绍单看了看。'),
  ]));

  expect(goal.title).toBe('让客户填写资料并付款');
  expect(goal.suggestion).toBe('客户已经口头答应购买邀请函，下一次应该让其填写资料并且付款。');
  expect(goal.suggestion).not.toMatch(/支付|周六|试听时间/);
});

it('已经登记信息但未支付时只建议完成支付', () => {
  const goal = buildGroundPushIncompleteGoal(groundSession([
    turn(6, 'trainee', '这次体验活动由老师带小朋友玩围棋游戏，学校在××大厦二层。我姓陈，这是我电话。邀请函5元，您现在给孩子订一张。'),
    turn(7, 'persona', '客户接过介绍单看了看。'),
    turn(9, 'trainee', '来，您在这里填一下姓名和电话。'),
  ]));

  expect(goal.title).toBe('问清家长怎么付款');
  expect(goal.suggestion).toBe('直接问：“您是微信还是支付宝？现在完成付款。”');
  expect(goal.suggestion).not.toMatch(/周六|试听时间/);
});


function stageGateway(stage: string, childCommunicated: boolean): LLMGateway {
  return {
    forTask: () => new MockLLMProvider(() => JSON.stringify({ stage, childCommunicated, reason: '已完成动作和当前缺失步骤说明' })),
  };
}

it('语义识别为递卡后指导时给出活动介绍和孩子沟通两项建议', async () => {
  const goal = await buildGroundPushIncompleteGoalWithLLM(groundSession([
    turn(6, 'trainee', '这是活动介绍，您拿上。'),
    turn(7, 'persona', '客户接过介绍单。'),
  ]), stageGateway('after-card-guidance', false));

  expect(goal.title).toBe('递卡后，把活动介绍清楚，并让孩子产生兴趣');
  expect(goal.suggestion).toContain('试听活动流程、学校地址');
  expect(goal.suggestion).toContain('2. 主动跟孩子沟通');
});

it('语义识别为尝试售卖且尚未沟通孩子时建议先激发孩子兴趣', async () => {
  const goal = await buildGroundPushIncompleteGoalWithLLM(groundSession([
    turn(6, 'trainee', '这是活动介绍，您拿上。'),
    turn(7, 'persona', '客户接过介绍单。'),
  ]), stageGateway('sell', false));

  expect(goal.title).toBe('尝试和孩子沟通并售卖邀请函');
  expect(goal.suggestion).toContain('主动和孩子沟通、激发兴趣');
  expect(goal.suggestion).not.toContain('填写资料并且付款');
});

it('已经和孩子沟通后进入售卖阶段时不再重复孩子沟通建议', async () => {
  const goal = await buildGroundPushIncompleteGoalWithLLM(groundSession([
    turn(6, 'trainee', '这是活动介绍，您拿上。'),
    turn(7, 'persona', '客户接过介绍单。'),
    turn(8, 'trainee', '小朋友，你喜欢围棋吗？'),
  ]), stageGateway('sell', false));

  expect(goal.suggestion).toBe('基本介绍和孩子沟通已经完成，接下来请家长订购邀请函。');
  expect(goal.suggestion).not.toContain('主动和孩子沟通、激发兴趣');
});

it('客户口头答应购买但未填资料时建议填写资料并付款', async () => {
  const goal = await buildGroundPushIncompleteGoalWithLLM(groundSession([
    turn(6, 'trainee', '这是活动介绍，您拿上。'),
    turn(7, 'persona', '客户接过介绍单。'),
    turn(8, 'persona', '好，那我给孩子订一张。'),
  ]), stageGateway('contact', true));

  expect(goal.title).toBe('让客户填写资料并付款');
  expect(goal.suggestion).toBe('客户已经口头答应购买邀请函，下一次应该让其填写资料并且付款。');
});

it('已填写资料但未付款时建议明确付款方式', async () => {
  const goal = await buildGroundPushIncompleteGoalWithLLM(groundSession([
    turn(6, 'trainee', '这是活动介绍，您拿上。'),
    turn(7, 'persona', '客户接过介绍单。'),
    turn(8, 'trainee', '来，您在这里填一下姓名和电话。'),
  ]), stageGateway('payment', true));

  expect(goal.title).toBe('问清家长怎么付款');
  expect(goal.suggestion).toContain('微信还是支付宝');
});

it('已付款但未约试听时建议确定体验时间', async () => {
  const goal = await buildGroundPushIncompleteGoalWithLLM(groundSession([
    turn(6, 'trainee', '这是活动介绍，您拿上。'),
    turn(7, 'persona', '客户接过介绍单。'),
    turn(8, 'persona', '我已经付款了。'),
  ]), stageGateway('schedule', true));

  expect(goal.title).toBe('和家长定好体验时间');
  expect(goal.suggestion).toContain('周六上午');
});


it('电销邀约后给出活动介绍和孩子沟通两项建议', async () => {
  const goal = await buildGroundPushIncompleteGoalWithLLM(groundSession([
    turn(1, 'trainee', '我们有一个199元4次体验课活动，想邀请您参加。'),
    turn(2, 'persona', '我考虑一下。'),
  ]), stageGateway('after-card-guidance', false), undefined, '电销');

  expect(goal.title).toBe('邀约后，把活动和孩子兴趣都介绍清楚');
  expect(goal.suggestion).toContain('199元4次体验课');
  expect(goal.suggestion).toContain('2. 主动跟孩子沟通');
  expect(goal.suggestion).toContain('大众点评');
});

it('电销口头答应后建议填写孩子资料并完成付款', async () => {
  const goal = await buildGroundPushIncompleteGoalWithLLM(groundSession([
    turn(1, 'trainee', '我们有一个199元4次体验课活动，想邀请您参加。'),
    turn(2, 'persona', '好，那我给孩子订一张。'),
  ]), stageGateway('contact', true), undefined, '电销');

  expect(goal.title).toBe('让客户填写孩子资料并完成下单');
  expect(goal.suggestion).toContain('孩子姓名、年龄、基础和联系方式');
  expect(goal.suggestion).toContain('大众点评完成付款');
});

it('电销已沟通孩子后直接进入大众点评下单建议', async () => {
  const goal = await buildGroundPushIncompleteGoalWithLLM(groundSession([
    turn(1, 'trainee', '我们有一个199元4次体验课活动，想邀请您参加。'),
    turn(2, 'trainee', '小朋友，你喜欢这个活动吗？'),
  ]), stageGateway('sell', false), undefined, '电销');

  expect(goal.suggestion).toBe('基本介绍和孩子沟通已经完成，接下来请家长打开大众点评下单。');
  expect(goal.suggestion).not.toContain('邀请函');
});


it('电销尚未有效邀约时回退也使用电销建议而非递卡建议', async () => {
  const goal = await buildGroundPushIncompleteGoalWithLLM(groundSession([
    turn(1, 'trainee', '您好。'),
    turn(2, 'persona', '我考虑一下。'),
  ]), stageGateway('accept-card', false), undefined, '电销');

  expect(goal.title).toBe('先说明活动并邀请家长参加');
  expect(goal.suggestion).toContain('199元4次体验课');
  expect(goal.suggestion).not.toContain('拿上邀请函');
});
