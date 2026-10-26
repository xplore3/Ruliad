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
