import type { VoiceFeatures } from '@grasp-mvp/core';

/**
 * 学员录音的声学特征提取（确定性分析，不依赖任何云服务）。
 * 输入 PCM16 LE mono（语音链路上行 16kHz；TTS 校准样本 22050Hz，经 sampleRate 参数适配），
 * 输出四个评分量化参数：平均响度 / 响度动态范围 / 音调变化幅度 / 实际说话时长。
 *
 * 抗失真设计（v3）：
 * - 分析前做电平归一化（有声帧 p90 抬到统一电平，增益封顶 4×），
 *   麦克风增益/距离/浏览器 AGC 开关造成的整体电平差异不影响测量；
 * - 有声判定用自适应阈值（噪声底 p10×3，且不超过语音峰值 p90×10%），
 *   避免轻声字被误切导致"说话时长缩水、语速虚高"；
 * - 响度动态范围用 200ms 音节级包络（而非 20ms 短帧），
 *   过滤元音/辅音的音素级能量差，只留情绪性起伏；
 * - 音调轨迹经高置信帧筛选（clarity≥0.6）+ 3 帧中值滤波剔除孤立八度跳变，再求半音标准差；
 */

/** 有声帧绝对阈值下限（噪声极小时兜底） */
const MIN_VOICED_RMS = 0.008;
/** 断句桥接：静音不超过该帧数仍算说话（音素间气口不算停顿） */
const HANGOVER_FRAMES = 8; // ×20ms = 160ms
/** 音调检测的 F0 范围（人声基频 60~500Hz） */
const F0_MIN_HZ = 60;
const F0_MAX_HZ = 500;
/** 音调帧自相关置信度下限（清音/噪声帧剔除） */
const PITCH_CLARITY_THRESHOLD = 0.6;
/** 音调轨迹中值滤波核（帧）：剔除孤立八度错误；核太大会磨平音节级真实起伏（实测 5 帧在 4.5Hz 调制下压低 15%+） */
const PITCH_MEDIAN_KERNEL = 3;
/** 短于该时长的音频不出特征（数据无统计意义） */
const MIN_VOICED_MS = 400;

function rmsOf(samples: Int16Array, start: number, len: number): number {
  let sum = 0;
  for (let i = start; i < start + len; i++) {
    const s = samples[i] / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / len);
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** 单帧基频检测：归一化自相关，返回 { f0, clarity }；能量过低返回 null。
 *  次谐波抑制：周期信号的整数倍滞后同样高相关，直接取全局最大会锁到 1/2、1/3 基频；
 *  改为取"最接近全局峰值的最短滞后"（≥峰值 85% 的第一个峰），优先真实基频。 */
function pitchOfFrame(
  samples: Int16Array,
  start: number,
  winLen: number,
  sampleRate: number
): { f0: number; clarity: number } | null {
  const energy = rmsOf(samples, start, winLen);
  if (energy < MIN_VOICED_RMS) return null;
  const minLag = Math.floor(sampleRate / F0_MAX_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / F0_MIN_HZ), winLen - 1);
  const corrs = new Float64Array(maxLag + 1);
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let norm1 = 0;
    let norm2 = 0;
    const n = winLen - lag;
    for (let i = 0; i < n; i++) {
      const a = samples[start + i];
      const b = samples[start + i + lag];
      sum += a * b;
      norm1 += a * a;
      norm2 += b * b;
    }
    const denom = Math.sqrt(norm1 * norm2);
    const corr = denom > 0 ? sum / denom : 0;
    corrs[lag] = corr;
    if (corr > bestCorr) bestCorr = corr;
  }
  if (bestCorr <= 0) return null;
  const threshold = bestCorr * 0.85;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (corrs[lag] >= threshold) {
      return { f0: sampleRate / lag, clarity: corrs[lag] };
    }
  }
  return null;
}

/** 剥离 WAV 头取 PCM data 块；非 WAV 原样返回；找不到 data 块返回 null */
export function wavToPcm(buf: Buffer): Buffer | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return buf;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') return buf.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  return null;
}

/**
 * 分析一段 PCM16 音频，产出声学特征。
 * @param pcm PCM16 LE mono 音频（WAV 需先经 wavToPcm 剥离）
 * @param sampleRate 采样率（链路上行固定 16000；TTS 校准样本 22050）
 * @returns 特征；音频过短（<400ms 有声）返回 null
 */
/** 电平归一化目标（有声帧 p90 RMS ≈ 0.05，约 -26dBFS） */
const NORM_TARGET_RMS = 0.05;
/** 归一化增益上限（+21.6dB）：覆盖低增益麦克风；有声判定用相对阈值，不受增益影响 */
const NORM_MAX_GAIN = 12;
/** 归一化后的有声帧绝对阈值地板（-48dBFS，约比归一化语音电平低 22dB） */
const POST_NORM_MIN_RMS = 0.004;

export function analyzePcm16(pcm: Buffer, sampleRate = 16000): VoiceFeatures | null {
  let samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  if (samples.length < sampleRate / 4) return null;

  // ---- 20ms 短帧能量 ----
  const frameLen = Math.floor(sampleRate * 0.02);
  const frameRmsOf = (s: Int16Array): number[] => {
    const out: number[] = [];
    for (let start = 0; start + frameLen <= s.length; start += frameLen) {
      out.push(rmsOf(s, start, frameLen));
    }
    return out;
  };
  let frameRms = frameRmsOf(samples);
  if (frameRms.length === 0) return null;

  // 电平归一化：麦克风增益/距离/AGC 开关造成的整体电平差异不应影响声学测量。
  // 以有声帧 p90 为信号电平估计，双向归一到统一电平（轻声放大、过响衰减）
  const audible = frameRms.filter((r) => r > MIN_VOICED_RMS).sort((a, b) => a - b);
  if (audible.length > 0) {
    const level = percentile(audible, 0.9);
    const gain = Math.min(NORM_MAX_GAIN, NORM_TARGET_RMS / level);
    if (gain > 1.05 || gain < 0.95) {
      const scaled = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const v = Math.round(samples[i] * gain);
        scaled[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
      samples = scaled;
      frameRms = frameRmsOf(samples);
    }
  }

  // 自适应有声阈值：噪声底 p10×3，但不超过语音峰值 p90×10%（防止把轻声段全切掉）。
  // 归一化后语音电平固定，绝对地板相应降到 -48dBFS（0.004），否则会误切归一化后的轻声段
  const sortedRms = [...frameRms].sort((a, b) => a - b);
  const thr = Math.max(POST_NORM_MIN_RMS, Math.min(percentile(sortedRms, 0.1) * 3, percentile(sortedRms, 0.9) * 0.1));

  // 有声帧 + 断句桥接（短气口不算停顿）
  const voicedFlags = frameRms.map((r) => r > thr);
  let hang = 0;
  for (let i = 0; i < voicedFlags.length; i++) {
    if (voicedFlags[i]) {
      hang = HANGOVER_FRAMES;
    } else if (hang > 0) {
      voicedFlags[i] = true;
      hang--;
    }
  }
  const voicedRms = frameRms.filter((_, i) => voicedFlags[i]);
  const voicedMs = voicedRms.length * 20;
  if (voicedRms.length === 0 || voicedMs < MIN_VOICED_MS) return null;

  // ---- 平均响度（20ms 有声帧） ----
  const meanRms = voicedRms.reduce((a, b) => a + b, 0) / voicedRms.length;
  const avgLoudnessDbfs = Math.round(20 * Math.log10(meanRms) * 10) / 10;

  // ---- 响度动态范围：200ms 音节级包络（hop 100ms），P90-P10 ----
  const envLen = Math.floor(sampleRate * 0.2);
  const envHop = Math.floor(sampleRate * 0.1);
  const envRms: number[] = [];
  for (let start = 0; start + envLen <= samples.length; start += envHop) {
    const r = rmsOf(samples, start, envLen);
    if (r > thr) envRms.push(r);
  }
  let loudnessRangeDb = 0;
  if (envRms.length >= 3) {
    const sortedEnv = [...envRms].sort((a, b) => a - b);
    loudnessRangeDb =
      Math.round(20 * Math.log10(percentile(sortedEnv, 0.9) / Math.max(percentile(sortedEnv, 0.1), 1e-6)) * 10) / 10;
  }

  // ---- 音调变化幅度：40ms 窗 / 20ms 步进 → 高置信帧 → 中值滤波 → 半音标准差 ----
  const winLen = Math.floor(sampleRate * 0.04);
  const hopLen = Math.floor(sampleRate * 0.02);
  const rawMidi: number[] = [];
  for (let start = 0; start + winLen <= samples.length; start += hopLen) {
    const r = pitchOfFrame(samples, start, winLen, sampleRate);
    if (r && r.clarity >= PITCH_CLARITY_THRESHOLD) {
      rawMidi.push(69 + 12 * Math.log2(r.f0 / 440));
    }
  }
  let pitchVarSemitones: number | null = null;
  let medianF0Hz: number | null = null;
  if (rawMidi.length >= PITCH_MEDIAN_KERNEL) {
    // 音高中位数：对孤立八度错误稳健，反映整体音区（激情抬升型表现的关键量）
    medianF0Hz = Math.round(440 * 2 ** ((medianOf(rawMidi) - 69) / 12));
    const half = Math.floor(PITCH_MEDIAN_KERNEL / 2);
    const filtered = rawMidi.map((_, i) =>
      medianOf(rawMidi.slice(Math.max(0, i - half), Math.min(rawMidi.length, i + half + 1)))
    );
    const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
    const variance = filtered.reduce((sum, v) => sum + (v - mean) ** 2, 0) / filtered.length;
    pitchVarSemitones = Math.round(Math.sqrt(variance) * 100) / 100;
  }

  return { avgLoudnessDbfs, loudnessRangeDb, pitchVarSemitones, medianF0Hz, voicedMs };
}
