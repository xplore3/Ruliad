import { describe, expect, it } from 'vitest';
import { analyzePcm16, wavToPcm } from './voice-features.js';

const SR = 16000;

/** 生成 PCM16 Buffer：segments 为 [频率Hz, 振幅0-1, 时长ms] 序列（0Hz=静音） */
function synth(segments: Array<[freqHz: number, amp: number, ms: number]>): Buffer {
  const parts: number[] = [];
  for (const [freq, amp, ms] of segments) {
    const n = Math.floor((SR * ms) / 1000);
    for (let i = 0; i < n; i++) {
      const v = freq > 0 ? Math.sin((2 * Math.PI * freq * i) / SR) * amp : 0;
      parts.push(Math.round(v * 32767));
    }
  }
  const buf = Buffer.alloc(parts.length * 2);
  parts.forEach((v, i) => buf.writeInt16LE(v, i * 2));
  return buf;
}

describe('analyzePcm16', () => {
  it('静音或过短音频返回 null', () => {
    expect(analyzePcm16(synth([[0, 0, 2000]]))).toBeNull();
    expect(analyzePcm16(synth([[220, 0.2, 200]]))).toBeNull();
  });

  it('恒定 220Hz 正弦：响度接近理论值，音调变化幅度小', () => {
    const f = analyzePcm16(synth([[220, 0.2, 2000]]))!;
    expect(f).not.toBeNull();
    // RMS = 0.2/√2 ≈ 0.1414 → ≈ -17.0 dBFS
    expect(f.avgLoudnessDbfs).toBeGreaterThan(-18.5);
    expect(f.avgLoudnessDbfs).toBeLessThan(-15.5);
    // 恒定频率 → 音调变化幅度应很小
    expect(f.pitchVarSemitones).not.toBeNull();
    expect(f.pitchVarSemitones!).toBeLessThan(1);
    // 恒定振幅 → 动态范围小
    expect(f.loudnessRangeDb).toBeLessThan(3);
    expect(f.voicedMs).toBeGreaterThanOrEqual(1900);
  });

  it('振幅突变：响度动态范围接近理论差值', () => {
    // 0.05 → 0.4：RMS 比 8 倍 ≈ 18.1 dB；段间夹静音，模拟真实说话的气口
    const f = analyzePcm16(synth([[220, 0.05, 900], [0, 0, 200], [220, 0.4, 900]]))!;
    expect(f.loudnessRangeDb).toBeGreaterThan(14);
    expect(f.loudnessRangeDb).toBeLessThan(21);
  });

  it('真实场景对照：平稳音 vs 起伏音的音调变化幅度拉开差距', () => {
    // 平稳：恒定 200Hz（模拟念经）带气口
    const flat = analyzePcm16(synth([[200, 0.15, 700], [0, 0, 200], [200, 0.15, 700], [0, 0, 200], [200, 0.15, 700]]))!;
    // 起伏：150→300→180→350→200Hz 渐变（模拟抑扬顿挫）
    const expressive = analyzePcm16(
      synth([[150, 0.15, 400], [300, 0.2, 400], [0, 0, 150], [180, 0.15, 400], [350, 0.22, 400], [0, 0, 150], [200, 0.15, 500]])
    )!;
    expect(flat.pitchVarSemitones).not.toBeNull();
    expect(expressive.pitchVarSemitones).not.toBeNull();
    expect(flat.pitchVarSemitones!).toBeLessThan(1.5);
    expect(expressive.pitchVarSemitones!).toBeGreaterThan(3);
    expect(expressive.pitchVarSemitones!).toBeGreaterThan(flat.pitchVarSemitones! * 3);
  });

  it('频率八度交替：音调变化幅度约 6 半音', () => {
    const segs: Array<[number, number, number]> = [];
    for (let i = 0; i < 10; i++) segs.push([i % 2 === 0 ? 220 : 440, 0.2, 150]);
    const f = analyzePcm16(synth(segs))!;
    expect(f.pitchVarSemitones).not.toBeNull();
    expect(f.pitchVarSemitones!).toBeGreaterThan(3);
    expect(f.pitchVarSemitones!).toBeLessThan(9);
  });
});

describe('wavToPcm', () => {
  it('剥离 WAV 头返回 data 块', () => {
    const pcm = synth([[220, 0.2, 500]]);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SR, 24);
    header.writeUInt32LE(SR * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    const wav = Buffer.concat([header, pcm]);
    const out = wavToPcm(wav)!;
    expect(out.length).toBe(pcm.length);
    expect(analyzePcm16(out)).not.toBeNull();
  });

  it('非 WAV 原样返回', () => {
    const pcm = synth([[220, 0.2, 100]]);
    expect(wavToPcm(pcm)).toBe(pcm);
  });
});
