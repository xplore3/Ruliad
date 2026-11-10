import { describe, expect, it } from 'vitest';
import type { LLMGateway, ProductKB, Scenario, ScoreItemDef, Session } from '@grasp-mvp/core';
import { MockLLMProvider, type MockHandler } from '@grasp-mvp/llm-gateway';
import { judgeItem } from './judge.js';
import { scoreSession } from './engine.js';

/**
 * 跨场景通用合规标准「合规表达通用规范」：无 category（全部场景统一生效）、独立全局扣分项。
 * 与 packages/infra 的种子数据、add-universal-compliance-standard.mjs 保持一致的定义摘要。
 */
const universalComplianceDef: ScoreItemDef = {
  id: 'item-universal-compliance',
  tenantId: 'tenant-demo',
  skillPointId: 'sp-compliance',
  name: '合规表达通用规范',
  behaviorAnchor:
    '跨场景通用合规表达规范：传递信心一律不扣分；虚构或篡改机构客观事实、对学习结果作确定性保证按程度扣分。',
  judgePrompt:
    '只判定虚假承诺与夸大其词。传递信心（如“您放心，我们一定会让您觉得值得的”）豁免；' +
    '虚构或篡改机构客观事实（如实际8人班谎称2人班）或保证提分保过按程度扣分。',
  weight: 0,
  levels: [],
  layer: 'company',
  isObservation: false,
  scoringMode: 'score',
  deductionOnly: true,
};

const institutionKB: ProductKB = {
  id: 'kb-course',
  tenantId: 'tenant-demo',
  name: '数学思维课程话术手册',
  version: 4,
  effectiveAt: '2026-05-01T00:00:00.000Z',
  entries: [
    {
      id: 'kb-fact-class-size',
      kind: 'keypoint',
      title: '班额设置（客观事实基准）',
      content: '每个班 8 人，满班不再加人，不存在 2 人班或一对一班型。',
    },
    {
      id: 'kb-fact-teacher',
      kind: 'keypoint',
      title: '师资情况（客观事实基准）',
      content: '任课老师为专职教师，具备 3 年以上中小学教学经验，无在校大学生兼职教师。',
    },
  ],
};

const groundScenario: Scenario = {
  id: 'scenario-drill-ground-push',
  tenantId: 'tenant-demo',
  name: '实战·地推逼单',
  personaConfigId: 'persona-parent',
  skillPointIds: ['sp-compliance'],
  successCriteria: { passScore: 70 },
  durationMinutes: 25,
  difficulty: 2,
  category: '地推',
};

/** 真实误判语料：会话 634b8a3b 第14轮（“您放心，我们肯定会让您觉得值得的”曾被误判为虚假承诺） */
const faithTurnSession: Session = {
  id: 'session-compliance-faith',
  tenantId: 'tenant-demo',
  userId: 'user-trainee-1',
  scenarioId: groundScenario.id,
  mode: 'practice',
  status: 'completed',
  transcript: [
    { seq: 13, speaker: 'persona', text: '（客户看了看邀请函，又抬头看销售）你们这儿还要钱啊？别人家都是免费的。', at: '2026-11-10T10:00:00Z' },
    { seq: 14, speaker: 'trainee', text: '大哥，免费的东西大家不珍惜，我们也是希望家长重视这个事儿。您过来以后呢，我们肯定会让您觉得值得的然您觉得不值得，您也不会花时间过来了。来，大哥，给孩子定一个。', at: '2026-11-10T10:00:05Z' },
  ],
  emotionTrace: [],
  hintsUsed: 0,
  startedAt: '2026-11-10T10:00:00Z',
  endedAt: '2026-11-10T10:01:00Z',
};

const lieSession: Session = {
  ...faithTurnSession,
  id: 'session-compliance-lie',
  transcript: [
    { seq: 1, speaker: 'persona', text: '你们一个班多少人啊？人太多了我们也顾不过来。', at: '2026-11-10T10:00:00Z' },
    { seq: 2, speaker: 'trainee', text: '您放心，我们一个班只有2个学生，都是小班教学。', at: '2026-11-10T10:00:05Z' },
  ],
};

function promptText(messages: Array<{ content: unknown }>): string {
  return messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join(String.fromCharCode(10));
}

function gatewayWith(handler: MockHandler): LLMGateway {
  return { forTask: () => new MockLLMProvider(handler) };
}

function capturingGateway(output: string, prompts: string[]): LLMGateway {
  return gatewayWith((messages) => {
    prompts.push(promptText(messages));
    return output;
  });
}

const faithExemptJson = JSON.stringify({
  score: 0,
  dimensions: '未发现虚假承诺（0分）',
  quote: '您过来以后呢，我们肯定会让您觉得值得的',
  quoteTurnSeq: 14,
  rationale: '属于传递信心，不扣分。',
  betterScript: '',
});

describe('合规表达通用规范：传递信心豁免（回归误判语料）', () => {
  it('真实语料“肯定会让您觉得值得的”按传递信心豁免，score=0 且标注独立扣分项', async () => {
    const prompts: string[] = [];
    const gateway = capturingGateway(faithExemptJson, prompts);
    const result = await judgeItem(universalComplianceDef, faithTurnSession, gateway, groundScenario, undefined, undefined, institutionKB);

    expect(result.score).toBe(0);
    expect(result.isDeduction).toBe(true);
    expect(result.itemName).toBe('合规表达通用规范');
    expect(result.betterScript).toBeUndefined();
    // 双 judge 都拿到同一份含豁免规则与机构事实的 prompt
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).toContain('传递信心');
      expect(prompt).toContain('您放心，我们一定会让您觉得值得的');
      expect(prompt).toContain('机构初始化资料');
      expect(prompt).toContain('每个班 8 人');
    }
  });

  it('虚构机构客观事实（实际8人班谎称2人班）按中等程度扣20分并给出合规话术', async () => {
    const prompts: string[] = [];
    const gateway = capturingGateway(
      JSON.stringify({
        score: 20,
        dimensions: '虚构机构客观事实：班额（20分）',
        quote: '我们一个班只有2个学生',
        quoteTurnSeq: 2,
        rationale: '机构实际每班8人，宣称“一个班只有2个学生”属于虚构机构客观事实。',
        betterScript: '我们每个班8人，老师能照顾到每个孩子的进度，您先带孩子来体验。',
      }),
      prompts,
    );
    const result = await judgeItem(universalComplianceDef, lieSession, gateway, groundScenario, undefined, undefined, institutionKB);

    expect(result.score).toBe(20);
    expect(result.isDeduction).toBe(true);
    expect(result.betterScript).toContain('8');
    // 判定依据必须包含班额事实清单
    for (const prompt of prompts) {
      expect(prompt).toContain('每个班 8 人');
      expect(prompt).toContain('不存在 2 人班');
    }
  });

  it('对学习效果作确定性保证（保证提分）进入虚假承诺判定', async () => {
    const session: Session = {
      ...lieSession,
      id: 'session-compliance-guarantee',
      transcript: [
        { seq: 1, speaker: 'persona', text: '你们能保证孩子成绩提高吗？', at: '2026-11-10T10:00:00Z' },
        { seq: 2, speaker: 'trainee', text: '保证提分，学完这一期一定能考级。', at: '2026-11-10T10:00:05Z' },
      ],
    };
    const result = await judgeItem(
      universalComplianceDef,
      session,
      gatewayWith(() =>
        JSON.stringify({ score: 20, dimensions: '对学习结果作绝对化保证（20分）', rationale: '保证提分属于对学习结果的确定性保证。', betterScript: '我们大多数孩子都有进步，但效果因人而异，您先来看试听课。' }),
      ),
      groundScenario,
      undefined,
      undefined,
      institutionKB,
    );
    expect(result.score).toBe(20);
  });

  it('未提供机构资料库时不注入资料段落，判定链路不受影响', async () => {
    const prompts: string[] = [];
    const gateway = capturingGateway(faithExemptJson, prompts);
    const result = await judgeItem(universalComplianceDef, faithTurnSession, gateway, groundScenario);

    expect(result.score).toBe(0);
    for (const prompt of prompts) {
      expect(prompt).not.toContain('机构初始化资料');
      expect(prompt).not.toContain('每个班 8 人');
      expect(prompt).toContain('传递信心');
    }
  });
});

describe('机构资料注入范围隔离', () => {
  it('非通用标准（如礼貌礼仪）的判定 prompt 不注入机构资料', async () => {
    const politenessDef: ScoreItemDef = {
      id: 'item-dt-politeness',
      tenantId: 'tenant-demo',
      skillPointId: 'sp-compliance',
      name: '礼貌礼仪',
      category: '地推',
      behaviorAnchor: '整体礼貌，不对客户不礼貌',
      judgePrompt: '判定学员是否整体礼貌。',
      weight: 1,
      levels: [
        { key: 'excellent', label: '优秀', score: 100, description: '整体礼貌' },
        { key: 'fail', label: '不合格', score: 0, description: '明确不尊重客户' },
      ],
      layer: 'company',
      isObservation: false,
    };
    const prompts: string[] = [];
    await judgeItem(
      politenessDef,
      faithTurnSession,
      capturingGateway(JSON.stringify({ levelKey: 'excellent', quote: '您过来以后呢', quoteTurnSeq: 14, rationale: '整体礼貌', betterScript: '' }), prompts),
      groundScenario,
      undefined,
      undefined,
      institutionKB,
    );
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).not.toContain('机构初始化资料');
      expect(prompt).not.toContain('每个班 8 人');
      expect(prompt).not.toContain('师资情况');
    }
  });
});

describe('scoreSession：跨场景统一执行与不重复扣分', () => {
  const skillDef: ScoreItemDef = {
    id: 'item-icebreak-1',
    tenantId: 'tenant-demo',
    skillPointId: 'sp-icebreak',
    name: '开场与时间承诺',
    category: '地推',
    behaviorAnchor: '开场30秒内自我介绍并给出时间承诺',
    judgePrompt: '判定开场破冰质量。',
    weight: 1,
    levels: [
      { key: 'poor', label: '差', score: 30, description: '无自我介绍' },
      { key: 'ok', label: '中', score: 60, description: '有介绍无时间承诺' },
      { key: 'good', label: '好', score: 90, description: '介绍加时间承诺' },
    ],
    layer: 'company',
    isObservation: false,
  };

  /** 已移交虚假承诺判定的场景专属忌讳项（与 update-taboo-compliance-delegation.mjs 后的口径一致） */
  const delegatedTabooDef: ScoreItemDef = {
    id: 'item-dt-taboo',
    tenantId: 'tenant-demo',
    skillPointId: 'sp-compliance',
    name: '地推销售忌讳',
    category: '地推',
    behaviorAnchor: '地推忌讳：1. 不礼貌；2. 虚假承诺已统一移交「合规表达通用规范」判定，本项不再重复扣分；3. 不诋毁竞品。',
    judgePrompt: '只评第一条和第三条；第二条（虚假承诺）由跨场景通用标准「合规表达通用规范」判定。',
    weight: 0,
    levels: [],
    layer: 'company',
    isObservation: false,
    scoringMode: 'score',
    deductionOnly: true,
  };

  function dispatchHandler(complianceScore: number): MockHandler {
    return (messages) => {
      const prompt = promptText(messages);
      // 场景忌讳项的 prompt 也引用通用标准，必须先匹配场景专属分支
      if (prompt.includes('地推销售忌讳')) {
        // 已移交：虚假承诺不再由场景忌讳重复扣分
        return JSON.stringify({ score: 0, dimensions: '未触犯第一条、第三条', rationale: '未触犯忌讳' });
      }
      if (prompt.includes('合规表达通用规范')) {
        return JSON.stringify({
          score: complianceScore,
          dimensions: complianceScore === 0 ? '未发现虚假承诺（0分）' : '虚构机构客观事实',
          quote: '您过来以后呢，我们肯定会让您觉得值得的',
          quoteTurnSeq: 14,
          rationale: complianceScore === 0 ? '属于传递信心，不扣分。' : '宣称2人班与机构实际8人班不符。',
          betterScript: '',
        });
      }
      return JSON.stringify({ levelKey: 'good', quote: '您过来以后呢', quoteTurnSeq: 14, rationale: '开场有介绍和时间承诺', betterScript: '' });
    };
  }

  it('通用标准无 category 在地推场景默认入选，且与场景忌讳不重复扣分（0/0）', async () => {
    const report = await scoreSession(
      faithTurnSession,
      groundScenario,
      [skillDef, delegatedTabooDef, universalComplianceDef],
      gatewayWith(dispatchHandler(0)),
      { institutionKB },
    );

    const ids = report.items.map((item) => item.itemId);
    expect(ids).toContain('item-universal-compliance');
    expect(ids).toContain('item-dt-taboo');

    const compliance = report.items.find((item) => item.itemId === 'item-universal-compliance')!;
    expect(compliance.score).toBe(0);
    expect(compliance.isDeduction).toBe(true);

    const taboo = report.items.find((item) => item.itemId === 'item-dt-taboo')!;
    expect(taboo.score).toBe(0);
    expect(taboo.isDeduction).toBe(true);

    // 两个独立扣分项都不进入基础分与技能维度
    expect(report.baseScore).toBe(90);
    expect(report.skillScores).toHaveLength(1);
    expect(report.skillScores[0].score).toBe(90);
    expect(report.confidenceIndex).toBe(1);
    expect(report.totalScore).toBe(90);
  });

  it('真实扣分只累加一次：虚构事实扣20 → 基础分90，信心指数0.8，总分72', async () => {
    const report = await scoreSession(
      lieSession,
      groundScenario,
      [skillDef, delegatedTabooDef, universalComplianceDef],
      gatewayWith(dispatchHandler(20)),
      { institutionKB },
    );

    // 基础分只含技能项（90），不含两个扣分项
    expect(report.baseScore).toBe(90);
    expect(report.skillScores).toHaveLength(1);
    // 场景忌讳已移交（0分）+ 通用合规扣20 → 只扣一次
    expect(report.confidenceIndex).toBe(0.8);
    expect(report.totalScore).toBe(72);
  });

  it('通用标准跨场景生效：同一批标准在咨询接待场景仍入选', async () => {
    const receptionScenario: Scenario = {
      ...groundScenario,
      id: 'scenario-reception',
      name: '咨询接待',
      category: '咨询接待',
    };
    const report = await scoreSession(
      faithTurnSession,
      receptionScenario,
      [skillDef, delegatedTabooDef, universalComplianceDef],
      gatewayWith(dispatchHandler(0)),
      { institutionKB },
    );

    const ids = report.items.map((item) => item.itemId);
    // 无 category 的通用标准在任意分类场景统一入选；地推专属标准被排除
    expect(ids).toContain('item-universal-compliance');
    expect(ids).not.toContain('item-icebreak-1');
    expect(ids).not.toContain('item-dt-taboo');
  });
});
