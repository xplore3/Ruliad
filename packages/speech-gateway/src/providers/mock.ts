import type { ASRProvider, ASRStream, ASRStreamHandlers, TTSOptions, TTSProvider, TTSResult, TTSChunk } from '../types.js';
import { arousalToTTSParams } from '../tts-params.js';

/** mock 识别固定返回的文本（测试与演示依赖） */
export const MOCK_TRANSCRIPT = '（模拟识别）请介绍一下你们的产品';

/** 程序生成 16kHz 16bit mono WAV：一段柔和正弦波，长度随文本、频率随唤醒度 */
export function makeSineWav(text: string, arousal?: number): Buffer {
  const sampleRate = 16000;
  const seconds = Math.min(3, Math.max(0.5, text.length * 0.12));
  const freq = 220 + (arousal ?? 0.3) * 160; // 220~380Hz
  const n = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    // 首尾 50ms 淡入淡出，避免爆音
    const fade = Math.min(1, i / 800, (n - i) / 800);
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.3 * fade * 32767);
    data.writeInt16LE(v, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
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
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * 离线确定性 provider：无 API Key 时语音链路可跑通。
 * ASR 固定返回 MOCK_TRANSCRIPT；TTS 返回程序生成的合法 WAV。
 */
export class MockSpeechProvider implements ASRProvider, TTSProvider {
  name = 'mock';

  async transcribe(audio: Buffer, format: string): Promise<string> {
    console.log(`[MockASR][trace] transcribe called: audioBytes=${audio.length} format=${format} → will return: "${MOCK_TRANSCRIPT.slice(0, 20)}..."`);
    return MOCK_TRANSCRIPT;
  }

  createStream(handlers: ASRStreamHandlers): ASRStream {
    let partialSent = false;
    let finished = false;
    let writeCount = 0;
    console.log('[MockASR][trace] createStream: new mock ASR stream created');
    return {
      write(chunk: Buffer) {
        writeCount++;
        if (!partialSent && !finished) {
          partialSent = true;
          const partial = MOCK_TRANSCRIPT.slice(0, Math.ceil(MOCK_TRANSCRIPT.length / 2));
          console.log(`[MockASR][trace] write(#${writeCount}, ${chunk.length}bytes) → onPartial: "${partial}"`);
          handlers.onPartial(partial);
        } else {
          if (writeCount % 10 === 0) console.log(`[MockASR][trace] write(#${writeCount}, ${chunk.length}bytes) — no partial yet=${!partialSent} finished=${finished}`);
        }
      },
      finish() {
        if (finished) {
          console.log('[MockASR][trace] finish() called but already finished, skip');
          return;
        }
        finished = true;
        console.log(`[MockASR][trace] finish() called (writes=${writeCount}) → onFinal: "${MOCK_TRANSCRIPT}"`);
        handlers.onFinal(MOCK_TRANSCRIPT);
      },
      close() {
        console.log(`[MockASR][trace] close() called (wasFinished=${finished} writes=${writeCount})`);
        finished = true;
      },
    };
  }

  async synthesize(text: string, opts?: TTSOptions): Promise<TTSResult> {
    arousalToTTSParams(opts?.arousal);
    const wav = makeSineWav(text, opts?.arousal);
    console.log(`[MockTTS][trace] synthesize: text="${text.slice(0, 30)}..." arousal=${opts?.arousal} → wavBytes=${wav.length}`);
    return { audio: wav, format: 'wav' };
  }

  async *synthesizeStream(text: string, opts?: TTSOptions): AsyncIterable<TTSChunk> {
    arousalToTTSParams(opts?.arousal);
    const wav = makeSineWav(text, opts?.arousal);
    // 模拟分块：将 WAV 拆为头部 + 前半数据 + 后半数据
    const half = Math.floor(wav.length / 2);
    console.log(`[MockTTS][trace] synthesizeStream: text="${text.slice(0, 30)}..." wavBytes=${wav.length} → yielding 3 chunks`);
    yield { audio: wav.subarray(0, half), isFinal: false, format: 'wav' };
    yield { audio: wav.subarray(half), isFinal: false, format: 'wav' };
    yield { audio: Buffer.alloc(0), isFinal: true, format: 'wav' };
    console.log('[MockTTS][trace] synthesizeStream: done');
  }
}
