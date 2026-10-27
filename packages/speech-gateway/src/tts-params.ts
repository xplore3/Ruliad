/** arousal(0~1，见 role-engine EmotionTracker) → TTS 语音参数映射 */

export interface TTSVoiceParams {
  /** 语速倍率（阿里 CosyVoice rate，范围 0.5~2） */
  speechRate: number;
  /** 音调倍率（阿里 CosyVoice pitch，范围 0.5~2） */
  pitchRate: number;
  /** 音量（0~100，阿里 CosyVoice volume） */
  volume: number;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * 平静（arousal ≤ 0.4）保持默认（1.0 倍速/原调）；
 * 之上随唤醒度线性抬升：不耐烦/高唤醒 → 语速快、音调高、略大声。
 * excitement 为激情倍率（默认 1，示范销售用 9）：等比放大抬升幅度。
 * 激情模式（excitement>1）目标值固定在自然但高能量的区间：语速 ≤1.15（略快）、音调 ≤1.1（接近正常，仅保留一点明亮度）、
 * 音量 ≤65——音调过高会有"夹子音"，语速过快会听不清，激情主要由元气音色本身和足量音量承担。
 * 非激情模式语速/音调上限为 CosyVoice 参数上限 2.0。
 */
export function arousalToTTSParams(arousal: number | undefined, excitement = 1): TTSVoiceParams {
  const a = clamp01(arousal ?? 0.3);
  const t = Math.max(0, (a - 0.4) / 0.6) * Math.max(1, excitement);
  const passion = excitement > 1;
  return {
    speechRate: round2(Math.min(passion ? 1.15 : 2, 1 + t * 0.35)),
    pitchRate: round2(Math.min(passion ? 1.1 : 2, 1 + t * 0.2)),
    volume: Math.min(passion ? 65 : 100, Math.round(50 + t * 10)),
  };
}
