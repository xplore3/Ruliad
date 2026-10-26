export class VoiceRecorder {
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

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('VoiceRecorder 未开始录制'));
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        this.release();
        resolve(blob);
      };
      recorder.stop();
    });
  }

  cancel(): void {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      // ignore
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

function pickMimeType(): string | null {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

export async function blobToPcm16(blob: Blob, targetRate = 16000): Promise<ArrayBuffer> {
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error('当前浏览器不支持 AudioContext');
  const ctx = new AC();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const src = audio.getChannelData(0);
    const ratio = audio.sampleRate / targetRate;
    const out = new Int16Array(Math.floor(src.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const s = src[Math.floor(i * ratio)];
      out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
    return out.buffer;
  } finally {
    void ctx.close();
  }
}
