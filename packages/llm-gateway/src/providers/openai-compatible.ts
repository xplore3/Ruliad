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

interface StreamAccumulation {
  content: string;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** 解析 OpenAI 兼容 SSE；忽略 reasoning_content，只把正式回复增量交给调用方 */
function applySseBlock(block: string, state: StreamAccumulation, onDelta?: (delta: string, content: string) => void): boolean {
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') return true;
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    if (typeof json.model === 'string') state.model = json.model;
    if (json.usage) {
      state.usage = {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
      };
    }
    const delta = json.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      state.content += delta;
      onDelta?.(delta, state.content);
    }
  }
  return false;
}

/** OpenAI 兼容协议 provider（千问/火山/DeepSeek 等同协议厂商均可接入） */
export class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai-compatible';

  constructor(
    private config: OpenAICompatibleConfig,
    private fetchFn?: FetchLike
  ) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    // 思维链模型（如 deepseek-flash）偶发"只有 reasoning_content、content 为空"的响应
    // 兜底方案已内聚在 chatOnce 中（reasoning_content 回退），重试用于应对极端情况
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.chatOnce(messages, options);
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('LLM 返回空内容')) throw err;
      }
    }
    throw lastErr;
  }

  private async chatOnce(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
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

    // 如果 content 为空但存在 completionTokens，尝试多种兜底提取
    if (!content && json.usage?.completion_tokens > 0) {
      // 兜底1：deepseek 部分模型（如 deepseek-flash）可能把内容放在 reasoning_content 中
      // 原因：deepseek-flash 是思维链模型，若推理 token 耗尽 max_tokens，content 可能为空，
      // 但实际有效响应存在于 reasoning_content 字段
      const reasoningContent = choice?.message?.reasoning_content;
      if (typeof reasoningContent === 'string' && reasoningContent.trim()) {
        content = reasoningContent.trim();
        console.warn(
          `[LLMGateway][WARN] 命中 reasoning_content 兜底：model=${json.model ?? this.config.model}`
        );
      }
    }

    if (!content && json.usage?.completion_tokens > 0) {
      // 兜底2：deepseek 部分模型（如 deepseek-flash）可能把内容放在 delta 中
      const deltaContent = choice?.delta?.content;
      if (typeof deltaContent === 'string' && deltaContent.trim()) {
        content = deltaContent.trim();
      }
    }

    if (!content && json.usage?.completion_tokens > 0) {
      // 兜底3：尝试从 tool_calls 中提取内容
      const toolCalls = choice?.message?.tool_calls ?? choice?.delta?.tool_calls;
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

    // 如果仍然为空，打印原始选择体以便诊断，然后抛出错误
    if (!content) {
      console.error(
        '[LLMGateway] 空内容诊断:',
        JSON.stringify(
          {
            model: json.model ?? this.config.model,
            usage: json.usage,
            choiceKeys: choice ? Object.keys(choice) : null,
            messageKeys: choice?.message ? Object.keys(choice.message) : null,
            deltaKeys: choice?.delta ? Object.keys(choice.delta) : null,
            finishReason: choice?.finish_reason,
          },
          null,
          2
        )
      );
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

  async chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
    onDelta?: (delta: string, content: string) => void
  ): Promise<ChatResult> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.chatStreamOnce(messages, options, onDelta);
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('LLM 返回空内容')) throw err;
      }
    }
    throw lastErr;
  }

  private async chatStreamOnce(
    messages: ChatMessage[],
    options?: ChatOptions,
    onDelta?: (delta: string, content: string) => void
  ): Promise<ChatResult> {
    const f = this.fetchFn ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      stream: true,
    };
    if (options?.jsonMode) body.response_format = { type: 'json_object' };
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const state: StreamAccumulation = { content: '' };
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
        throw new Error(`LLM stream request failed: ${res.status} ${text}`);
      }
      if (!res.body) throw new Error('LLM stream response has no body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done) {
        const read = await reader.read();
        if (read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          done = applySseBlock(buffer.slice(0, boundary), state, onDelta) || done;
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) applySseBlock(buffer, state, onDelta);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(
          `LLM 流式请求超时（${timeoutMs}ms）：model=${this.config.model} url=${url}，可用 LLM_TIMEOUT_MS 调整超时`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!state.content.trim()) {
      throw new Error(`LLM 返回空内容：model=${state.model ?? this.config.model}, completionTokens=${state.usage?.completionTokens ?? 0}`);
    }
    return {
      content: state.content,
      model: state.model ?? this.config.model,
      usage: state.usage,
    };
  }
}
