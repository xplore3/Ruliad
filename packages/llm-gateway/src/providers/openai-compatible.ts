import type { ChatMessage, ChatOptions, ChatResult, LLMProvider } from '@grasp-mvp/core';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type FetchLike = (url: string, init?: any) => Promise<any>;

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** OpenAI 兼容协议 provider（千问/火山/DeepSeek 等同协议厂商均可接入） */
export class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai-compatible';

  constructor(
    private config: OpenAICompatibleConfig,
    private fetchFn?: FetchLike
  ) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const f = this.fetchFn ?? fetch;
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
    };
    if (options?.jsonMode) body.response_format = { type: 'json_object' };
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const res = await f(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM request failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    const choice = json.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      model: json.model ?? this.config.model,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }
}
