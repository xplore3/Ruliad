import { expect, it } from 'vitest';
import type { LLMProvider } from '@grasp-mvp/core';
import { analyzeExpressionIntent } from './intent.js';

it('语气与意图独立返回，playful 与 promise 可以共存', async () => {
  const provider: LLMProvider = {
    name: 'mock',
    chat: async () => ({
      content: JSON.stringify({ tone: 'playful', intent: 'persuasion', confidence: 0.9, rationale: '虚构孩子台词和角色模仿' }),
      model: 'mock',
    }),
  };
  const result = await analyzeExpressionIntent(provider, {
    seq: 1,
    speaker: 'trainee',
    text: '孩子过来以后，一定会跟您说：妈妈，围棋太好玩了，我要学围棋！',
    at: new Date().toISOString(),
  }, '咨询接待');

  expect(result).toEqual({ tone: 'playful', intent: 'persuasion', confidence: 0.9, rationale: '虚构孩子台词和角色模仿' });
});
