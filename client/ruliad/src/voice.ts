/**
 * 语音管线：麦克风采集（PCM16 LE 16kHz mono）+ WebSocket + TTS 播放队列。
 * 与 packages/api-gateway/src/routes/voice.ts 的协议对应：
 *  - 上行：二进制帧 = PCM16 音频块；文本帧 = JSON 控制消息（start/finish/interrupt/stop）
 *  - 下行：JSON 事件（asr_partial/asr_final/reply_text/tts_sentence/tts_chunk/tts_end/
 *    tts_cancelled/turn_complete/listening/error/stopped）
 */

import { getCachedPreferences, getPreferredSpeechRate } from './api';

// ---------- 麦克风采集 ----------

/**
 * 自适应 VAD：按近期静音块估计噪声底，语音阈值随之浮动。
 * 浏览器 AGC 关闭后，不同麦克风的原始电平差异很大，固定阈值会把轻声说话误判为静音（话没说完被切断）。
 */
export class AdaptiveVad {
  private noiseFloor = 0.004;
  /** 当前语音判定阈值（噪声底 ×2，钳制在 0.003~0.015），兼顾轻声发言 */
  threshold(): number {
    return Math.min(0.015, Math.max(0.003, this.noiseFloor * 2));
  }
  /** 输入一个音频块 RMS，返回是否语音；非语音块慢速更新噪声底，避免把轻声发言学成噪声 */
  isSpeech(rms: number): boolean {
    if (rms > this.threshold()) return true;
    this.noiseFloor = Math.max(0.0015, this.noiseFloor * 0.999 + rms * 0.001);
    return false;
  }
}

const TARGET_SAMPLE_RATE = 16000;
/** 每个上行音频块约 100ms */
const CHUNK_MS = 100;

const WORKLET_CODE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

export class PcmRecorder {
  onChunk: ((buf: ArrayBuffer) => void) | null = null;
  /** 每次采集块的 RMS 能量（0~1），供 UI 波形 */
  onLevel: ((rms: number) => void) | null = null;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private pending: number[] = [];
  private running = false;

  async start(): Promise<void> {
    if (this.running) return;
    // 隐私设置：录音与分析授权关闭时拒绝启动（Practice/Call 均经此入口）
    if (getCachedPreferences().recordingConsent === false) {
      throw new Error('录音与分析授权已关闭，请在「设置 - 隐私」中开启后再练习');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前访问方式不支持麦克风：请用 localhost 或 https 地址打开页面');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // autoGainControl 必须关闭：AGC 会把响的压轻、轻的抬响，
        // 直接抹平响度动态范围，导致激情度量化评分失真
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError') {
        throw new Error('麦克风权限被拒绝：点击浏览器地址栏左侧的锁形图标，将麦克风设为「允许」后刷新重试');
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new Error('未检测到麦克风设备，请连接麦克风后重试');
      }
      if (name === 'NotReadableError') {
        throw new Error('麦克风被其他应用占用，请关闭占用程序后重试');
      }
      throw err;
    }
    this.ctx = new AudioContext();
    const workletUrl = URL.createObjectURL(
      new Blob([WORKLET_CODE], { type: 'application/javascript' })
    );
    await this.ctx.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture');
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.handleSamples(e.data);
    this.source.connect(this.node);
    // 不连 destination（避免回声），部分浏览器要求有输出才驱动处理：接零增益节点
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute);
    mute.connect(this.ctx.destination);
    this.running = true;
  }

  private emitPcm(block: number[], ratio: number) {
    const outLen = Math.floor(block.length / ratio);
    if (outLen <= 0) return;
    const pcm = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, block.length - 1);
      const frac = srcIdx - lo;
      const v = block[lo] * (1 - frac) + block[hi] * frac;
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
    this.onChunk?.(pcm.buffer);
  }

  private handleSamples(samples: Float32Array) {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const ratio = ctx.sampleRate / TARGET_SAMPLE_RATE;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);

    for (let i = 0; i < samples.length; i++) this.pending.push(samples[i]);
    const chunkSrcLen = Math.floor((CHUNK_MS / 1000) * ctx.sampleRate);
    while (this.pending.length >= chunkSrcLen) {
      this.emitPcm(this.pending.splice(0, chunkSrcLen), ratio);
    }

    // 先送出当前声音，再让 VAD 判停，避免话尾的当前音频块被丢弃
    this.onLevel?.(rms);
  }

  stop() {
    if (this.running && this.ctx && this.pending.length > 0) {
      this.emitPcm(this.pending, this.ctx.sampleRate / TARGET_SAMPLE_RATE);
    }
    this.running = false;
    // 先摘掉消息回调，停止后在途的 worklet 消息不再进入 handleSamples
    if (this.node) this.node.port.onmessage = null;
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.node = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
    this.pending = [];
  }
}

// ---------- PCM → WAV ----------

/** 把 PcmRecorder 收集的 PCM16 LE 16kHz mono 块拼成带 44 字节头的 WAV Blob */
export function pcmToWav(chunks: ArrayBuffer[]): Blob {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const buffer = new ArrayBuffer(44 + total);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + total, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt 块大小
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true); // byteRate = 16k * 16bit * 1ch
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample
  writeStr(36, 'data');
  view.setUint32(40, total, true);
  const out = new Uint8Array(buffer, 44);
  let offset = 0;
  for (const c of chunks) {
    out.set(new Uint8Array(c), offset);
    offset += c.byteLength;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// ---------- TTS 播放队列 ----------

export class TtsPlayer {
  /** 全部排队的句子播完 */
  onIdle: (() => void) | null = null;
  private ctx: AudioContext | null = null;
  private queue: AudioBuffer[] = [];
  private playing = false;
  /** 暂停中：音频仍解码入队但不播放，恢复后从队列继续 */
  private paused = false;
  private currentSource: AudioBufferSourceNode | null = null;
  /** 当前播放段的缓冲（暂停时回退队首用） */
  private currentBuffer: AudioBuffer | null = null;
  /** 流式 tts_chunk 按 seq 累积 */
  private chunkBuffers = new Map<number, string[]>();
  /** 解码中的音频段数（入队前的异步间隙也算占用，防止误判空闲） */
  private decoding = 0;
  /** stopAll 代数：打断后丢弃在途解码结果，避免旧音频插队播放 */
  private generation = 0;
  /** 解码任务串行链：并发 decodeAudioData 完成顺序不定，后到的短句会插队先播 */
  private decodeTail: Promise<void> = Promise.resolve();

  get isPlaying() {
    return this.playing;
  }

  /** 是否仍有音频待播：播放中 / 队列非空 / 解码中 */
  get busy() {
    return this.playing || this.queue.length > 0 || this.decoding > 0;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 非流式：整段音频（wav base64）直接入队 */
  enqueue(audioBase64: string) {
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    this.enqueueBytes(bytes);
  }

  /** 流式：tts_chunk 分片，isFinal 时拼接成完整 wav 入队 */
  enqueueChunk(seq: number, audioBase64: string, isFinal: boolean) {
    const parts = this.chunkBuffers.get(seq) ?? [];
    parts.push(audioBase64);
    this.chunkBuffers.set(seq, parts);
    if (!isFinal) return;
    this.chunkBuffers.delete(seq);
    // base64 拼接需先解码成字节再合并
    const bytes = parts.map((p) => Uint8Array.from(atob(p), (c) => c.charCodeAt(0)));
    const total = bytes.reduce((n, b) => n + b.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const b of bytes) {
      merged.set(b, offset);
      offset += b.length;
    }
    this.enqueueBytes(merged);
  }

  /** 解码任务挂到串行链尾部：保证入队顺序与到达顺序一致 */
  private enqueueBytes(bytes: Uint8Array) {
    this.decoding++;
    const gen = this.generation;
    this.decodeTail = this.decodeTail.then(() => this.decodeOne(bytes, gen));
  }

  private async decodeOne(bytes: Uint8Array, gen: number) {
    try {
      const ctx = this.ensureCtx();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const audioBuf = await ctx.decodeAudioData(copy.buffer);
      if (gen !== this.generation) return; // 解码期间被打断/销毁，丢弃
      this.queue.push(audioBuf);
      if (!this.playing) void this.playNext();
    } catch (err) {
      console.warn('[TtsPlayer] 音频解码失败，跳过该段:', err);
    } finally {
      this.decoding--;
      // 所有在途解码结束且无可播内容时补发 onIdle（playNext 在解码间隙会跳过 onIdle）
      if (!this.playing && this.queue.length === 0 && this.decoding === 0) this.onIdle?.();
    }
  }

  private async playNext(): Promise<void> {
    if (this.paused || this.playing) return;
    const buf = this.queue.shift();
    if (!buf) {
      // 还有句子在解码：不是真正空闲，等解码完成后再判断
      if (this.decoding === 0) this.onIdle?.();
      return;
    }
    this.playing = true;
    const ctx = this.ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    this.currentSource = src;
    this.currentBuffer = buf;
    src.onended = () => {
      // 被 pause/stopAll 停掉的 source 不推进队列：其 onended 异步触发时可能已有新 source
      // 在播，若无守卫重入 playNext 会再启一条播放链，导致多路 TTS 同时发声
      if (this.currentSource !== src) return;
      this.currentSource = null;
      this.currentBuffer = null;
      this.playing = false;
      void this.playNext();
    };
    src.start();
  }

  /** 暂停播放：当前一句回退到队首（恢复后重播该句），保留队列；暂停期间到达的音频照常入队但不出声 */
  pause() {
    this.paused = true;
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        /* 已停止 */
      }
      this.currentSource = null;
      // 当前句未播完：放回队首，恢复后从头重播，避免整句被跳过
      if (this.currentBuffer) this.queue.unshift(this.currentBuffer);
      this.currentBuffer = null;
    }
    this.playing = false;
  }

  /** 恢复播放：从队列继续播暂停期间累积的音频 */
  resumePlayback() {
    if (!this.paused) return;
    this.paused = false;
    if (!this.playing && this.queue.length > 0) void this.playNext();
  }

  /** 打断：清空队列并停止当前播放 */
  stopAll() {
    this.generation++;
    this.queue = [];
    this.chunkBuffers.clear();
    try {
      this.currentSource?.stop();
    } catch {
      /* 已停止 */
    }
    this.currentSource = null;
    this.currentBuffer = null;
    this.playing = false;
  }

  /** 浏览器自动播放策略下，在用户手势中创建并恢复 AudioContext */
  resume() {
    this.ensureCtx();
  }

  dispose() {
    this.stopAll();
    void this.ctx?.close();
    this.ctx = null;
  }
}

// ---------- 流式识别通道（新手指引资格提问/示范选择） ----------

/**
 * 流式 ASR 客户端：边说边识别（对应服务端 /sessions/:id/asr-stream）。
 * onPartial 实时字幕；finish() 等服务端 asr_final 返回最终文本。
 * 失败（断连/超时/服务端报错）一律 reject，调用方回退整段上传批量识别。
 */
export class AsrStreamClient {
  onPartial: ((text: string) => void) | null = null;
  onClose: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private pendingFinal: {
    resolve: (text: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(private url: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('识别通道连接失败'));
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        let ev: { type?: string; text?: string; message?: string };
        try {
          ev = JSON.parse(e.data);
        } catch {
          return;
        }
        if (ev.type === 'asr_partial') this.onPartial?.(ev.text ?? '');
        else if (ev.type === 'asr_final') this.settleFinal(ev.text ?? '');
        else if (ev.type === 'error') this.failFinal(new Error(ev.message || '识别失败'));
      };
      ws.onclose = () => {
        this.failFinal(new Error('识别通道已断开'));
        this.onClose?.();
      };
    });
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** 开新一轮识别（服务端重置识别流，旧轮回调作废） */
  startRound() {
    if (this.isOpen) this.ws!.send(JSON.stringify({ type: 'start' }));
  }

  sendAudio(buf: ArrayBuffer) {
    if (this.isOpen) this.ws!.send(buf);
  }

  /** 结束本轮：返回服务端 asr_final 的最终识别文本（5s 无响应按失败处理，走批量兜底） */
  finish(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isOpen) {
        reject(new Error('识别通道未连接'));
        return;
      }
      this.failFinal(new Error('新一轮 finish 覆盖'));
      this.pendingFinal = {
        resolve,
        reject,
        timer: setTimeout(() => this.failFinal(new Error('识别结果超时')), 5000),
      };
      this.ws!.send(JSON.stringify({ type: 'finish' }));
    });
  }

  /** 丢弃本轮（外部打断：暂停/进 live），挂起的 finish 按失败释放 */
  cancel() {
    if (this.isOpen) this.ws!.send(JSON.stringify({ type: 'cancel' }));
    this.failFinal(new Error('已取消'));
  }

  private settleFinal(text: string) {
    const pending = this.pendingFinal;
    if (!pending) return;
    this.pendingFinal = null;
    clearTimeout(pending.timer);
    pending.resolve(text);
  }

  private failFinal(err: Error) {
    const pending = this.pendingFinal;
    if (!pending) return;
    this.pendingFinal = null;
    clearTimeout(pending.timer);
    pending.reject(err);
  }

  close() {
    this.failFinal(new Error('识别通道已关闭'));
    this.ws?.close();
    this.ws = null;
  }
}

// ---------- 语音 WebSocket ----------

import type { QuizQuestion } from './types';

export interface VoiceServerEvent {
  type: string;
  text?: string;
  message?: string;
  seq?: number;
  audio?: string;
  format?: string;
  isFinal?: boolean;
  turn?: {
    traineeTurn: { seq: number; speaker: string; text: string; at: string };
    personaTurn?: { seq: number; speaker: string; text: string; at: string };
    narratorTurn?: { seq: number; speaker: string; text: string; at: string };
    childTurn?: { seq: number; speaker: string; text: string; at: string };
    remainingSeconds: number;
    timeUp?: boolean;
    pendingQuizzes?: QuizQuestion[];
  };
  emotion?: { arousal: number | null; bandKey: string | null };
}

export class VoiceSocket {
  onEvent: ((ev: VoiceServerEvent) => void) | null = null;
  onClose: ((code: number, reason: string) => void) | null = null;
  onOpen: (() => void) | null = null;
  private ws: WebSocket | null = null;

  constructor(private url: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.onOpen?.();
        resolve();
      };
      ws.onerror = () => reject(new Error('语音通道连接失败'));
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        try {
          this.onEvent?.(JSON.parse(e.data) as VoiceServerEvent);
        } catch {
          /* 忽略无法解析的帧 */
        }
      };
      ws.onclose = (e) => this.onClose?.(e.code, e.reason);
    });
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  sendAudio(buf: ArrayBuffer) {
    if (this.isOpen) this.ws!.send(buf);
  }

  send(msg: Record<string, unknown>) {
    if (!this.isOpen) return;
    // start 消息自动带上设置页的默认语速偏好（TTS rate），调用方无需改动
    const payload = msg.type === 'start' ? { rate: getPreferredSpeechRate(), ...msg } : msg;
    this.ws!.send(JSON.stringify(payload));
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}
