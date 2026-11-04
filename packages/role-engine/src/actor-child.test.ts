import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '@grasp-mvp/core';
import { replyAsChild } from './actor.js';

function provider(content: string): LLMProvider {
  return {
    name: 'mock',
    chat: async () => ({ content, model: 'mock' }),
  };
}

describe('replyAsChild', () => {
  it('孩子仍抗拒时返回 resistant 并移除控制标记', async () => {
    const result = await replyAsChild(provider('我还是不想去。[[RESIST]]'), [], '我们过来玩好不好？');
    expect(result).toEqual({ text: '我还是不想去。', resistant: true });
  });

  it('情感先行和趣味引导均满足后允许松动并移除控制标记', async () => {
    const result = await replyAsChild(provider('哈哈，我想继续听！[[' + 'OPEN]]'), [], '再给你讲个好玩的故事好不好？');
    expect(result).toEqual({ text: '哈哈，我想继续听！', resistant: false });
  });
});
