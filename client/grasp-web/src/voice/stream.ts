/**
 * 二期语音（WebSocket 流式）客户端，契约：GET /api/v1/sessions/:id/voice?token=xxx
 *
 * 上行：AudioContext(16kHz) + AudioWorkletNode 采集 PCM16 LE mono，二进制帧发送；
 *       文本 JSON：start / finish / interrupt。
 * 下行：asr_partial / asr_final / reply_text / tts_sentence / tts_end /
 *       tts_cancelled / turn_complete / error。
 *
 * 播放：tts_sentence 按 seq 排队，decodeAudioData 后顺序排程播放；
 *       decode 失败时整体降级为 Audio 元素 dataURL 串行播放（故原始 base64 始终保留）。
 * interrupt：本地立即停止播放队列并清空，同时通知服务端。
 */
import type { Emotion, TurnResponse } from '../types';

export interface VoiceStreamCallbacks {
  /** ASR 中间结果，实时显示在输入区 */
  onPartial?: (text: string) => void;
  /** ASR 最终结果，锁定为用户消息 */
  onFinal?: (text: string) => void;
  /** persona 回复全文 */
  onReplyText?: (text: string) => void;
  /** 一轮结束，更新消息列表 / 情绪 */
  onTurnComplete?: (turn?: TurnResponse, emotion?: Emotion) => void;
  /** 本地播报状态变化（用于展示"打断"入口） */
  onPlayingChange?: (playing: boolean) => void;
  onError?: (message: string) => void;
  /** WS 断开（建连失败走 connect 的 reject，不会触发这里） */
  onClose?: () => void;
}

export function buildVoiceWsUrl(sessionId: string, token: string | null): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${proto}://${location.host}/api/v1/sessions/${sessionId}/voice${q}`;
}

/**
 * AudioWorklet processor 源码，经 Blob URL 内联加载：
 * 不新增打包入口，也不依赖 public/ 静态文件，Vite dev/build 均无需额外配置。
 */
const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    var channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
`;

export class VoiceStreamClient {
  private ws: WebSocket | null = null;
  private readonly cb: VoiceStreamCallbacks;

  // 采集
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  /** worklet 模块是否已在本实例的 AudioContext 上注册（teardown 后仍保留，防重复注册报 NotSupportedError） */
  private workletReady = false;
  private muteGain: GainNode | null = null;
  private capturing = false;

  // 播放
  /** seq -> 原始 base64（decode 降级时仍需用到，故始终保留至被消费） */
  private rawBySeq = new Map<number, { audio: string; format: string }>();
  private decodedBySeq = new Map<number, AudioBuffer>();
  private nextSeq: number | null = null;
  private nextPlayTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private useAudioElement = false;
  private elementQueue: number[] = [];
  private elementPlaying = false;
  private audioEl: HTMLAudioElement | null = null;
  private playing = false;

  constructor(cb: VoiceStreamCallbacks) {
    this.cb = cb;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** 建立 WS；建连失败 reject（调用方据此降级到一期 HTTP） */
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        settled = true;
        resolve();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        this.ws = null;
        reject(new Error('语音通道连接失败'));
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          this.ws = null;
          reject(new Error('语音通道连接失败'));
          return;
        }
        this.handleClose();
      };
      ws.onmessage = (e) => this.handleMessage(e);
    });
  }

  /** 按住说话：发 start 并开始上行 PCM */
  async startTalking(): Promise<void> {
    if (!this.connected) throw new Error('语音通道未连接');
    // 新一轮：停掉上一轮可能残留的播报，重置播放队列
    this.stopPlayback();
    this.resetTurnBuffers();
    await this.ensureCapture();
    this.sendJson({ type: 'start' });
    this.capturing = true;
  }

  /** 松开：停止上行并发 finish */
  finishTalking(): void {
    this.capturing = false;
    this.teardownCapture();
    if (this.connected) this.sendJson({ type: 'finish' });
  }

  /** 打断：发 interrupt 并清空本地播放队列 */
  interrupt(): void {
    if (this.connected) this.sendJson({ type: 'interrupt' });
    this.stopPlayback();
    this.resetTurnBuffers();
  }

  close(): void {
    this.capturing = false;
    this.teardownCapture();
    this.stopPlayback();
    // 释放 AudioContext（浏览器对并发实例数有限制，Chrome 约 6 个）；close 为终态调用，实例不再复用
    const ctx = this.audioCtx;
    this.audioCtx = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  // ---------- 采集（PCM16 上行） ----------

  private async ensureCapture(): Promise<void> {
    if (this.workletNode) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('当前浏览器不支持 AudioContext');
    this.audioCtx = this.audioCtx ?? new Ctor({ sampleRate: 16000 });
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    if (!this.workletReady) {
      // 同一 AudioContext 只能注册一次同名 processor：每轮说完话 teardown 后 workletNode 虽被置空，
      // 但 'pcm-capture' 仍注册在 ctx 上，下一轮重复 addModule 会抛 NotSupportedError: already registered
      const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try {
        await this.audioCtx.audioWorklet.addModule(workletUrl);
      } catch (err) {
        if (err instanceof Error && err.name === 'NotSupportedError' && /already registered/i.test(err.message)) {
          console.warn('[VoiceStreamClient] pcm-capture 已注册，复用现有 AudioWorklet 模块');
        } else {
          throw err;
        }
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
      this.workletReady = true;
    }
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const ctx = this.audioCtx;
    this.sourceNode = ctx.createMediaStreamSource(this.micStream);
    this.workletNode = new AudioWorkletNode(ctx, 'pcm-capture');
    this.workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.capturing || !this.connected) return;
      this.ws?.send(floatToPcm16(e.data));
    };
    // worklet 必须接入音频图才会被调度；经零增益 GainNode 接 destination，避免麦克风回放到扬声器
    this.muteGain = ctx.createGain();
    this.muteGain.gain.value = 0;
    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.muteGain);
    this.muteGain.connect(ctx.destination);
  }

  private teardownCapture(): void {
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.muteGain?.disconnect();
    this.workletNode = null;
    this.sourceNode = null;
    this.muteGain = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
  }

  // ---------- 播放（tts_sentence 按 seq 排队） ----------

  private ensurePlaybackCtx(): AudioContext {
    if (!this.audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('当前浏览器不支持 AudioContext');
      this.audioCtx = new Ctor();
    }
    return this.audioCtx;
  }

  private handleTtsSentence(seq: number, audio: string, format: string): void {
    if (this.nextSeq === null) this.nextSeq = seq;
    this.rawBySeq.set(seq, { audio, format });
    if (this.useAudioElement) {
      this.enqueueElement(seq);
      return;
    }
    void this.decodeAndSchedule(seq);
  }

  private async decodeAndSchedule(seq: number): Promise<void> {
    const raw = this.rawBySeq.get(seq);
    if (!raw || this.decodedBySeq.has(seq) || this.useAudioElement) return;
    let buf: AudioBuffer;
    try {
      buf = await this.ensurePlaybackCtx().decodeAudioData(base64ToArrayBuffer(raw.audio));
    } catch {
      this.switchToElementPlayback();
      return;
    }
    this.decodedBySeq.set(seq, buf);
    this.scheduleReady();
  }

  /** 从 nextSeq 起，把已连续解码的 buffer 依次排程（句间无缝衔接） */
  private scheduleReady(): void {
    const ctx = this.audioCtx;
    if (!ctx || this.useAudioElement || this.nextSeq === null) return;
    while (true) {
      const seq: number = this.nextSeq;
      const buf = this.decodedBySeq.get(seq);
      if (!buf) return; // 该句未到或仍在解码，等 decode 回调再推进
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime + 0.03, this.nextPlayTime);
      source.start(startAt);
      this.nextPlayTime = startAt + buf.duration;
      this.activeSources.add(source);
      source.onended = () => {
        this.activeSources.delete(source);
        this.maybeSetIdle();
      };
      this.decodedBySeq.delete(seq);
      this.rawBySeq.delete(seq);
      this.nextSeq = seq + 1;
      this.setPlaying(true);
    }
  }

  /** decodeAudioData 失败：整体降级为 Audio 元素串行播放（含已解码但未播的句子） */
  private switchToElementPlayback(): void {
    this.useAudioElement = true;
    for (const s of this.activeSources) {
      try {
        s.stop();
      } catch {
        // 已停止的 source 重复 stop 会抛错，忽略
      }
    }
    this.activeSources.clear();
    this.nextPlayTime = 0;
    this.decodedBySeq.clear();
    const seqs = [...this.rawBySeq.keys()].sort((a, b) => a - b);
    for (const seq of seqs) this.enqueueElement(seq);
  }

  private enqueueElement(seq: number): void {
    // seq 递增到达（降级切换时已排序），直接尾插即可保持有序
    this.elementQueue.push(seq);
    this.pumpElement();
  }

  private pumpElement(): void {
    if (this.elementPlaying) return;
    const seq = this.elementQueue.shift();
    if (seq === undefined) {
      this.maybeSetIdle();
      return;
    }
    const raw = this.rawBySeq.get(seq);
    this.rawBySeq.delete(seq);
    if (!raw) {
      this.pumpElement();
      return;
    }
    this.elementPlaying = true;
    this.setPlaying(true);
    const el = new Audio(`data:audio/${raw.format};base64,${raw.audio}`);
    this.audioEl = el;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      this.elementPlaying = false;
      this.audioEl = null;
      this.pumpElement();
    };
    el.onended = done;
    el.onerror = done;
    void el.play().catch(done);
  }

  private stopPlayback(): void {
    for (const s of this.activeSources) {
      try {
        s.stop();
      } catch {
        // 忽略重复 stop
      }
    }
    this.activeSources.clear();
    this.nextPlayTime = 0;
    this.decodedBySeq.clear();
    this.elementQueue = [];
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }
    this.elementPlaying = false;
    this.setPlaying(false);
  }

  private resetTurnBuffers(): void {
    this.rawBySeq.clear();
    this.decodedBySeq.clear();
    this.nextSeq = null;
  }

  private maybeSetIdle(): void {
    if (
      this.activeSources.size === 0 &&
      this.decodedBySeq.size === 0 &&
      this.elementQueue.length === 0 &&
      !this.elementPlaying
    ) {
      this.setPlaying(false);
    }
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) return;
    this.playing = playing;
    this.cb.onPlayingChange?.(playing);
  }

  // ---------- 消息收发 ----------

  private sendJson(obj: Record<string, unknown>): void {
    if (this.connected) this.ws?.send(JSON.stringify(obj));
  }

  private handleMessage(e: MessageEvent): void {
    if (typeof e.data !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(e.data) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'asr_partial':
        this.cb.onPartial?.(String(msg.text ?? ''));
        break;
      case 'asr_final':
        this.cb.onFinal?.(String(msg.text ?? ''));
        break;
      case 'reply_text':
        this.cb.onReplyText?.(String(msg.text ?? ''));
        break;
      case 'tts_sentence':
        this.handleTtsSentence(Number(msg.seq), String(msg.audio ?? ''), String(msg.format ?? 'wav'));
        break;
      case 'tts_end':
        break;
      case 'tts_cancelled':
        this.stopPlayback();
        this.resetTurnBuffers();
        break;
      case 'turn_complete':
        this.cb.onTurnComplete?.(msg.turn as TurnResponse | undefined, msg.emotion as Emotion | undefined);
        break;
      case 'error':
        this.cb.onError?.(String(msg.message ?? '语音服务异常'));
        break;
    }
  }

  private handleClose(): void {
    this.capturing = false;
    this.teardownCapture();
    this.stopPlayback();
    this.cb.onClose?.();
  }
}

/** Float32 [-1,1] → PCM16 LE */
function floatToPcm16(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out.buffer;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
