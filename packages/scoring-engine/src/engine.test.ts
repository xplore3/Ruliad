import { describe, expect, it } from 'vitest';
import { RECEPTION_QUESTION_POOL, type LLMGateway, type Scenario, type ScoreItemDef, type Session } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { scoreSession } from './engine.js';

const gateway: LLMGateway = { forTask: () => new MockLLMProvider() };

const defs: ScoreItemDef[] = [
  {
    id: 'item-obj-1',
    tenantId: 'tenant-demo',
    skillPointId: 'sp-objection',
    name: '异议处理首反应',
    behaviorAnchor: '面对客户异议先共情澄清，不急于反驳或承诺',
    judgePrompt: '请判定学员在异议处理首反应上的表现，按档位输出 JSON。',
    weight: 1,
    levels: [
      { key: 'poor', label: '差', score: 30, description: '直接反驳或违规承诺' },
      { key: 'ok', label: '中', score: 60, description: '有回应但缺乏共情' },
      { key: 'good', label: '好', score: 90, description: '先共情澄清再回应' },
    ],
    layer: 'company',
    isObservation: false,
  },
];

const scenario: Scenario = {
  id: 'scenario-objection',
  tenantId: 'tenant-demo',
  name: '家长异议处理',
  personaConfigId: 'persona-wang',
  skillPointIds: ['sp-objection'],
  successCriteria: { passScore: 70 },
  durationMinutes: 10,
  difficulty: 2,
  coverageTopics: ['课时费', '退费政策'],
};

const longPersonaText =
  '我跟你说啊，我之前给孩子报的那个机构，交费之前说得天花乱坠，上了两个月老师换来换去，退费拖了快两个月，打电话过去每次都是不同的客服，最后我都懒得折腾了，你们这次不会也这样吧？';

const session: Session = {
  id: 'session-test-1',
  tenantId: 'tenant-demo',
  userId: 'user-trainee-1',
  scenarioId: 'scenario-objection',
  mode: 'practice',
  status: 'completed',
  transcript: [
    { seq: 1, speaker: 'persona', text: '你们是哪家公司的？找我什么事？', at: '2026-01-01T10:00:00Z' },
    // 红线词 + 口头禅（其实 ×4）
    {
      seq: 2,
      speaker: 'trainee',
      text: '其实其实其实，这个课程保证提分，其实您放心就行',
      at: '2026-01-01T10:00:10Z',
    },
    { seq: 3, speaker: 'persona', text: longPersonaText, at: '2026-01-01T10:00:20Z' },
    // 打断启发式：长 persona 轮后学员短回复
    { seq: 4, speaker: 'trainee', text: '哦', at: '2026-01-01T10:00:25Z' },
    // 其实 ×7（合计 11 次，超阈值）+ 覆盖话题 课时费
    {
      seq: 5,
      speaker: 'trainee',
      text: '其实其实其实其实其实其实其实，课时费我们承诺开课前无理由退费',
      at: '2026-01-01T10:00:35Z',
    },
  ],
  emotionTrace: [],
  hintsUsed: 0,
  startedAt: '2026-01-01T10:00:00Z',
  endedAt: '2026-01-01T10:05:00Z',
};

describe('scoreSession', () => {
  it('含红线词与口头禅的会话：fatal + 不通过 + 规则统计正确', async () => {
    const report = await scoreSession(session, scenario, defs, gateway);

    // 红线一票否决
    expect(report.fatalViolation).toBe(true);
    expect(report.passed).toBe(false);
    const redline = report.violations.find((v) => v.ruleId === 'redline-promise');
    expect(redline).toBeDefined();
    expect(redline!.fatal).toBe(true);
    expect(redline!.turnSeq).toBe(2);

    // 口头禅统计（其实 4+7=11，去 0 次项）
    expect(report.ruleStats.fillerCounts).toEqual({ 其实: 11 });
    expect(report.violations.some((v) => v.ruleId === 'filler-heavy' && !v.fatal)).toBe(true);

    // 打断启发式
    expect(report.ruleStats.interruptions).toBe(1);

    // 话题覆盖
    expect(report.ruleStats.coverageHits).toEqual(['课时费']);
    expect(report.ruleStats.coverageMisses).toEqual(['退费政策']);
    expect(report.violations.some((v) => v.ruleId === 'coverage-miss' && !v.fatal)).toBe(true);

    // 状态指标：学员 54 字 / 总 156 字；时间窗 35s；两处应答前静默 > 3s
    expect(report.ruleStats.talkRatio).toBeCloseTo(54 / 156, 5);
    expect(report.ruleStats.avgSpeechRate).toBe(267);
    expect(report.ruleStats.pauseCount).toBe(2);

    // 教练总结：mock judge 无 summary 字段 → 回退模板文案
    expect(report.summary).toBeTruthy();
    expect(report.summary).toContain('本次练习总分 30 分');
    expect(report.summary).toContain('未通过');
    expect(report.summary).toContain('最需要改进');
    expect(report.improvementGoal?.title).toBe('避免合规红线话术');
    expect(report.improvementGoal?.suggestion).toContain('删除任何保证提分');

    // 双 judge 字段（mock 含负面词"保证提分" -> 最低档 poor，双 judge 一致）
    expect(report.items).toHaveLength(1);
    const item = report.items[0];
    expect(item.levelKey).toBe('poor');
    expect(item.score).toBe(30);
    expect(typeof item.judgeAgree).toBe('boolean');
    expect(item.judgeAgree).toBe(true);
    expect(item.confidence).toBe(0.95);
    expect(item.isReference).toBe(false);
    expect(item.quote.length).toBeGreaterThan(0);
    // mock judge 对非最高档输出更优话术示范
    expect(item.betterScript).toBeTruthy();

    // 汇总
    expect(report.totalScore).toBe(30);
    expect(report.skillScores).toEqual([
      { skillPointId: 'sp-objection', skillPointName: 'sp-objection', score: 30, maxScore: 100 },
    ]);
    expect(report.id).toBeTruthy();
    expect(report.sessionId).toBe(session.id);
  });

  it('只评 scenario.skillPointIds 覆盖的评分标准；观察项不计分', async () => {
    const extraDefs: ScoreItemDef[] = [
      ...defs,
      {
        ...defs[0],
        id: 'item-other',
        skillPointId: 'sp-closing',
        name: '不在场景内的项',
      },
      {
        ...defs[0],
        id: 'item-obs',
        name: '观察项',
        isObservation: true,
      },
    ];
    const report = await scoreSession(session, scenario, extraDefs, gateway);
    // item-other 不属于场景技能点，被排除；item-obs 进 items 但不计分
    expect(report.items.map((i) => i.itemId).sort()).toEqual(['item-obj-1', 'item-obs']);
    expect(report.totalScore).toBe(30);
    expect(report.items.find((i) => i.itemId === 'item-obs')!.isObservation).toBe(true);
  });

  it('场景有 category 时评该分类库全部标准（不受技能点限制）；无 category 时按技能点过滤', async () => {
    const categorized: ScoreItemDef[] = [
      { ...defs[0], id: 'item-ground-1', category: '地推' },
      { ...defs[0], id: 'item-ground-2', skillPointId: 'sp-closing', category: '地推' },
      { ...defs[0], id: 'item-reception-1', category: '咨询接待' },
      { ...defs[0], id: 'item-legacy' },
    ];
    const withCategory = await scoreSession(
      session,
      { ...scenario, category: '地推' },
      categorized,
      gateway
    );
    // 地推分类全部纳入（item-ground-2 虽属其他技能点也评），未分类视为通用一并纳入；其他分类排除
    expect(withCategory.items.map((i) => i.itemId).sort()).toEqual([
      'item-ground-1',
      'item-ground-2',
      'item-legacy',
    ]);

    const withoutCategory = await scoreSession(session, scenario, categorized, gateway);
    // 无 category：只按技能点过滤（item-ground-2 属 sp-closing，不在场景技能点内）
    expect(withoutCategory.items.map((i) => i.itemId).sort()).toEqual([
      'item-ground-1',
      'item-legacy',
      'item-reception-1',
    ]);
  });

  it('skillPointNames 选项把技能点 id 映射为名称', async () => {
    const report = await scoreSession(session, scenario, defs, gateway, {
      skillPointNames: { 'sp-objection': '异议处理' },
    });
    expect(report.skillScores[0].skillPointName).toBe('异议处理');
  });

  it('考题维度：total 为各题满分之和（含答错题）', async () => {
    const withQuiz: Session = {
      ...session,
      quizResults: [
        {
          quizId: 'q1',
          answer: ['a'],
          correct: true,
          score: 10,
          maxScore: 10,
          atTurnSeq: 2,
          answeredAt: '2026-01-01T10:01:00Z',
        },
        {
          quizId: 'q2',
          answer: ['b'],
          correct: false,
          score: 0,
          maxScore: 10,
          atTurnSeq: 3,
          answeredAt: '2026-01-01T10:02:00Z',
        },
      ],
    };
    const report = await scoreSession(withQuiz, scenario, defs, gateway);
    expect(report.quizScore).toBeDefined();
    expect(report.quizScore!.earned).toBe(10);
    expect(report.quizScore!.total).toBe(20);
  });

  it('忌讳项换算为信心指数，不进入基础分加权平均或技能点得分', async () => {
    const deductionGateway: LLMGateway = {
      forTask: () => new MockLLMProvider((messages) => String(messages[0]?.content).includes('评分标准：销售忌讳')
        ? JSON.stringify({ score: 20, rationale: '两次忌讳', betterScript: '' })
        : JSON.stringify({ levelKey: 'poor', rationale: '基础项得分', betterScript: '' })),
    };
    const report = await scoreSession(session, scenario, [
      ...defs,
      { ...defs[0], id: 'sales-taboo', name: '销售忌讳', scoringMode: 'score', deductionOnly: true, weight: 0 },
    ], deductionGateway);
    const taboo = report.items.find((item) => item.itemId === 'sales-taboo');
    expect(taboo?.score).toBe(20);
    expect(taboo?.isDeduction).toBe(true);
    expect(report.baseScore).toBe(30);
    expect(report.confidenceIndex).toBe(0.8);
    expect(report.totalScore).toBe(24);
    expect(report.skillScores).toEqual([
      { skillPointId: 'sp-objection', skillPointName: 'sp-objection', score: 30, maxScore: 100 },
    ]);
  });

  it('拒听场不评主动性确定试听时间', async () => {
    const direct = RECEPTION_QUESTION_POOL.find((item) => item.question === '不用试听，我们到时候看一下直接报名吧。')!;
    const declinedSession: Session = {
      ...session,
      receptionQuestions: [{ ...direct }, ...RECEPTION_QUESTION_POOL.slice(0, 9)].map((item) => ({ ...item })),
      receptionTrialDisposition: 'decline',
    };
    const receptionDefs: ScoreItemDef[] = [
      { ...defs[0], category: '咨询接待' },
      { ...defs[0], id: 'item-trial-initiative', name: '主动性确定试听时间', category: '咨询接待' },
    ];
    const report = await scoreSession(
      declinedSession,
      { ...scenario, category: '咨询接待' },
      receptionDefs,
      gateway
    );
    expect(report.items.map((item) => item.itemId)).toEqual(['item-obj-1']);
  });

  it('独立评分标准最多3项并行，避免逐项串行等待', async () => {
    let active = 0;
    let maxActive = 0;
    const delayedGateway: LLMGateway = {
      forTask: () => ({
        name: 'delayed-mock',
        chat: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return {
            model: 'delayed-mock',
            content: JSON.stringify({ levelKey: 'good', quote: '课时费', quoteTurnSeq: 5, rationale: '回答完整', betterScript: '' }),
          };
        },
      }),
    };
    const parallelDefs = Array.from({ length: 4 }, (_, index) => ({ ...defs[0], id: `item-parallel-${index}` }));
    const report = await scoreSession(session, scenario, parallelDefs, delayedGateway);
    expect(report.items).toHaveLength(4);
    expect(maxActive).toBeGreaterThan(2);
    expect(maxActive).toBeLessThanOrEqual(6);
  });

  it('地推最后机会后仍不推进时报告未完成并优先改进首个缺失步骤', async () => {
    const groundDefs: ScoreItemDef[] = [{
      ...defs[0],
      id: 'ground-initiative',
      name: '地推主动性',
      category: '地推',
      levels: [{ key: 'fail', label: '不合格', score: 0, description: '没有推进' }],
    }];
    const report = await scoreSession(
      {
        ...session,
        scenarioId: 'scenario-ground',
        completionStatus: 'incomplete',
        completionReason: '客户已给最后推进机会，但学员仍只有空泛邀请，没有售卖邀请函或约定时间。',
      },
      { ...scenario, id: 'scenario-ground', category: '地推' },
      groundDefs,
      gateway
    );
    expect(report.totalScore).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.completionStatus).toBe('incomplete');
    expect(report.items[0].score).toBe(0);
    expect(report.items[0].rationale).toContain('最后推进机会');
    expect(report.improvementGoal?.title).toBe('先让家长拿上邀请函');
    expect(report.improvementGoal?.suggestion).toContain('您拿上邀请函');
    expect(report.summary).toContain('本场演练未完成');
  });

  it('未能说服孩子时按卖邀请函失败给出沟通策略建议', async () => {
    const childDefs: ScoreItemDef[] = [{
      ...defs[0],
      id: 'ground-child-strategy',
      name: '跟孩子沟通策略',
      category: '地推',
      levels: [{ key: 'fail', label: '不合格', score: 0, description: '策略不当' }],
    }];
    const report = await scoreSession(
      {
        ...session,
        scenarioId: 'scenario-ground',
        completionStatus: 'incomplete',
        completionReason: '卖邀请函失败：销售未能用合理策略说服孩子。',
      },
      { ...scenario, id: 'scenario-ground', category: '地推' },
      childDefs,
      gateway
    );
    expect(report.completionStatus).toBe('incomplete');
    expect(report.improvementGoal?.title).toBe('改进与孩子沟通的策略');
    expect(report.improvementGoal?.suggestion).toContain('先给孩子情感支持');
    expect(report.improvementGoal?.suggestion).toContain('能逗孩子开心的故事');
    expect(report.summary).toContain('卖邀请函失败');
  });
});
