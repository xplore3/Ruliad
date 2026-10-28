import type { ChatMessage, ChatOptions, ChatResult, LLMProvider } from '@grasp-mvp/core';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type FetchLike = (url: string, init?: any) => Promise<any>;

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 请求超时（毫秒，默认 60000）：网络异常时避免 fetch 永久挂起 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** OpenAI 兼容协议 provider（千问/火山/DeepSeek 等同协议厂商均可接入） */
export class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai-compatible';

  constructor(
    private config: OpenAICompatibleConfig,
    private fetchFn?: FetchLike
  ) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const f = this.fetchFn ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
    };
    if (options?.jsonMode) body.response_format = { type: 'json_object' };
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    // AbortController 超时：网络异常时 fetch 不会永久挂起，超时抛带明确信息的错误
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let json: any;
    try {
      const res = await f(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`LLM request failed: ${res.status} ${text}`);
      }
      // 响应体读取也在超时保护内（慢响应/流挂起同样受控）
      json = await res.json();
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(
          `LLM 请求超时（${timeoutMs}ms）：model=${this.config.model} url=${url}，可用 LLM_TIMEOUT_MS 调整超时`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const choice = json.choices?.[0];
    let content = choice?.message?.content ?? '';

    // 如果 content 为空但存在 completionTokens，可能是模型返回了 tool_calls 或格式异常
    if (!content && json.usage?.completion_tokens > 0) {
      // 尝试从 tool_calls 中提取内容
      const toolCalls = choice?.message?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        const toolContent = toolCalls
          .map((tc: any) => tc.function?.arguments ?? '')
          .join(' ')
          .trim();
        if (toolContent) {
          content = toolContent;
        }
      }
    }

    // 如果仍然为空，抛出明确错误便于上层重试
    if (!content) {
      throw new Error(`LLM 返回空内容：model=${json.model ?? this.config.model}, completionTokens=${json.usage?.completion_tokens ?? 0}`);
    }

    return {
      content,
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
