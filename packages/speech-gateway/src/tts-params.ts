/** arousal(0~1，见 role-engine EmotionTracker) → TTS 语音参数映射 */

export interface TTSVoiceParams {
  /** 语速倍率（阿里 CosyVoice speech_rate，范围 0.5~2） */
  speechRate: number;
  /** 音调倍率（阿里 CosyVoice pitch_rate，范围 0.5~2） */
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
 */
export function arousalToTTSParams(arousal: number | undefined): TTSVoiceParams {
  const a = clamp01(arousal ?? 0.3);
  const t = Math.max(0, (a - 0.4) / 0.6); // 0~1，0.4 以下恒为 0
  return {
    speechRate: round2(1 + t * 0.35),
    pitchRate: round2(1 + t * 0.2),
    volume: Math.round(50 + t * 10),
  };
}
