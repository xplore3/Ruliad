import { describe, expect, it } from 'vitest';
import { createSpeechGateway } from './gateway.js';
import { MOCK_TRANSCRIPT, makeSineWav } from './providers/mock.js';
import { arousalToTTSParams } from './tts-params.js';

describe('createSpeechGateway', () => {
  it('缺省走 mock', () => {
    const g = createSpeechGateway({});
    expect(g.asr.name).toBe('mock');
    expect(g.tts.name).toBe('mock');
  });

  it('SPEECH_PROVIDER=aliyun 且无 key 时回退 mock', () => {
    const g = createSpeechGateway({ SPEECH_PROVIDER: 'aliyun' });
    expect(g.asr.name).toBe('mock');
  });

  it('SPEECH_PROVIDER=aliyun + SPEECH_API_KEY 时走 aliyun', () => {
    const g = createSpeechGateway({ SPEECH_PROVIDER: 'aliyun', SPEECH_API_KEY: 'sk-x' });
    expect(g.asr.name).toBe('aliyun');
    expect(g.tts.name).toBe('aliyun');
  });

  it('DASHSCOPE_API_KEY 也可作为 aliyun key', () => {
    const g = createSpeechGateway({ SPEECH_PROVIDER: 'aliyun', DASHSCOPE_API_KEY: 'sk-x' });
    expect(g.asr.name).toBe('aliyun');
  });
});

describe('MockSpeechProvider', () => {
  it('transcribe 返回固定文本', async () => {
    const g = createSpeechGateway({});
    await expect(g.asr.transcribe(Buffer.alloc(100), 'wav')).resolves.toBe(MOCK_TRANSCRIPT);
  });

  it('createStream 先 partial 后 final，final 为全句', async () => {
    const g = createSpeechGateway({});
    const events: string[] = [];
    const stream = g.asr.createStream({
      onPartial: (t) => events.push(`partial:${t}`),
      onFinal: (t) => events.push(`final:${t}`),
      onError: (e) => events.push(`error:${e.message}`),
    });
    stream.write(Buffer.alloc(3200));
    stream.finish();
    stream.close();
    expect(events).toEqual([
      `partial:${MOCK_TRANSCRIPT.slice(0, Math.ceil(MOCK_TRANSCRIPT.length / 2))}`,
      `final:${MOCK_TRANSCRIPT}`,
    ]);
  });

  it('synthesize 返回合法 WAV（RIFF 头 + 16kHz 参数）', async () => {
    const g = createSpeechGateway({});
    const { audio, format } = await g.tts.synthesize('你好，测试一下', { arousal: 0.8 });
    expect(format).toBe('wav');
    expect(audio.subarray(0, 4).toString()).toBe('RIFF');
    expect(audio.subarray(8, 12).toString()).toBe('WAVE');
    expect(audio.readUInt32LE(24)).toBe(16000);
    expect(audio.length).toBeGreaterThan(44 + 16000); // 至少 0.5s 音频
  });
});

describe('arousalToTTSParams', () => {
  it('平静（≤0.4）保持默认', () => {
    expect(arousalToTTSParams(0.2)).toEqual({ speechRate: 1, pitchRate: 1, volume: 50 });
    expect(arousalToTTSParams(undefined).speechRate).toBe(1);
  });

  it('高唤醒语速更快、音调更高', () => {
    const hi = arousalToTTSParams(1);
    expect(hi.speechRate).toBeGreaterThan(1.2);
    expect(hi.pitchRate).toBeGreaterThan(1);
    expect(hi.volume).toBeGreaterThan(50);
  });

  it('越界输入 clamp 到 [0,1]', () => {
    expect(arousalToTTSParams(99)).toEqual(arousalToTTSParams(1));
    expect(arousalToTTSParams(-1)).toEqual(arousalToTTSParams(0));
  });
});

describe('makeSineWav', () => {
  it('时长随文本增长、封顶 3s', () => {
    const shortWav = makeSineWav('短', 0.3);
    const longWav = makeSineWav('很长的文本'.repeat(50), 0.3);
    expect(longWav.length).toBeGreaterThan(shortWav.length);
    expect(longWav.length).toBe(44 + 16000 * 2 * 3);
  });
});
