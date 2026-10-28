import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { ASRProvider, ASRStream, ASRStreamHandlers, TTSOptions, TTSProvider, TTSResult, TTSChunk } from '../types.js';
import { arousalToTTSParams } from '../tts-params.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 阿里百炼（DashScope）语音 provider。
 * ASR：paraformer 实时识别（WebSocket 双工协议，JSON 控制帧 + 二进制音频帧）
 *   https://www.alibabacloud.com/help/zh/doc-detail/2856047.html
 * TTS：CosyVoice 合成（同一 WS 双工协议，非流式按句调用：run-task → continue-task → finish-task，
 *   音频经二进制通道返回）https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api
 * 注：无真实 API Key 未联调，报文按上述官方文档实现。
 */

export interface AliyunSpeechConfig {
  apiKey: string;
  /** ASR 模型，默认 paraformer-realtime-v2 */
  asrModel: string;
  /** TTS 模型，默认 cosyvoice-v2 */
  ttsModel: string;
  /** TTS 音色，默认 longxiaochun_v2（cosyvoice-v2 音色须带 _v2 后缀；不带后缀的是 v1 音色） */
  ttsVoice: string;
  /** 双工协议端点，默认北京地域公共域名 */
  url?: string;
}

const DEFAULT_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const TASK_START_TIMEOUT_MS = 10_000;
const TTS_TIMEOUT_MS = 30_000;

/**
 * 本账号实测可用的 CosyVoice v3 音色（v3 音色与 v2 不通用，v2 音色在 v3 上合成会报 418）。
 * 用这些音色合成时自动切换到 cosyvoice-v3-flash 模型。
 */
const V3_VOICES = new Set(['longanyang', 'longanhuan']);
const V3_MODEL = 'cosyvoice-v3-flash';

/** 内部流回调：比公开接口多一个任务结束通知（批量 transcribe 用） */
interface InternalASRHandlers extends ASRStreamHandlers {
  onFinished?(): void;
}

/** 'audio/wav' → 'wav'；'wav' 原样；未知按 'pcm' 处理 */
function normalizeFormat(format: string): string {
  const f = format.toLowerCase().replace(/^audio\//, '').split(';')[0].trim();
  return ['wav', 'mp3', 'pcm', 'opus', 'aac'].includes(f) ? f : 'pcm';
}

export class AliyunSpeechProvider implements ASRProvider, TTSProvider {
  name = 'aliyun';

  constructor(private config: AliyunSpeechConfig) {}

  private connect(): WebSocket {
    return new WebSocket(this.config.url ?? DEFAULT_URL, {
      headers: { Authorization: `bearer ${this.config.apiKey}` },
    });
  }

  /** 按音色选模型：v3 音色用 cosyvoice-v3-flash，其余用配置的 ttsModel（默认 cosyvoice-v2） */
  private resolveModel(voice?: string): string {
    return V3_VOICES.has(voice ?? this.config.ttsVoice) ? V3_MODEL : this.config.ttsModel;
  }

  // ---------- ASR ----------

  async transcribe(audio: Buffer, format: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let lastFinal = '';
      let settled = false;
      const stream = this.openASRStream(normalizeFormat(format), {
        onPartial: () => {},
        onFinal: (t) => {
          lastFinal = t;
        },
        onError: (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        },
        onFinished: () => {
          if (!settled) {
            settled = true;
            resolve(lastFinal);
          }
        },
      });
      stream.write(audio);
      stream.finish();
    });
  }

  createStream(handlers: ASRStreamHandlers): ASRStream {
    return this.openASRStream('pcm', handlers);
  }

  /**
   * 建立一路 paraformer 实时识别流。
   * 时序（必须严格遵守，否则任务失败）：run-task → 等 task-started → 二进制音频 → finish-task。
   * task-started 前到达的音频先入队，started 后补发。
   */
  private openASRStream(format: string, handlers: InternalASRHandlers): ASRStream {
    const taskId = randomUUID().replace(/-/g, '');
    const ws = this.connect();
    let started = false;
    let closed = false;
    let finishRequested = false;
    let finalEmitted = false;
    let finalText = '';
    const pendingChunks: Buffer[] = [];

    const sendCmd = (action: string, payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ header: { action, task_id: taskId, streaming: 'duplex' }, payload }));
      }
    };
    const sendFinish = () => sendCmd('finish-task', { input: {} });

    const startTimer = setTimeout(() => {
      if (!started) {
        handlers.onError(new Error('ASR task-started 超时'));
        ws.close();
      }
    }, TASK_START_TIMEOUT_MS);

    ws.on('open', () => {
      sendCmd('run-task', {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: this.config.asrModel,
        parameters: { format, sample_rate: 16000 },
        input: {},
      });
    });

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return; // ASR 无下行二进制
      let evt: any;
      try {
        evt = JSON.parse(data.toString());
      } catch {
        return;
      }
      const event = evt.header?.event;
      if (event === 'task-started') {
        clearTimeout(startTimer);
        started = true;
        for (const chunk of pendingChunks) ws.send(chunk);
        pendingChunks.length = 0;
        if (finishRequested) sendFinish();
      } else if (event === 'result-generated') {
        const sentence = evt.payload?.output?.sentence;
        if (!sentence || sentence.heartbeat) return;
        const text: string = sentence.text ?? '';
        if (!text) return;
        if (sentence.end_time == null) {
          handlers.onPartial(finalText + text);
        } else {
          finalText += text;
          finalEmitted = true;
          handlers.onFinal(finalText);
        }
      } else if (event === 'task-finished') {
        // finish 后一句完整结果都没回来：补发一次 onFinal（可能为空串），保证调用方能收尾
        if (finishRequested && !finalEmitted) {
          finalEmitted = true;
          handlers.onFinal(finalText);
        }
        handlers.onFinished?.();
        ws.close();
      } else if (event === 'task-failed') {
        clearTimeout(startTimer);
        handlers.onError(
          new Error(`ASR task-failed: ${evt.header?.error_code ?? ''} ${evt.header?.error_message ?? ''}`)
        );
        ws.close();
      }
    });

    ws.on('error', (err) => {
      clearTimeout(startTimer);
      if (!closed) handlers.onError(err);
    });
    ws.on('close', () => {
      clearTimeout(startTimer);
      closed = true;
    });

    return {
      write(chunk: Buffer) {
        if (closed) return;
        if (started) ws.send(chunk);
        else pendingChunks.push(chunk);
      },
      finish() {
        if (closed || finishRequested) return;
        finishRequested = true;
        if (started) sendFinish();
      },
      close() {
        if (closed) return;
        closed = true;
        clearTimeout(startTimer);
        try {
          ws.close();
        } catch {
          /* 忽略 */
        }
      },
    };
  }

  // ---------- TTS ----------

  /**
   * CosyVoice 非流式合成（整句一次 continue-task）。
   * 音频经二进制通道分帧返回，task-finished 后拼成完整音频。
   */
  async synthesize(text: string, opts?: TTSOptions): Promise<TTSResult> {
    const params = arousalToTTSParams(opts?.arousal, opts?.excitement);
    const format = 'wav'; // cosyvoice-v2 支持 wav/mp3；取 wav 与 mock 输出一致
    const taskId = randomUUID().replace(/-/g, '');

    return new Promise<TTSResult>((resolve, reject) => {
      const ws = this.connect();
      const chunks: Buffer[] = [];
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
        try {
          ws.close();
        } catch {
          /* 忽略 */
        }
      };
      const timer = setTimeout(() => fail(new Error('TTS 合成超时')), TTS_TIMEOUT_MS);

      const sendCmd = (action: string, payload: Record<string, unknown>) => {
        ws.send(JSON.stringify({ header: { action, task_id: taskId, streaming: 'duplex' }, payload }));
      };

      ws.on('open', () => {
        sendCmd('run-task', {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model: this.resolveModel(opts?.voice),
          parameters: {
            text_type: 'PlainText',
            voice: opts?.voice ?? this.config.ttsVoice,
            format,
            sample_rate: 22050,
            volume: params.volume,
            // CosyVoice（cosyvoice-v2 现行协议）语速/音调参数名为 rate/pitch；
            // 旧名 speech_rate/pitch_rate 会被服务端静默忽略（实测音频无变化）
            rate: params.speechRate,
            pitch: params.pitchRate,
          },
          input: {},
        });
      });

      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) {
          chunks.push(data as Buffer);
          return;
        }
        let evt: any;
        try {
          evt = JSON.parse(data.toString());
        } catch {
          return;
        }
        const event = evt.header?.event;
        if (event === 'task-started') {
          sendCmd('continue-task', { input: { text } });
          sendCmd('finish-task', { input: {} });
        } else if (event === 'task-finished') {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ audio: Buffer.concat(chunks), format });
          ws.close();
        } else if (event === 'task-failed') {
          fail(new Error(`TTS task-failed: ${evt.header?.error_code ?? ''} ${evt.header?.error_message ?? ''}`));
        }
      });

      ws.on('error', (err) => fail(err));
    });
  }

  /**
   * CosyVoice 流式合成（实时通话用）：音频分块异步迭代输出。
   * 协议与 synthesize 相同（run-task → continue-task → finish-task），
   * 差异在于二进制音频帧到达即 yield，降低首音频延迟。
   */
  async *synthesizeStream(text: string, opts?: TTSOptions): AsyncIterable<TTSChunk> {
    const params = arousalToTTSParams(opts?.arousal, opts?.excitement);
    const format = 'wav';
    const taskId = randomUUID().replace(/-/g, '');

    const ws = this.connect();
    const chunkQueue: TTSChunk[] = [];
    let done = false;
    let error: Error | null = null;
    let resolver: (() => void) | null = null;

    const wake = () => {
      const r = resolver;
      resolver = null;
      r?.();
    };

    const fail = (err: Error) => {
      error = err;
      done = true;
      wake();
      try { ws.close(); } catch { /* 忽略 */ }
    };

    const timer = setTimeout(() => fail(new Error('TTS 流式合成超时')), TTS_TIMEOUT_MS);

    const sendCmd = (action: string, payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ header: { action, task_id: taskId, streaming: 'duplex' }, payload }));
      }
    };

    ws.on('open', () => {
      sendCmd('run-task', {
        task_group: 'audio',
        task: 'tts',
        function: 'SpeechSynthesizer',
        model: this.resolveModel(opts?.voice),
        parameters: {
          text_type: 'PlainText',
          voice: opts?.voice ?? this.config.ttsVoice,
          format,
          sample_rate: 22050,
          volume: params.volume,
          // CosyVoice（cosyvoice-v2 现行协议）语速/音调参数名为 rate/pitch；
          // 旧名 speech_rate/pitch_rate 会被服务端静默忽略（实测音频无变化）
          rate: params.speechRate,
          pitch: params.pitchRate,
        },
        input: {},
      });
    });

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        // 二进制 = 音频块，立即 yield
        chunkQueue.push({ audio: data as Buffer, isFinal: false, format });
        wake();
        return;
      }
      let evt: any;
      try {
        evt = JSON.parse(data.toString());
      } catch {
        return;
      }
      const event = evt.header?.event;
      if (event === 'task-started') {
        sendCmd('continue-task', { input: { text } });
        sendCmd('finish-task', { input: {} });
      } else if (event === 'task-finished') {
        done = true;
        clearTimeout(timer);
        wake();
        try { ws.close(); } catch { /* 忽略 */ }
      } else if (event === 'task-failed') {
        clearTimeout(timer);
        fail(new Error(`TTS stream task-failed: ${evt.header?.error_code ?? ''} ${evt.header?.error_message ?? ''}`));
      }
    });

    ws.on('error', (err) => { clearTimeout(timer); fail(err); });

    try {
      while (!done) {
        // 排空队列
        while (chunkQueue.length > 0) {
          const chunk = chunkQueue.shift()!;
          yield chunk;
        }
        if (done) break;
        if (error) throw error;
        // 等待新数据
        await new Promise<void>((resolve) => { resolver = resolve; });
        // 唤醒后再排空
        while (chunkQueue.length > 0) {
          const chunk = chunkQueue.shift()!;
          yield chunk;
        }
      }
      // 最终 yield 一个 isFinal 标记
      yield { audio: Buffer.alloc(0), isFinal: true, format };
    } finally {
      clearTimeout(timer);
      try { ws.close(); } catch { /* 忽略 */ }
    }
  }
}
