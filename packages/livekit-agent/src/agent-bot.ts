/**
 * Grasp Agent Bot — 以 LiveKit Room participant 身份加入通话
 *
 * 职责：
 *   - 订阅房间内远端音频（用户语音）→ 调用 personaTurn 桥接
 *   - 合成 TTS → 发布本地音频
 *   - 通过 data channel 推送 transcript / reply / turn_complete
 *
 * 音频处理说明：
 *   LiveKit 的 RemoteAudioTrack 在浏览器端通过 WebRTC 自动路由到 <audio> 元素。
 *   Bot 场景下需要在服务端驱动 ASR→LLM→TTS 管线：
 *     - 当前实现：房间创建后 bot 加入，订阅用户 track；用户通过
 *       LiveKit Data Channel（Room.sendData）把 ASR 结果/text 发来。
 *     - 更优方案：使用 LiveKit Python SDK 的 VoiceAgent 原生管线
 *       或 LiveKit RTC Node (@livekit/rtc-node) 获得原始 PCM 帧。
 */
import { Room, RoomEvent, Track, RemoteTrack, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';

export interface AgentBotOptions {
  roomName: string;
  url: string;
  token: string;
}

export class GraspAgentBot {
  private room: Room | null = null;

  constructor(private opts: AgentBotOptions) {}

  async start(): Promise<void> {
    const room = new Room();

    room.on(RoomEvent.Connected, () => {
      console.log(`[GraspBot] joined room ${this.opts.roomName}`);
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Audio) return;
      console.log(`[GraspBot] audio subscribed from ${participant.identity}, sid=${track.sid}`);
    });

    room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      const msg = JSON.parse(new TextDecoder().decode(payload));
      console.log(`[GraspBot] data received:`, msg.type);
    });

    room.on(RoomEvent.Disconnected, () => {
      console.log('[GraspBot] disconnected from room');
    });

    this.room = room;
    await room.connect(this.opts.url, this.opts.token);
    console.log(`[GraspBot] connected to ${this.opts.url}, room=${this.opts.roomName}`);
  }

  async stop(): Promise<void> {
    await this.room?.disconnect();
    this.room = null;
  }
}
