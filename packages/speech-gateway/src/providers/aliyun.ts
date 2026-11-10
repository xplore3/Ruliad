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
const ASR_CHUNK_BYTES = 3200;
const TASK_START_TIMEOUT_MS = 10_000;
const ASR_FINISH_TIMEOUT_MS = 8_000;
const TTS_TIMEOUT_MS = 30_000;

/**
 * 音色与模型按代际绑定，错配会报 418。路由规则见 resolveModel。
 * v3 标杆音色（v3-flash 与 v3-plus 均可用）；*_v3 后缀音色仅 cosyvoice-v3-flash 提供。
 */
const V3_BENCHMARK_VOICES = new Set(['longanyang', 'longanhuan']);
const V3_FLASH_MODEL = 'cosyvoice-v3-flash';

/** 内部流回调：比公开接口多一个任务结束通知（批量 transcribe 用） */
interface InternalASRHandlers extends ASRStreamHandlers {
  onFinished?(): void;
}

/** 'audio/wav' → 'wav'；'wav' 原样；未知按 'pcm' 处理 */
function normalizeFormat(format: string): string {
  const f = format.toLowerCase().replace(/^audio\//, '').split(';')[0].trim();
  return ['wav', 'mp3', 'pcm', 'opus', 'aac'].includes(f) ? f : 'pcm';
}

/**
 * 阿里 CosyVoice 双工协议返回的是裸 PCM 帧（无容器头）。
 * 浏览器 / standard-decoder 解码需要标准 WAV，此处按 TTS 参数（mono / 16bit / 22050Hz）
 * 拼接 44 字节 PCM WAV 头 + 数据体。返回的 Buffer 可被任何 `format:'wav'` 的下游解码。
 */
function pcmToWav(pcm: Buffer, sampleRate = 22050): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize;
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt 块长度
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byteRate
  header.writeUInt16LE(2, 32); // blockAlign
  header.writeUInt16LE(16, 34); // bitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

export class AliyunSpeechProvider implements ASRProvider, TTSProvider {
  name = 'aliyun';

  constructor(private config: AliyunSpeechConfig) {}

  private connect(): WebSocket {
    return new WebSocket(this.config.url ?? DEFAULT_URL, {
      headers: { Authorization: `bearer ${this.config.apiKey}` },
    });
  }

  /**
   * 按音色代际路由模型，避免人设自带的 v2 音色被送到 v3 模型上报 418：
   * *_v2 → cosyvoice-v2；*_v3 → cosyvoice-v3-flash；v3 标杆音色用配置的 v3 系模型；其余用配置的 ttsModel。
   */
  private resolveModel(voice?: string): string {
    const v = voice ?? this.config.ttsVoice;
    if (v.endsWith('_v2')) return 'cosyvoice-v2';
    if (v.endsWith('_v3')) return V3_FLASH_MODEL;
    if (V3_BENCHMARK_VOICES.has(v)) {
      return this.config.ttsModel.startsWith('cosyvoice-v3') ? this.config.ttsModel : V3_FLASH_MODEL;
    }
    return this.config.ttsModel;
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
      for (let offset = 0; offset < audio.length; offset += ASR_CHUNK_BYTES) {
        stream.write(audio.subarray(offset, offset + ASR_CHUNK_BYTES));
      }
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
    let completed = false;
    let failed = false;
    let finishRequested = false;
    let finalEmitted = false;
    let finalText = '';
    let latestText = '';
    let emittedFinalText = '';
    let finishTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingChunks: Buffer[] = [];

    const clearFinishTimer = () => {
      if (finishTimer) clearTimeout(finishTimer);
      finishTimer = null;
    };
    const fail = (err: Error) => {
      if (closed || completed || failed) return;
      failed = true;
      clearTimeout(startTimer);
      clearFinishTimer();
      handlers.onError(err);
    };
    const complete = () => {
      if (closed || completed || failed) return;
      completed = true;
      clearTimeout(startTimer);
      clearFinishTimer();
      // 收尾时补上尚未落句的阶段文本，避免最后一个半句在已有完整句时被丢掉
      if (finishRequested && (!finalEmitted || latestText !== emittedFinalText)) {
        finalEmitted = true;
        emittedFinalText = latestText;
        handlers.onFinal(latestText);
      }
      handlers.onFinished?.();
      ws.close();
    };
    const sendCmd = (action: string, payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ header: { action, task_id: taskId, streaming: 'duplex' }, payload }));
      }
    };
    const sendFinish = () => {
      sendCmd('finish-task', { input: {} });
      if (!finishTimer) {
        finishTimer = setTimeout(() => {
          // 云端的 task-finished 丢失时，用已经识别出的文本完成本轮，避免一直卡在识别中
          if (latestText.trim()) complete();
          else {
            fail(new Error('ASR task-finished 超时'));
            ws.close();
          }
        }, ASR_FINISH_TIMEOUT_MS);
      }
    };

    const startTimer = setTimeout(() => {
      if (!started) {
        fail(new Error('ASR task-started 超时'));
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
          latestText = finalText + text;
          handlers.onPartial(latestText);
        } else {
          finalText += text;
          latestText = finalText;
          emittedFinalText = finalText;
          finalEmitted = true;
          handlers.onFinal(finalText);
        }
      } else if (event === 'task-finished') {
        complete();
      } else if (event === 'task-failed') {
        fail(new Error(`ASR task-failed: ${evt.header?.error_code ?? ''} ${evt.header?.error_message ?? ''}`));
        ws.close();
      }
    });

    ws.on('error', (err) => fail(err));
    ws.on('close', () => {
      clearTimeout(startTimer);
      clearFinishTimer();
      if (!closed && !completed && !failed) {
        failed = true;
        handlers.onError(new Error('ASR 连接在任务完成前关闭'));
      }
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
        clearFinishTimer();
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
    // 清理文本：移除控制字符、零-width字符等阿里 TTS 不支持的字符
    const cleanText = text
      .replace(/[\u0000-\u001f\u007f]/g, '') // 移除控制字符
      .replace(/[﻿-￾]/g, '') // 移除 BOM 和零-width字符
      .trim();
    if (!cleanText) {
      throw new Error('TTS text is empty after cleaning');
    }
    const params = arousalToTTSParams(opts?.arousal, opts?.excitement, opts?.rate);
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
          sendCmd('continue-task', { input: { text: cleanText } });
          sendCmd('finish-task', { input: {} });
        } else if (event === 'task-finished') {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          // 阿里 WebSocket 返回的是裸 PCM 帧，必须加 WAV 头才能被浏览器/audio 解码
          resolve({ audio: pcmToWav(Buffer.concat(chunks)), format });
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
    const params = arousalToTTSParams(opts?.arousal, opts?.excitement, opts?.rate);
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

    const collected: Buffer[] = [];
    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        collected.push(data as Buffer);
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
        // 阿里返回裸 PCM 帧：合成完整句子后添加 WAV 头，再 yield 给前端
        const wav = pcmToWav(Buffer.concat(collected));
        chunkQueue.push({ audio: wav, isFinal: true, format });
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
    } finally {
      clearTimeout(timer);
      try { ws.close(); } catch { /* 忽略 */ }
    }
  }
}
