import type { TTSChunk, TTSOptions, TTSProvider, TTSResult } from '../types.js';
import { arousalToTTSParams } from '../tts-params.js';

/**
 * OpenAI TTS（POST {baseUrl}/audio/speech，兼容官方与 OpenAI 协议中转）。
 * 只实现 TTS：OpenAI 没有流式 ASR（Whisper 仅整段识别），ASR 请继续使用阿里云。
 *
 * 配置（env）：
 * - OPENAI_API_KEY        必填
 * - OPENAI_BASE_URL       默认 https://api.openai.com/v1（中转服务改成中转地址）
 * - OPENAI_TTS_MODEL      默认 gpt-4o-mini-tts（支持 instructions 情感指令，适合激情播报）
 * - OPENAI_TTS_VOICE      默认音色（默认 coral）
 *
 * 与阿里 CosyVoice 的差异：
 * - 只有 speed（0.25~4）一个语速参数，没有音调/音量参数；arousal/excitement 映射到 speed
 * - gpt-4o-mini-tts 支持 instructions，excitement>1（激情模式）时注入"有激情"的朗读指令
 */

export interface OpenAITTSConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  defaultVoice: string;
}

/** 阿里音色名 → OpenAI 音色（人设/角色配置里存的是阿里音色名，切换 provider 时无需改库） */
const VOICE_MAP: Record<string, string> = {
  longwan_v2: 'coral', // 销售：明快有活力的女声
  longshu_v2: 'sage', // 教练：沉稳女声
  longhua_v2: 'onyx', // 旁白：低沉男声
  longtong_v2: 'nova', // 小朋友：清亮年轻的声线
  longxiaoxia_v2: 'shimmer', // 家长女声
  longxiaochun_v2: 'alloy', // 默认女声
  longxiaocheng_v2: 'echo', // 家长男声
  longtian_v2: 'onyx', // 家长男声（粗一些）
};

const STREAM_CHUNK_BYTES = 32768;

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai';
  private config: OpenAITTSConfig;

  constructor(config: OpenAITTSConfig) {
    this.config = config;
  }

  /** 解析最终音色：OpenAI 原生音色名直接用；阿里音色名走映射；都没有用默认 */
  private resolveVoice(voice?: string): string {
    if (!voice) return this.config.defaultVoice;
    return VOICE_MAP[voice] ?? voice;
  }

  /** excitement>1（示范销售激情模式）且模型支持 instructions 时，注入激情朗读指令 */
  private resolveInstructions(opts?: TTSOptions): string | undefined {
    if (!this.config.model.includes('gpt-4o')) return undefined;
    if ((opts?.excitement ?? 1) <= 1) return undefined;
    return '用非常有激情、有感染力的语气朗读，像一个充满热情的推销员，语速快、能量足。';
  }

  private buildRequest(text: string, opts?: TTSOptions) {
    // OpenAI 只有 speed 一个语速参数（0.25~4）：arousal/excitement 的抬升全映射到 speed
    const speed = Math.min(4, Math.max(0.25, arousalToTTSParams(opts?.arousal, opts?.excitement).speechRate));
    const body: Record<string, unknown> = {
      model: this.config.model,
      voice: this.resolveVoice(opts?.voice),
      input: text,
      response_format: 'wav',
      speed,
    };
    const instructions = this.resolveInstructions(opts);
    if (instructions) body.instructions = instructions;
    return body;
  }

  private async post(text: string, opts?: TTSOptions): Promise<Response> {
    const res = await fetch(`${this.config.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(this.buildRequest(text, opts)),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenAI TTS ${res.status}: ${detail.slice(0, 200)}`);
    }
    return res;
  }

  async synthesize(text: string, opts?: TTSOptions): Promise<TTSResult> {
    const res = await this.post(text, opts);
    const audio = Buffer.from(await res.arrayBuffer());
    console.log(
      `[OpenAITTS][trace] synthesize: text="${text.slice(0, 30)}..." voice=${this.resolveVoice(opts?.voice)} speed=${(this.buildRequest(text, opts).speed as number).toFixed(2)} → wavBytes=${audio.length}`
    );
    return { audio, format: 'wav' };
  }

  async *synthesizeStream(text: string, opts?: TTSOptions): AsyncIterable<TTSChunk> {
    const res = await this.post(text, opts);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    let pending = new Uint8Array(0);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      const merged = new Uint8Array(pending.length + value.length);
      merged.set(pending);
      merged.set(value, pending.length);
      pending = merged;
      while (pending.length >= STREAM_CHUNK_BYTES) {
        yield { audio: Buffer.from(pending.subarray(0, STREAM_CHUNK_BYTES)), isFinal: false, format: 'wav' };
        pending = pending.subarray(STREAM_CHUNK_BYTES);
      }
    }
    if (pending.length > 0) {
      yield { audio: Buffer.from(pending), isFinal: false, format: 'wav' };
    }
    yield { audio: Buffer.alloc(0), isFinal: true, format: 'wav' };
  }
}
