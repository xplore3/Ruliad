/**
 * LiveKit 语音通话客户端
 *
 * 替代原 VoiceCallClient（WebSocket + PCM16），基于 LiveKit WebRTC SDK：
 *   - 自动处理编解码、回声消除、抗丢包
 *   - 服务端 Agent（LiveKit Agents SDK）完成 VAD→STT→personaTurn→TTS
 *   - 仅订阅远程音频 track、发布本地麦克风 track 即可
 *
 * 对外回调接口保持与原 VoiceCallClient 一致（onStatusChange/onPartial/onFinal…），
 * 上层 VoiceCall.tsx 仅需替换初始化 + start/stop 调用。
 */
import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
} from 'livekit-client';
import type { CallStatus, VoiceCallCallbacks } from './call';

export class LiveKitCallClient {
  private room: Room | null = null;
  private _audioEl: HTMLAudioElement | null = null;
  private _status: CallStatus = 'idle';

  constructor(private cb: VoiceCallCallbacks) {}

  get status(): CallStatus {
    return this._status;
  }
  get statusValue(): CallStatus {
    return this._status;
  }
  isConnected(): boolean {
    return this._status !== 'idle' && this._status !== 'connecting';
  }

  /**
   * 加入 LiveKit 房间
   */
  async connect(url: string, token: string): Promise<void> {
    this.setStatus('connecting');

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        audioPreset: { maxBitrate: 32000 },
      },
    });

    // 远程音频 track 到达 → 播放
    room.on(
      RoomEvent.TrackSubscribed,
      (_track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (publication.kind !== Track.Kind.Audio) return;
        if (!participant.isAgent) return;
        console.log(`[LiveKit] agent audio subscribed from ${participant.identity}`);
        this.attachAudio(publication.track?.mediaStreamTrack);
        this.setStatus('speaking');
      },
    );

    room.on(RoomEvent.Connected, () => {
      console.log('[LiveKit] room connected');
      this.setStatus('listening');
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      console.warn('[LiveKit] disconnected:', reason);
      this.setStatus('idle');
      this.cb.onClose?.();
    });

    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      console.log(`[LiveKit] participant connected: ${p.identity} (isAgent=${p.isAgent})`);
    });

    // Agent 通过 Data Packet 推送 transcript/reply/turn_complete
    room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        this.handleAgentData(msg);
      } catch {
        // ignore non-JSON data
      }
    });

    room.on(RoomEvent.LocalTrackPublished, () => {
      this.setStatus('listening');
    });

    this.room = room;
    await room.connect(url, token);
    console.log(`[LiveKit] connected to ${url}, room=${room.name}`);
  }

  /**
   * 开始通话：启用本地麦克风
   */
  async startCall(): Promise<void> {
    if (!this.room) throw new Error('未连接房间');
    await this.room.localParticipant.setMicrophoneEnabled(true);
    this.setStatus('listening');
  }

  /** 静音/取消静音 */
  async setMuted(muted: boolean): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setMicrophoneEnabled(!muted);
  }

  /**
   * 停止通话：禁用麦克风
   */
  async stopCall(): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setMicrophoneEnabled(false);
  }

  /**
   * 挂断：彻底关闭房间连接
   */
  async disconnect(): Promise<void> {
    if (this._audioEl) {
      this._audioEl.pause();
      this._audioEl.srcObject = null;
      this._audioEl = null;
    }
    await this.room?.disconnect();
    this.room = null;
    this.setStatus('idle');
  }

  private setStatus(s: CallStatus): void {
    if (this._status !== s) {
      this._status = s;
      this.cb.onStatusChange?.(s);
    }
  }

  /**
   * 把远程 agent 音频绑定到 <audio> 元素播放
   */
  private attachAudio(mediaStreamTrack: MediaStreamTrack | undefined): void {
    if (!mediaStreamTrack) return;
    if (!this._audioEl) {
      this._audioEl = new Audio();
      this._audioEl.autoplay = true;
      document.body.appendChild(this._audioEl);
    }
    const stream = new MediaStream([mediaStreamTrack]);
    this._audioEl.srcObject = stream;
    void this._audioEl.play().catch(() => {
      // 可能需要用户交互后才能播放
      console.warn('[LiveKit] audio play() 被浏览器拦截，需用户手势后恢复');
    });
  }

  /**
   * 处理 Agent 推送的数据包（transcript/reply_text/turn_complete）
   */
  private handleAgentData(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'asr_partial':
        this.cb.onPartial?.(String(msg.text ?? ''));
        break;
      case 'asr_final':
        this.cb.onFinal?.(String(msg.text ?? ''));
        this.setStatus('processing');
        break;
      case 'reply_text':
        this.cb.onReplyText?.(String(msg.text ?? ''));
        break;
      case 'turn_complete':
        this.setStatus('listening');
        this.cb.onTurnComplete?.(msg.turn as any, msg.emotion as any);
        break;
      case 'error':
        this.cb.onError?.(String(msg.message ?? '语音通话异常'));
        break;
    }
  }
}
