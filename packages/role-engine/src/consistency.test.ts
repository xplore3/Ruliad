import { describe, expect, it } from 'vitest';
import type { LLMProvider, PersonaRuntimeBundle } from '@grasp-mvp/core';
import { checkConsistency, ruleCheck } from './consistency.js';

const mockLlm = (content: string): LLMProvider => ({
  name: 'mock',
  chat: async () => ({ content, model: 'mock' }),
});

const failingLlm: LLMProvider = {
  name: 'failing',
  chat: async () => {
    throw new Error('llm unavailable');
  },
};

const bundle: PersonaRuntimeBundle = {
  personaConfigId: 'persona-wang',
  systemPrompt: '你是王建国。',
  behaviorBands: [],
  knowledgeBoundary: {
    mustNotKnow: ['学员所在保险公司的内部核赔流程'],
    loadedKnowledge: [],
  },
  dynamics: { triggers: [], decayPerTurn: 0.1, baseArousal: 0.3 },
};

describe('ruleCheck', () => {
  it('正常回复通过', () => {
    expect(ruleCheck('理赔的事你放心，出了问题肯定管。')).toEqual([]);
  });

  it('命中 AI 自曝关键词', () => {
    const reasons = ruleCheck('其实我是AI，没法真的买保险。');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('AI 身份泄露');
  });

  it('命中考核泄露关键词', () => {
    const reasons = ruleCheck('你别管评分标准，随便聊。');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('考核信息泄露');
  });
});

describe('checkConsistency', () => {
  it('规则命中时直接判不通过，不调 LLM', async () => {
    let called = false;
    const spyLlm: LLMProvider = {
      name: 'spy',
      chat: async () => {
        called = true;
        return { content: '{"pass":true}', model: 'spy' };
      },
    };
    const result = await checkConsistency(spyLlm, bundle, '作为AI我不能回答。');
    expect(result.pass).toBe(false);
    expect(called).toBe(false);
  });

  it('LLM 判 pass=true 时通过', async () => {
    const result = await checkConsistency(
      mockLlm('{"pass":true,"reason":""}'),
      bundle,
      '价格确实不便宜，但保障到位。'
    );
    expect(result.pass).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('LLM 判 pass=false 时不通过并带原因', async () => {
    const result = await checkConsistency(
      mockLlm('{"pass":false,"reason":"泄露了内部核赔流程"}'),
      bundle,
      '你们公司核赔一般拖俩月。'
    );
    expect(result.pass).toBe(false);
    expect(result.reasons[0]).toContain('核赔');
  });

  it('LLM 输出非法 JSON 时按通过处理', async () => {
    const result = await checkConsistency(mockLlm('not json'), bundle, '正常回复');
    expect(result.pass).toBe(true);
  });

  it('LLM 调用异常时按通过处理', async () => {
    const result = await checkConsistency(failingLlm, bundle, '正常回复');
    expect(result.pass).toBe(true);
  });
});
