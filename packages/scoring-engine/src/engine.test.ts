import { describe, expect, it } from 'vitest';
import type { LLMGateway, Scenario, ScoreItemDef, Session } from '@grasp-mvp/core';
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
  name: '保险异议处理',
  personaConfigId: 'persona-wang',
  skillPointIds: ['sp-objection'],
  successCriteria: { passScore: 70 },
  durationMinutes: 10,
  difficulty: 2,
  coverageTopics: ['理赔时效', '增值服务'],
};

const longPersonaText =
  '我跟你说啊，我之前那个保单理赔拖了快两个月，打电话过去每次都是不同的客服，说要补这个材料那个材料，最后我都懒得折腾了，你们这次不会也这样吧？';

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
      text: '其实其实其实，这个产品保证收益，其实您放心就行',
      at: '2026-01-01T10:00:10Z',
    },
    { seq: 3, speaker: 'persona', text: longPersonaText, at: '2026-01-01T10:00:20Z' },
    // 打断启发式：长 persona 轮后学员短回复
    { seq: 4, speaker: 'trainee', text: '哦', at: '2026-01-01T10:00:25Z' },
    // 其实 ×7（合计 11 次，超阈值）+ 覆盖话题 理赔时效
    {
      seq: 5,
      speaker: 'trainee',
      text: '其实其实其实其实其实其实其实，理赔时效我们承诺三十天内处理完毕',
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
    expect(report.ruleStats.coverageHits).toEqual(['理赔时效']);
    expect(report.ruleStats.coverageMisses).toEqual(['增值服务']);
    expect(report.violations.some((v) => v.ruleId === 'coverage-miss' && !v.fatal)).toBe(true);

    // 双 judge 字段（mock 含负面词"保证收益" -> 最低档 poor，双 judge 一致）
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

  it('只评 scenario.skillPointIds 覆盖的评分项；观察项不计分', async () => {
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
});
