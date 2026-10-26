/**
 * 三期语音通话（全双工 WebSocket）客户端，契约：GET /api/v1/sessions/:id/voice-call?token=xxx
 *
 * 与二期 VoiceStreamClient 的核心区别：
 * - 持续采集和发送 PCM16 音频，无需手动 start/finish
 * - 服务端 VAD 自动检测断句 → ASR → runTurn → 流式 TTS
 * - TTS 播放完毕后自动恢复监听，用户开口说话自动打断 TTS
 * - 连续对话体验，类似电话通话
 *
 * 上行：AudioContext(16kHz) + AudioWorkletNode 采集 PCM16 LE mono，二进制帧持续发送；
 *       文本 JSON：start（开始通话）/ stop（结束通话）/ interrupt（打断TTS）
 * 下行：listening / asr_partial / asr_final / reply_text / tts_chunk / tts_end /
 *       tts_cancelled / turn_complete / stopped / error
 *
 * 播放：tts_chunk 按 seq 排队，音频块到达即播放（无需等整句合成完成），
 *       同 seq 内的多个 chunk 拼接为一个 AudioBuffer。
 */
import type { Emotion, TurnResponse } from '../types';

export type CallStatus = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking';

export interface VoiceCallCallbacks {
  /** 通话状态变化 */
  onStatusChange?: (status: CallStatus) => void;
  /** ASR 中间结果 */
  onPartial?: (text: string) => void;
  /** ASR 最终结果 */
  onFinal?: (text: string) => void;
  /** persona 回复全文 */
  onReplyText?: (text: string) => void;
  /** 一轮结束 */
  onTurnComplete?: (turn?: TurnResponse, emotion?: Emotion) => void;
  onError?: (message: string) => void;
  /** WS 断开 */
  onClose?: () => void;
}

export function buildVoiceCallWsUrl(sessionId: string, token: string | null): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${proto}://${location.host}/api/v1/sessions/${sessionId}/voice-call${q}`;
}

/** WS 关闭码 → 可读原因（诊断日志用） */
function describeCloseCode(code: number): string {
  switch (code) {
    case 4401: return '登录已过期或 token 无效（重新登录）';
    case 1006: return '连接异常关闭：常见为反向代理未透传 WebSocket Upgrade 头（nginx 需配置 proxy_set_header Upgrade/Connection）、网络不可达或服务重启';
    case 1000: return '正常关闭';
    case 1001: return '端点离开（如服务端重启/页面跳转）';
    case 1011: return '服务端内部错误';
    default: return '其他';
  }
}

/**
 * AudioWorklet processor 源码（与二期相同），经 Blob URL 内联加载
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

interface ChunkEntry {
  seq: number;
  chunks: ArrayBuffer[];
  isFinal: boolean;
}

export class VoiceCallClient {
  private ws: WebSocket | null = null;
  private readonly cb: VoiceCallCallbacks;

  // 采集
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  /** worklet 模块是否已在本实例的 AudioContext 上注册（teardown 后仍保留，防重复注册报 NotSupportedError） */
  private workletReady = false;
  private muteGain: GainNode | null = null;
  private capturing = false;
  private captureActive = false; // 通话进行中持续采集

  // 播放
  private chunkQueue = new Map<number, ChunkEntry>();
  private nextSeq: number | null = null;
  private playing = false;
  private status: CallStatus = 'idle';

  constructor(cb: VoiceCallCallbacks) {
    this.cb = cb;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentStatus(): CallStatus {
    return this.status;
  }

  private setStatus(s: CallStatus) {
    if (this.status === s) return;
    this.status = s;
    this.cb.onStatusChange?.(s);
  }

  /** 建立 WS 连接 */
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.setStatus('connecting');
      const startedAt = Date.now();
      // 日志中打码 token，避免泄露
      console.log(`[VoiceCallClient] WS 连接开始：${url.replace(/token=[^&]+/, 'token=***')}`);
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        console.log(`[VoiceCallClient] WS 连接成功 耗时=${Date.now() - startedAt}ms`);
        settled = true;
        resolve();
      };
      ws.onerror = (ev) => {
        if (settled) return;
        settled = true;
        this.ws = null;
        this.setStatus('idle');
        console.error(
          '[VoiceCallClient] WS 连接失败（握手被拒或网络错误）。' +
            '若同时打印了 code=1006 的关闭日志，多为反向代理未透传 WebSocket 头或鉴权 401（详见服务端「鉴权失败：返回 401」日志）',
          ev
        );
        reject(new Error('语音通话连接失败'));
      };
      ws.onclose = (ev) => {
        if (!settled) {
          settled = true;
          this.ws = null;
          this.setStatus('idle');
          console.error(
            `[VoiceCallClient] WS 握手阶段即关闭 code=${ev.code}（${describeCloseCode(ev.code)}）${ev.reason ? ` reason=${ev.reason}` : ''}`
          );
          reject(new Error(`语音通话连接失败（close code ${ev.code}：${describeCloseCode(ev.code)}）`));
          return;
        }
        console.log(`[VoiceCallClient] WS 关闭 code=${ev.code}（${describeCloseCode(ev.code)}）`);
        this.handleClose();
      };
      ws.onmessage = (e) => this.handleMessage(e);
    });
  }

  /** 开始通话：启动持续采集并发 start */
  async startCall(): Promise<void> {
    if (!this.connected) throw new Error('语音通话未连接');
    console.log('[VoiceCallClient] 开始通话：初始化麦克风采集并发送 start…');
    this.stopPlayback();
    this.resetTurnBuffers();
    await this.ensureCapture();
    this.captureActive = true;
    this.capturing = true;
    this.sendJson({ type: 'start' });
    console.log('[VoiceCallClient] start 已发送，等待服务端 listening 事件');
    // 状态由服务端 listening 事件设置
  }

  /** 结束通话：停止采集并发 stop */
  stopCall(): void {
    this.captureActive = false;
    this.capturing = false;
    this.teardownCapture();
    this.stopPlayback();
    if (this.connected) this.sendJson({ type: 'stop' });
    this.setStatus('idle');
  }

  /** 打断 TTS 播放 */
  interrupt(): void {
    if (this.connected) this.sendJson({ type: 'interrupt' });
    this.stopPlayback();
    this.resetTurnBuffers();
  }

  close(): void {
    this.captureActive = false;
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
    this.setStatus('idle');
  }

  // ---------- 采集（PCM16 持续上行） ----------

  private async ensureCapture(): Promise<void> {
    if (this.workletNode) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('当前浏览器不支持 AudioContext');
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境不支持麦克风采集（navigator.mediaDevices 不可用：需 https 或 localhost）');
    }
    console.log('[VoiceCallClient] 初始化麦克风：AudioContext(16kHz) + AudioWorklet + getUserMedia');
    this.audioCtx = this.audioCtx ?? new Ctor({ sampleRate: 16000 });
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    if (!this.workletReady) {
      // 同一 AudioContext 只能注册一次同名 processor：挂断后重新接听时 workletNode 虽被置空，
      // 但 'pcm-capture' 仍注册在 ctx 上，重复 addModule 会抛 NotSupportedError: already registered
      const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try {
        await this.audioCtx.audioWorklet.addModule(workletUrl);
      } catch (err) {
        if (err instanceof Error && err.name === 'NotSupportedError' && /already registered/i.test(err.message)) {
          console.warn('[VoiceCallClient] pcm-capture 已注册，复用现有 AudioWorklet 模块');
        } else {
          throw err;
        }
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
      this.workletReady = true;
    }
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : String(err);
      const hint =
        name === 'NotAllowedError'
          ? '麦克风权限被拒绝（或页面非 https/localhost，浏览器直接禁用 getUserMedia）'
          : name === 'NotFoundError'
            ? '未找到麦克风设备'
            : name === 'NotReadableError'
              ? '麦克风被其他程序占用'
              : name;
      console.error(`[VoiceCallClient] 麦克风获取失败：${hint}`, err);
      throw err;
    }
    console.log('[VoiceCallClient] 麦克风采集就绪（PCM16 LE 16kHz mono）');
    const ctx = this.audioCtx;
    this.sourceNode = ctx.createMediaStreamSource(this.micStream);
    this.workletNode = new AudioWorkletNode(ctx, 'pcm-capture');
    this.workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      // 通话期间持续发送，服务端 VAD 负责断句
      if (this.captureActive && this.capturing && this.connected) {
        this.ws?.send(floatToPcm16(e.data));
      }
    };
    // 零增益接 destination，避免回声
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

  // ---------- 播放（tts_chunk 分块播放） ----------

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

  private handleTtsChunk(seq: number, audio: string, _format: string, isFinal: boolean): void {
    if (this.nextSeq === null) this.nextSeq = seq;
    // 16kHz 的 WAV 分块不能用 decodeAudioData 直接解码（缺少完整 WAV 头），
    // 这里按 seq 聚合同一句的所有 chunk，isFinal 时合并解码播放
    let entry = this.chunkQueue.get(seq);
    if (!entry) {
      entry = { seq, chunks: [], isFinal: false };
      this.chunkQueue.set(seq, entry);
    }
    if (audio) entry.chunks.push(base64ToArrayBuffer(audio));
    if (isFinal) entry.isFinal = true;

    // 按顺序播放已完成的句
    this.tryPlayNext();
  }

  private tryPlayNext(): void {
    if (this.playing || this.nextSeq === null) return;
    const entry = this.chunkQueue.get(this.nextSeq);
    if (!entry || !entry.isFinal) return; // 该句未完成

    this.chunkQueue.delete(this.nextSeq);
    this.nextSeq++;
    this.playing = true;
    this.setStatus('speaking');

    // 合并该句的所有音频块
    const merged = mergeArrayBuffers(entry.chunks);
    const ctx = this.ensurePlaybackCtx();
    ctx.decodeAudioData(merged)
      .then((buf) => {
        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.connect(ctx.destination);
        source.onended = () => {
          this.playing = false;
          this.tryPlayNext();
          // 没有更多待播放的句子 → 状态回到 listening（由服务端 listening 事件确认）
          if (this.chunkQueue.size === 0 && this.nextSeq !== null && !this.chunkQueue.has(this.nextSeq)) {
            // 等服务端 listening 事件
          }
        };
        source.start();
      })
      .catch(() => {
        // decode 失败：跳过该句
        this.playing = false;
        this.tryPlayNext();
      });
  }

  private stopPlayback(): void {
    this.playing = false;
    this.chunkQueue.clear();
    this.nextSeq = null;
  }

  private resetTurnBuffers(): void {
    this.chunkQueue.clear();
    this.nextSeq = null;
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
      case 'listening':
        this.setStatus('listening');
        break;
      case 'asr_partial':
        this.setStatus('listening');
        this.cb.onPartial?.(String(msg.text ?? ''));
        break;
      case 'asr_final':
        this.cb.onFinal?.(String(msg.text ?? ''));
        this.setStatus('processing');
        break;
      case 'reply_text':
        this.cb.onReplyText?.(String(msg.text ?? ''));
        break;
      case 'tts_chunk':
        this.handleTtsChunk(
          Number(msg.seq),
          String(msg.audio ?? ''),
          String(msg.format ?? 'wav'),
          Boolean(msg.isFinal)
        );
        break;
      case 'tts_end':
        break;
      case 'tts_cancelled':
        this.stopPlayback();
        this.resetTurnBuffers();
        this.setStatus('listening');
        break;
      case 'turn_complete':
        this.cb.onTurnComplete?.(
          msg.turn as TurnResponse | undefined,
          msg.emotion as Emotion | undefined
        );
        break;
      case 'stopped':
        this.setStatus('idle');
        break;
      case 'error':
        this.cb.onError?.(String(msg.message ?? '语音通话异常'));
        break;
    }
  }

  private handleClose(): void {
    this.captureActive = false;
    this.capturing = false;
    this.teardownCapture();
    this.stopPlayback();
    this.setStatus('idle');
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

function mergeArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((s, b) => s + b.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    merged.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return merged.buffer;
}
