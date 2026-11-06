import { describe, expect, it, vi } from 'vitest';
import { AliyunSpeechProvider } from './providers/aliyun.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const wsMock = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('ws', () => {
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 0;
    private handlers = new Map<string, (...args: any[]) => void>();

    sent: any[] = [];

    constructor() {
      wsMock.instances.push(this);
    }

    on(event: string, handler: (...args: any[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    emit(event: string, ...args: any[]) {
      this.handlers.get(event)?.(...args);
    }

    send(data: unknown) {
      this.sent.push(data);
    }

    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }

  return { default: FakeWebSocket };
});

function message(socket: any, event: string, output?: unknown) {
  socket.emit('message', Buffer.from(JSON.stringify({ header: { event }, payload: output ? { output } : {} })), false);
}

describe('AliyunSpeechProvider ASR 收尾', () => {
  it('保留已有完整句之后的最后阶段文本，且不重复提交句末结果', () => {
    wsMock.instances.length = 0;
    const provider = new AliyunSpeechProvider({ apiKey: 'test', asrModel: 'paraformer-realtime-v2', ttsModel: 'cosyvoice-v2', ttsVoice: 'longxiaochun_v2' });
    const finals: string[] = [];
    const partials: string[] = [];
    let finished = 0;
    const stream = provider.createStream({
      onPartial: (text) => partials.push(text),
      onFinal: (text) => finals.push(text),
      onFinished: () => finished++,
      onError: (err) => { throw err; },
    });
    const socket = wsMock.instances[0];

    stream.write(Buffer.alloc(3200));
    socket.readyState = 1;
    socket.emit('open');
    message(socket, 'task-started');
    message(socket, 'result-generated', { sentence: { text: '前半句。', end_time: 100 } });
    message(socket, 'result-generated', { sentence: { text: '后半句', end_time: null } });
    stream.finish();
    message(socket, 'task-finished');

    expect(partials).toEqual(['前半句。后半句']);
    expect(finals).toEqual(['前半句。', '前半句。后半句']);
    expect(finished).toBe(1);
  });
});

describe('AliyunSpeechProvider 批量语音识别', () => {
  it('长录音按100毫秒音频帧分块发送', async () => {
    wsMock.instances.length = 0;
    const provider = new AliyunSpeechProvider({ apiKey: 'test', asrModel: 'paraformer-realtime-v2', ttsModel: 'cosyvoice-v2', ttsVoice: 'longxiaochun_v2' });
    const pending = provider.transcribe(Buffer.alloc(7000), 'pcm');
    const socket = wsMock.instances[0];
    socket.readyState = 1;
    socket.emit('open');
    message(socket, 'task-started');

    const audioFrames = socket.sent.filter((data: unknown) => Buffer.isBuffer(data));
    expect(audioFrames.map((frame: Buffer) => frame.length)).toEqual([3200, 3200, 600]);

    message(socket, 'result-generated', { sentence: { text: '完整回答', end_time: 100 } });
    message(socket, 'task-finished');
    await expect(pending).resolves.toBe('完整回答');
  });

  it('识别结束事件一直不返回时超时退出', async () => {
    vi.useFakeTimers();
    try {
      wsMock.instances.length = 0;
      const provider = new AliyunSpeechProvider({ apiKey: 'test', asrModel: 'paraformer-realtime-v2', ttsModel: 'cosyvoice-v2', ttsVoice: 'longxiaochun_v2' });
      const pending = provider.transcribe(Buffer.alloc(3200), 'pcm');
      const socket = wsMock.instances[0];
      socket.readyState = 1;
      socket.emit('open');
      message(socket, 'task-started');

      const rejection = expect(pending).rejects.toThrow('ASR task-finished 超时');
      await vi.advanceTimersByTimeAsync(120_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('任务完成前断连立即返回错误', async () => {
    wsMock.instances.length = 0;
    const provider = new AliyunSpeechProvider({ apiKey: 'test', asrModel: 'paraformer-realtime-v2', ttsModel: 'cosyvoice-v2', ttsVoice: 'longxiaochun_v2' });
    const pending = provider.transcribe(Buffer.alloc(3200), 'pcm');
    const socket = wsMock.instances[0];
    socket.readyState = 1;
    socket.emit('open');
    message(socket, 'task-started');
    socket.emit('close');

    await expect(pending).rejects.toThrow('ASR 连接在任务完成前关闭');
  });
});
