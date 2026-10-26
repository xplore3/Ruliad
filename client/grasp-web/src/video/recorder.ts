/**
 * 对练正面录像：getUserMedia（前置摄像头 + 麦克风）+ MediaRecorder 整场录制，
 * 产出视频 Blob 上传存档；并提供 canvas 均匀抽帧（JPEG）供多模态评分。
 * 纯浏览器原生 API；权限被拒 / 无摄像头 / 浏览器不支持时由调用方降级（继续对练，无视频）。
 * 注意：与语音链路（voice/stream.ts、voice/recorder.ts）使用相互独立的媒体流，互不干扰。
 */

export class SessionVideoRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  static supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  /** 申请前置摄像头（含麦克风，录下学员语音/口型）并开始录制；权限被拒时抛错 */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mimeType = pickVideoMimeType();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    // 5s 分片收集，避免长对练时单块内存峰值
    this.recorder.start(5000);
  }

  /** 实时预览用媒体流（绑定到 <video> 的 srcObject） */
  getStream(): MediaStream | null {
    return this.stream;
  }

  /** 结束录制，返回完整视频 Blob */
  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('SessionVideoRecorder 未开始录制'));
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        this.release();
        resolve(blob);
      };
      recorder.stop();
    });
  }

  /** 放弃本次录制（退出不保存 / 组件卸载等场景） */
  cancel(): void {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      // 忽略 stop 时的状态异常
    }
    this.chunks = [];
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
  }
}

function pickVideoMimeType(): string | null {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

export interface VideoFrame {
  blob: Blob;
  /** 距录像起点的毫秒数 */
  atMs: number;
}

/**
 * 从录像 Blob 均匀抽帧（离屏 <video> + canvas，无需服务端 ffmpeg）。
 * 输出宽 640 的 JPEG（quality 0.7），供多模态评分与复盘缩略。
 */
export async function extractFrames(blob: Blob, count = 10): Promise<VideoFrame[]> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('录像元数据加载失败'));
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return [];

    const canvas = document.createElement('canvas');
    const scale = 640 / (video.videoWidth || 640);
    canvas.width = 640;
    canvas.height = Math.round((video.videoHeight || 480) * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const frames: VideoFrame[] = [];
    for (let i = 0; i < count; i++) {
      // 避开首尾 5%（起止画面常为黑帧/遮挡）
      const t = duration * (0.05 + (0.9 * i) / Math.max(count - 1, 1));
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error('录像定位失败'));
        video.currentTime = t;
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frameBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.7)
      );
      if (frameBlob) frames.push({ blob: frameBlob, atMs: Math.round(t * 1000) });
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}
