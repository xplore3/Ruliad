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

import { describe, expect, it } from 'vitest';
import type { LLMGateway } from '@grasp-mvp/core';
import { SCENARIO_GUIDANCES } from '../seed-guidance.data.js';
import { composeBriefing } from './guidance.js';

describe('现场成交示范讲解', () => {
  it('按配置的原文逐段返回，不调用大模型改写', async () => {
    const guidance = SCENARIO_GUIDANCES.find((item) => item.id === 'guidance-negotiation');
    if (!guidance) throw new Error('缺少现场成交指引配置');
    const gateway = {
      forTask: () => {
        throw new Error('原文讲解不应调用大模型');
      },
    } as unknown as LLMGateway;

    const lines = await composeBriefing(gateway, guidance, []);

    expect(guidance.briefingMode).toBe('verbatim');
    expect(lines).toEqual(guidance.keyPoints);
    expect(lines[0]).toBe('现场谈判十分复杂，包含多种技巧，也并非只有一种方式可以达成结果。这里尽量讲到最重要的东西。谈判既是一门科学，也是一门艺术。首先最好的营销应该是价值观得契合，其作用甚至甚于产品的优势或者需求的满足。');
    expect(lines.at(-1)).toBe('假如客户暂时不适合购买产品，那就给他留下好印象，也许将来他会向很多人推荐你的产品，如果通过虚假承诺或者夸大其词，让他购买了不合适的产品，他将会跟很多人说你的坏话。');
    expect(lines.every((line) => line.length <= 500)).toBe(true);
  });
});
