import { expect, it } from 'vitest';
import type { DemoScriptTemplate, LLMGateway } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { performDemoScript } from './guidance.js';

it('电销示范改写后销售保持高激情，柔和句与客户语气不被覆盖', async () => {
  const template: DemoScriptTemplate = {
    lines: [
      { role: 'sales', arousal: 1, excitement: 9, text: '您好，欢迎了解我们的体验课。' },
      { role: 'customer', text: '我想了解一下。' },
      { role: 'sales', arousal: 1, excitement: 9, text: '小朋友，你喜欢吗？', soft: true },
      { role: 'sales', arousal: 1, excitement: 9, text: '欢迎您来体验。' },
    ],
  };
  const gateway: LLMGateway = {
    forTask: () => new MockLLMProvider(() => JSON.stringify({
      lines: [
        { role: 'sales', text: '您好，欢迎了解我们的体验课。', excitement: 2 },
        { role: 'customer', text: '我想了解一下。', excitement: 1 },
        { role: 'sales', text: '小朋友，你喜欢吗？', excitement: 3, soft: true },
        { role: 'sales', text: '欢迎您来体验。', excitement: 1 },
      ],
    })),
  };

  const lines = await performDemoScript(gateway, template, [], 1, '电销');

  expect(lines[0]).toMatchObject({ role: 'sales', arousal: 1, excitement: 9 });
  expect(lines[1]).toMatchObject({ role: 'customer', excitement: 1 });
  expect(lines[2]).toMatchObject({ role: 'sales', excitement: 3, soft: true });
  expect(lines[3]).toMatchObject({ role: 'sales', arousal: 1, excitement: 9 });
});


it('电销家长说出年龄前必须有销售提问', async () => {
  const template: DemoScriptTemplate = {
    lines: [
      { role: 'sales', text: '您好。' },
      { role: 'customer', text: '孩子6岁了。' },
      { role: 'sales', text: '6岁正是黄金年龄。' },
      { role: 'customer', text: '好的。' },
    ],
  };
  const gateway: LLMGateway = {
    forTask: () => new MockLLMProvider(() => JSON.stringify({
      lines: [
        { role: 'sales', text: '您好。' },
        { role: 'customer', text: '孩子6岁了。' },
        { role: 'sales', text: '6岁正是黄金年龄。' },
        { role: 'customer', text: '好的。' },
      ],
    })),
  };

  const lines = await performDemoScript(gateway, template, [], 1, '电销');

  expect(lines[1]).toMatchObject({ role: 'sales', text: '对了，您家孩子今年几岁了？' });
  expect(lines[2]).toMatchObject({ role: 'customer', text: '孩子6岁了。' });
});
