import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@grasp-mvp/core';
import { MockLLMProvider } from './providers/mock.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.js';
import { createLLMGateway } from './gateway.js';

const judgePrompt = `
评分标准：价格异议首反应
可选档位：[{"key":"concede","label":"降价妥协","score":1},{"key":"clarify","label":"追问澄清","score":2},{"key":"value","label":"价值重述","score":3}]
对话记录：
[1] 学员：您好，给您介绍一下我们的产品
[2] 客户：太贵了别家便宜30%
[3] 学员：那我们可以给您打个折
`;

describe('createLLMGateway', () => {
  it('无 API Key 时所有任务路由到 mock', () => {
    const gateway = createLLMGateway({});
    for (const task of ['actor', 'judge', 'judge_secondary', 'extractor'] as const) {
      expect(gateway.forTask(task).name).toBe('mock');
    }
  });

  it('有 API Key 时路由到 openai-compatible，judge_secondary 无独立配置时回退主 judge', () => {
    const gateway = createLLMGateway({ LLM_API_KEY: 'k', LLM_MODEL: 'm1' });
    expect(gateway.forTask('actor').name).toBe('openai-compatible');
    expect(gateway.forTask('judge').name).toBe('openai-compatible');
    expect(gateway.forTask('judge_secondary').name).toBe('openai-compatible');
  });

  it('LLM_PROVIDER 风格配置生效（DEEPSEEK_API_KEY + 预设 baseUrl）', () => {
    const gateway = createLLMGateway({
      LLM_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'k',
      DEEPSEEK_CHAT_MODEL: 'deepseek-v4-flash',
    });
    expect(gateway.forTask('actor').name).toBe('openai-compatible');
    expect(gateway.forTask('judge').name).toBe('openai-compatible');
  });

  it('LLM_PROVIDER 风格优先于传统 LLM_API_KEY', () => {
    const gateway = createLLMGateway({
      LLM_PROVIDER: 'qwen',
      QWEN_API_KEY: 'qk',
      LLM_API_KEY: 'legacy',
    });
    expect(gateway.forTask('actor').name).toBe('openai-compatible');
  });

  it('onUsage 被触发', async () => {
    const usages: string[] = [];
    const gateway = createLLMGateway({}, { onUsage: (i) => usages.push(i.task) });
    await gateway.forTask('actor').chat([{ role: 'user', content: '你好' }]);
    expect(usages).toEqual(['actor']);
  });
});

describe('MockLLMProvider', () => {
  const provider = new MockLLMProvider();
  const messages: ChatMessage[] = [
    { role: 'system', content: '你是客户' },
    { role: 'user', content: '这个价格你觉得怎么样？' },
  ];

  it('确定性：同输入两次结果一致', async () => {
    const a = await provider.chat(messages);
    const b = await provider.chat(messages);
    expect(a.content).toBe(b.content);
  });

  it('actor 回复非空且简短', async () => {
    const r = await provider.chat(messages);
    expect(r.content.length).toBeGreaterThan(0);
    expect(r.content.length).toBeLessThan(60);
  });

  it('jsonMode 返回可解析 JSON 且 levelKey 来自 prompt 候选', async () => {
    const r = await provider.chat([{ role: 'user', content: judgePrompt }], { jsonMode: true });
    const parsed = JSON.parse(r.content);
    expect(['concede', 'clarify', 'value']).toContain(parsed.levelKey);
    expect(typeof parsed.quote).toBe('string');
    expect(typeof parsed.quoteTurnSeq).toBe('number');
  });

  it('jsonMode 遇到负面词（打折）倾向最低档', async () => {
    const r = await provider.chat([{ role: 'user', content: judgePrompt }], { jsonMode: true });
    expect(JSON.parse(r.content).levelKey).toBe('concede');
  });
});

describe('OpenAICompatibleProvider', () => {
  it('请求体正确且能解析响应', async () => {
    let captured: { url: string; init: { body: string; headers: Record<string, string> } } | undefined;
    const fakeFetch = async (url: string, init: { body: string; headers: Record<string, string> }) => {
      captured = { url, init };
      return {
        ok: true,
        json: async () => ({
          model: 'm1',
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      };
    };
    const provider = new OpenAICompatibleProvider(
      { apiKey: 'k', baseUrl: 'https://example.com/v1/', model: 'm1' },
      fakeFetch
    );
    const result = await provider.chat([{ role: 'user', content: 'hi' }], { jsonMode: true });
    expect(captured!.url).toBe('https://example.com/v1/chat/completions');
    expect(captured!.init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(captured!.init.body);
    expect(body.model).toBe('m1');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(result.content).toBe('{"ok":true}');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('HTTP 错误抛出异常', async () => {
    const provider = new OpenAICompatibleProvider(
      { apiKey: 'k', baseUrl: 'https://example.com', model: 'm1' },
      async () => ({ ok: false, status: 500, text: async () => 'boom' })
    );
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('500');
  });
});
