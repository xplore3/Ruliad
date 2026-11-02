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

  it('恒定 220Hz 正弦：归一化到目标电平，音调变化幅度小', () => {
    const f = analyzePcm16(synth([[220, 0.2, 2000]]))!;
    expect(f).not.toBeNull();
    // 电平归一化：语音 p90 统一到 0.05 RMS；恒定正弦 mean=p90 → ≈ -26.0 dBFS
    expect(f.avgLoudnessDbfs).toBeGreaterThan(-27.5);
    expect(f.avgLoudnessDbfs).toBeLessThan(-24.5);
    // 恒定频率 → 音调变化幅度应很小；音高中位数应接近 220Hz
    expect(f.pitchVarSemitones).not.toBeNull();
    expect(f.pitchVarSemitones!).toBeLessThan(1);
    expect(f.medianF0Hz).toBeGreaterThan(200);
    expect(f.medianF0Hz).toBeLessThan(240);
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

  it('电平归一化：同一段话大声/小声（差 20dB）测得的音调与动态范围基本一致', () => {
    // 模拟同一表现、不同麦克风增益：0.15~0.22 vs 0.015~0.022（约 -33dBFS，低增益麦克风实景）
    const shape: Array<[number, number, number]> = [
      [150, 1, 400], [300, 1.3, 400], [0, 0, 150], [180, 1, 400], [350, 1.4, 400], [0, 0, 150], [200, 1, 500],
    ];
    const loud = analyzePcm16(synth(shape.map(([f, a, ms]) => [f, a * 0.15, ms])))!;
    const quiet = analyzePcm16(synth(shape.map(([f, a, ms]) => [f, a * 0.015, ms])))!;
    // 轻声版被归一化抬回目标电平附近：平均响度差距从 20dB 收敛到 3dB 以内
    expect(Math.abs(quiet.avgLoudnessDbfs - loud.avgLoudnessDbfs)).toBeLessThan(3);
    // 相对量（音调变化/响度起伏）在两种增益下基本一致
    expect(Math.abs(quiet.pitchVarSemitones! - loud.pitchVarSemitones!)).toBeLessThan(0.5);
    expect(Math.abs(quiet.loudnessRangeDb - loud.loudnessRangeDb)).toBeLessThan(1.5);
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
