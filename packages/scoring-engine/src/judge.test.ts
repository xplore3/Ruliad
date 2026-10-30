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
  });

  it('缺声学数据时按中间分计并注明', async () => {
    const gateway = gatewayWith('不是 JSON'); // LLM 也失败 → 回退计表明细
    const result = await judgeItem(quantDef, session, gateway, undefined, undefined, {
      ...voiceStats,
      voice: undefined,
    });
    // 全部 metric 无数据：每块 50% → 40×0.5 + 20×0.5 = 30
    expect(result.score).toBe(30);
    expect(result.rationale).toContain('无数据');
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
