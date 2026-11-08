import { describe, expect, it } from 'vitest';
import type { LLMGateway, ScoreItemDef, Session } from '@grasp-mvp/core';
import { MockLLMProvider, type MockHandler } from '@grasp-mvp/llm-gateway';
import { judgeItem } from './judge.js';

const def: ScoreItemDef = {
  id: 'item-1',
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
};

const session: Session = {
  id: 'session-judge-1',
  tenantId: 'tenant-demo',
  userId: 'user-trainee-1',
  scenarioId: 'scenario-objection',
  mode: 'practice',
  status: 'completed',
  transcript: [
    { seq: 1, speaker: 'persona', text: '你们理赔是不是很慢？', at: '2026-01-01T10:00:00Z' },
    { seq: 2, speaker: 'trainee', text: '不会的，您放心。', at: '2026-01-01T10:00:05Z' },
  ],
  emotionTrace: [],
  hintsUsed: 0,
  startedAt: '2026-01-01T10:00:00Z',
  endedAt: '2026-01-01T10:01:00Z',
};

function gatewayWith(output: string): LLMGateway {
  const handler: MockHandler = () => output;
  return { forTask: () => new MockLLMProvider(handler) };
}

describe('judgeItem 定量计分（quantitativeRule）', () => {
  const quantDef: ScoreItemDef = {
    ...def,
    id: 'item-quant',
    name: '语速调',
    scoringMode: 'score',
    quantitativeRule: {
      blocks: [
        {
          label: '激情度',
          maxScore: 40,
          metrics: [
            { metric: 'pitchVarSemitones', bands: [{ min: 3, score: 100 }, { min: 1, max: 3, score: 40 }, { max: 1, score: 10 }] },
            { metric: 'loudnessRangeDb', bands: [{ min: 7, score: 100 }, { max: 7, score: 20 }] },
          ],
        },
        {
          label: '语速',
          maxScore: 20,
          metrics: [
            { metric: 'speechRateCpm', bands: [{ min: 240, max: 300, score: 100 }, { min: 320, score: 15 }, { score: 50 }] },
          ],
        },
      ],
    },
  };
  const voiceStats = {
    interruptions: 0,
    fillerCounts: {},
    coverageHits: [],
    coverageMisses: [],
    talkRatio: 0.5,
    avgSpeechRate: 200,
    pauseCount: 0,
    voice: { turns: 2, avgLoudnessDbfs: -24, loudnessRangeDb: 8, pitchVarSemitones: 3.4, speechRateCpm: 270 },
  };

  it('分数由查表确定，LLM 输出无法改分', async () => {
    // LLM 试图给 999 分，结果仍应按表计算：激情度 (100+100)/2→40，语速 270→100→20，总分 60
    const gateway = gatewayWith(JSON.stringify({ rationale: '表现有激情', betterScript: '', score: 999 }));
    const result = await judgeItem(quantDef, session, gateway, undefined, undefined, voiceStats);
    expect(result.score).toBe(60);
    expect(result.rationale).toContain('表现有激情');
    expect(result.rationale).toContain('激情度40/40');
    expect(result.rationale).not.toMatch(/半音|dB|Hz|F0|RMS|标准差|动态范围|个人基线/);
  });

  it('缺声学数据时按中间分计并用易懂语言注明', async () => {
    const gateway = gatewayWith('不是 JSON'); // LLM 也失败 → 回退计表明细
    const result = await judgeItem(quantDef, session, gateway, undefined, undefined, {
      ...voiceStats,
      voice: undefined,
    });
    // 全部 metric 无数据：每块 50% → 40×0.5 + 20×0.5 = 30
    expect(result.score).toBe(30);
    expect(result.rationale).toContain('语音数据不足');
    expect(result.rationale).not.toMatch(/半音|dB|Hz|F0|RMS|标准差|动态范围|个人基线/);
  });

  it('锚点线性插值：区间内连续取分，无档位悬崖', async () => {
    const pointsDef: ScoreItemDef = {
      ...def,
      id: 'item-points',
      name: '语速调',
      scoringMode: 'score',
      quantitativeRule: {
        blocks: [
          {
            label: '激情度',
            maxScore: 100,
            metrics: [
              {
                metric: 'pitchVarSemitones',
                points: [
                  { value: 4.5, score: 45 },
                  { value: 5.5, score: 70 },
                  { value: 7, score: 100 },
                ],
              },
            ],
          },
        ],
      },
    };
    const gateway = gatewayWith(JSON.stringify({ rationale: 'ok', betterScript: '' }));
    const statsAt = (pitch: number) => ({
      ...voiceStats,
      voice: { ...voiceStats.voice, pitchVarSemitones: pitch },
    });
    // 区间中点：4.5~5.5 之间 5.0 → (45+70)/2 ≈ 58（四舍五入）
    const mid = await judgeItem(pointsDef, session, gateway, undefined, undefined, statsAt(5.0));
    expect(mid.score).toBe(58);
    // 差 0.02 不再翻档：5.49 与 5.51 只差 1 分
    const justBelow = await judgeItem(pointsDef, session, gateway, undefined, undefined, statsAt(5.49));
    const justAbove = await judgeItem(pointsDef, session, gateway, undefined, undefined, statsAt(5.51));
    expect(Math.abs(justAbove.score - justBelow.score)).toBeLessThanOrEqual(1);
    // 两端外取端点分
    const low = await judgeItem(pointsDef, session, gateway, undefined, undefined, statsAt(2.0));
    expect(low.score).toBe(45);
    const high = await judgeItem(pointsDef, session, gateway, undefined, undefined, statsAt(9.0));
    expect(high.score).toBe(100);
  });

  it('表达流畅度按确定性指标折算为独立 10 分块', async () => {
    const fluencyDef: ScoreItemDef = {
      ...def,
      id: 'item-fluency',
      scoringMode: 'score',
      quantitativeRule: {
        blocks: [{
          label: '表达流畅度',
          maxScore: 10,
          metrics: [{ metric: 'fluencyScore', points: [{ value: 0, score: 0 }, { value: 100, score: 100 }] }],
        }],
      },
    };
    const gateway = gatewayWith(JSON.stringify({ rationale: '说话比较流畅', betterScript: '' }));
    const result = await judgeItem(fluencyDef, session, gateway, undefined, undefined, { ...voiceStats, fluencyScore: 80 });
    expect(result.score).toBe(8);
    expect(result.rationale).toContain('表达流畅度8/10');
  });

  it('语速在适中区间或客户语速匹配区间任一中即取较高分', async () => {
    const rateDef: ScoreItemDef = {
      ...def,
      id: 'item-customer-rate',
      scoringMode: 'score',
      quantitativeRule: {
        blocks: [{
          label: '语速从容',
          maxScore: 40,
          metrics: [{
            metric: 'speechRateCpm',
            points: [
              { value: 100, score: 25 },
              { value: 150, score: 60 },
              { value: 180, score: 100 },
              { value: 260, score: 100 },
              { value: 300, score: 60 },
              { value: 360, score: 30 },
            ],
          }],
        }],
      },
    };
    const gateway = gatewayWith(JSON.stringify({ rationale: '语速适中', betterScript: '' }));
    const statsAt = (speechRateCpm: number) => ({
      ...voiceStats,
      voice: { ...voiceStats.voice, speechRateCpm },
    });
    const moderate = await judgeItem(rateDef, session, gateway, undefined, undefined, statsAt(300));
    expect(moderate.score).toBe(24);
    const customerMatch = await judgeItem(rateDef, session, gateway, undefined, undefined, statsAt(300), undefined, 1.2);
    expect(customerMatch.score).toBe(40);
    const slowerCustomerMatch = await judgeItem(rateDef, session, gateway, undefined, undefined, statsAt(150), undefined, 0.8);
    expect(slowerCustomerMatch.score).toBe(40);
  });
});

describe('judgeItem betterScript', () => {
  it('judge 输出含 betterScript 时透传到结果', async () => {
    const gateway = gatewayWith(
      JSON.stringify({
        levelKey: 'ok',
        quote: '不会的，您放心。',
        quoteTurnSeq: 2,
        rationale: '有回应但缺乏共情',
        betterScript: '理解您的担心，我先说下我们的理赔时效承诺。',
      })
    );
    const result = await judgeItem(def, session, gateway);
    expect(result.betterScript).toBe('理解您的担心，我先说下我们的理赔时效承诺。');
  });

  it('judge 输出缺 betterScript 字段时结果为 undefined', async () => {
    const gateway = gatewayWith(
      JSON.stringify({
        levelKey: 'ok',
        quote: '不会的，您放心。',
        quoteTurnSeq: 2,
        rationale: '有回应但缺乏共情',
      })
    );
    const result = await judgeItem(def, session, gateway);
    expect(result.betterScript).toBeUndefined();
  });

  it('最高档空串 betterScript 归一为 undefined', async () => {
    const gateway = gatewayWith(
      JSON.stringify({
        levelKey: 'good',
        quote: '不会的，您放心。',
        quoteTurnSeq: 2,
        rationale: '先共情澄清再回应',
        betterScript: '',
      })
    );
    const result = await judgeItem(def, session, gateway);
    expect(result.levelKey).toBe('good');
    expect(result.betterScript).toBeUndefined();
  });

  it('judge 输出非法 JSON 回退中间档且 betterScript 为 undefined', async () => {
    const gateway = gatewayWith('这不是 JSON');
    const result = await judgeItem(def, session, gateway);
    expect(result.levelKey).toBe('ok');
    expect(result.betterScript).toBeUndefined();
  });
});

describe('地推礼貌礼仪的客户主动告别', () => {
  const politenessDef: ScoreItemDef = {
    ...def,
    id: 'item-politeness',
    name: '礼貌礼仪',
    category: '地推',
    judgePrompt: '购买后应致谢，需要学员回应的告别环节应礼貌收尾。',
    levels: [
      { key: 'excellent', label: '优秀', score: 100, description: '整体礼貌' },
      { key: 'good', label: '良好', score: 75, description: '遗漏一次礼貌环节' },
      { key: 'pass', label: '待提升', score: 50, description: '整体礼貌不足' },
      { key: 'fail', label: '不合格', score: 0, description: '明确不尊重客户' },
    ],
  };
  const groundScenario = {
    id: 'scenario-ground',
    tenantId: 'tenant-demo',
    name: '地推销售',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-compliance'],
    successCriteria: { passScore: 70 },
    durationMinutes: 25,
    difficulty: 1,
    category: '地推' as const,
  };
  const farewellSession: Session = {
    ...session,
    scenarioId: groundScenario.id,
    transcript: [
      { seq: 1, speaker: 'trainee', text: '谢谢您的信任和支持，感谢您参加我们的试听课。', at: '2026-01-01T10:00:00Z' },
      { seq: 2, speaker: 'persona', text: '那我们先走了啊，周六见。', at: '2026-01-01T10:00:05Z' },
    ],
  };

  function capturingGateway(output: string, prompts: string[]): LLMGateway {
    const handler: MockHandler = (messages) => {
      const content = messages[0].content;
      prompts.push(typeof content === 'string' ? content : '');
      return output;
    };
    return { forTask: () => new MockLLMProvider(handler) };
  }

  it('客户说先走了和周六见后结束演练不算学员遗漏告别', async () => {
    const prompts: string[] = [];
    const gateway = capturingGateway(JSON.stringify({
      levelKey: 'excellent',
      quote: '谢谢您的信任和支持',
      quoteTurnSeq: 1,
      rationale: '整体礼貌，客户主动告别并自然结束演练。',
      betterScript: '',
    }), prompts);

    const result = await judgeItem(politenessDef, farewellSession, gateway, groundScenario);
    expect(result.score).toBe(100);
    expect(prompts).toHaveLength(2);
    expect(prompts.every((prompt) => prompt.includes('客户主动说') && prompt.includes('禁止因此扣分'))).toBe(true);
  });

  it('客户尚未告别时不错误追加自然结束豁免', async () => {
    const prompts: string[] = [];
    const gateway = capturingGateway(JSON.stringify({
      levelKey: 'good',
      quote: '我回家考虑一下',
      quoteTurnSeq: 2,
      rationale: '整体礼貌，但告别尚未完成。',
      betterScript: '',
    }), prompts);
    const pendingSession: Session = {
      ...farewellSession,
      transcript: [
        farewellSession.transcript[0],
        { seq: 2, speaker: 'persona', text: '我回家考虑一下。', at: '2026-01-01T10:00:05Z' },
      ],
    };

    const result = await judgeItem(politenessDef, pendingSession, gateway, groundScenario);
    expect(result.score).toBe(75);
    expect(prompts.every((prompt) => !prompt.includes('本场告别事实'))).toBe(true);
  });

  it('客户主动告别不豁免其他明确不礼貌表达', async () => {
    const prompts: string[] = [];
    const gateway = capturingGateway(JSON.stringify({
      levelKey: 'fail',
      quote: '不用你妹呀',
      quoteTurnSeq: 1,
      rationale: '存在明确不尊重客户的表达。',
      betterScript: '',
    }), prompts);
    const rudeSession: Session = {
      ...farewellSession,
      transcript: [
        { seq: 1, speaker: 'trainee', text: '不用你妹呀。', at: '2026-01-01T10:00:00Z' },
        farewellSession.transcript[1],
      ],
    };

    const result = await judgeItem(politenessDef, rudeSession, gateway, groundScenario);
    expect(result.score).toBe(0);
    expect(prompts.every((prompt) => prompt.includes('其他明确的不礼貌行为仍按标准判定'))).toBe(true);
  });
});

describe('地推甄别客户意向的递卡判定', () => {
  const intentDef: ScoreItemDef = {
    ...def,
    id: 'item-ground-intent',
    name: '甄别客户意向',
    category: '地推',
    scoringMode: 'score',
    judgePrompt: '有试听活动介绍但缺少明确递卡动作只得20分；客户未经学员引导自己拿卡不算。',
    levels: [],
  };
  const groundScenario = {
    id: 'scenario-ground',
    tenantId: 'tenant-demo',
    name: '地推销售',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-need'],
    successCriteria: { passScore: 70 },
    durationMinutes: 25,
    difficulty: 1,
    category: '地推' as const,
  };
  const handoffSession: Session = {
    ...session,
    scenarioId: groundScenario.id,
    transcript: [
      { seq: 6, speaker: 'trainee', text: '我们想邀请您带孩子来参加我们的围棋试听活动。来，您拿上，我给您介绍一下。', at: '2026-01-01T10:00:00Z' },
      { seq: 7, speaker: 'persona', text: '（客户放慢了脚步，接过邀请函看了看）哦，围棋啊。', at: '2026-01-01T10:00:05Z' },
    ],
  };

  function capturingGateway(output: string, prompts: string[]): LLMGateway {
    const handler: MockHandler = (messages) => {
      const content = messages[0].content;
      prompts.push(typeof content === 'string' ? content : '');
      return output;
    };
    return { forTask: () => new MockLLMProvider(handler) };
  }

  it('您拿上结合客户接过邀请函属于学员明确引导递卡', async () => {
    const prompts: string[] = [];
    const gateway = capturingGateway(JSON.stringify({
      score: 100,
      quote: '来，您拿上，我给您介绍一下。',
      quoteTurnSeq: 6,
      rationale: '已介绍活动并明确引导客户拿上邀请函。',
      betterScript: '',
    }), prompts);

    const result = await judgeItem(intentDef, handoffSession, gateway, groundScenario);
    expect(result.score).toBe(100);
    expect(prompts.every((prompt) => prompt.includes('本场递卡事实') && prompt.includes('自然口语中省略'))).toBe(true);
    expect(prompts.every((prompt) => prompt.includes('不得把客户后续接卡认定为未经引导') || prompt.includes('也不得把客户后续接卡认定为未经引导'))).toBe(true);
  });

  it('客户未经引导自己拿卡时不追加已完成递卡事实', async () => {
    const prompts: string[] = [];
    const gateway = capturingGateway(JSON.stringify({
      score: 20,
      quote: '客户自己接过邀请函',
      quoteTurnSeq: 7,
      rationale: '有活动介绍，但学员没有递卡引导。',
      betterScript: '来，您先拿上邀请函。',
    }), prompts);
    const selfServeSession: Session = {
      ...handoffSession,
      transcript: [
        { seq: 6, speaker: 'trainee', text: '我们想邀请您带孩子来参加我们的围棋试听活动。', at: '2026-01-01T10:00:00Z' },
        handoffSession.transcript[1],
      ],
    };

    const result = await judgeItem(intentDef, selfServeSession, gateway, groundScenario);
    expect(result.score).toBe(20);
    expect(prompts.every((prompt) => !prompt.includes('本场递卡事实'))).toBe(true);
    expect(prompts.every((prompt) => prompt.includes('客户未经学员引导自己拿卡不算'))).toBe(true);
  });
});

describe('地推改进话术的具体业务动作', () => {
  const actionDef: ScoreItemDef = {
    ...def,
    id: 'item-ground-action',
    name: '坚持销售邀请函',
    category: '地推',
    scoringMode: 'score',
    levels: [],
  };
  const groundScenario = {
    id: 'scenario-ground',
    tenantId: 'tenant-demo',
    name: '地推销售',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-closing'],
    successCriteria: { passScore: 70 },
    durationMinutes: 25,
    difficulty: 1,
    category: '地推' as const,
  };

  it('您看一下等没有业务动作的建议自动改为具体推进话术', async () => {
    const gateway = gatewayWith(JSON.stringify({
      score: 0,
      quote: '您看一下',
      quoteTurnSeq: 2,
      rationale: '没有推进客户接卡和登记。',
      betterScript: '您看一下。',
    }));

    const result = await judgeItem(actionDef, session, gateway, groundScenario);
    expect(result.betterScript).toBe('来，您拿上邀请函，我给您登记姓名和电话，再约孩子周六到校体验。');
  });

  it('已经包含具体动作的话术保持原样', async () => {
    const betterScript = '来，您拿上邀请函，先填写姓名和电话，我再帮您约周六试听。';
    const gateway = gatewayWith(JSON.stringify({
      score: 0,
      quote: '您看一下',
      quoteTurnSeq: 2,
      rationale: '需要继续推进。',
      betterScript,
    }));

    const result = await judgeItem(actionDef, session, gateway, groundScenario);
    expect(result.betterScript).toBe(betterScript);
  });
});
