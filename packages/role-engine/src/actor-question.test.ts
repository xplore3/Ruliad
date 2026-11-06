import { expect, it } from 'vitest';
import type { BehaviorBand, PersonaRuntimeBundle } from '@grasp-mvp/core';
import { PersonaActor } from './actor.js';

it('提取咨询接待固定题号且不把内部标记交给用户', async () => {
  const actor = new PersonaActor({
    name: 'mock',
    chat: async () => ({ model: 'mock', content: '对了，学这个是不是男孩比较多？[[Q:8]]' }),
  });
  const reply = await actor.replyWithSignal(
    { systemPrompt: '测试' } as PersonaRuntimeBundle,
    { key: 'neutral', instruction: '自然回应' } as BehaviorBand,
    []
  );
  expect(reply.questionIndex).toBe(8);
  expect(reply.text).toBe('对了，学这个是不是男孩比较多？');
  expect(reply.shouldClose).toBe(false);
});
