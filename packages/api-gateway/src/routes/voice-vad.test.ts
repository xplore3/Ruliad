import { describe, expect, it } from 'vitest';
import { createAdaptiveVad } from './voice.js';

describe('voice-call 自适应 VAD', () => {
  it('初始阈值能识别较轻的发言', () => {
    const vad = createAdaptiveVad();
    expect(vad.threshold()).toBeCloseTo(0.008);
    expect(vad.isSpeech(0.009)).toBe(true);
  });

  it('噪声底慢速学习，不把连续的轻声块立即学成噪声', () => {
    const vad = createAdaptiveVad();
    for (let i = 0; i < 100; i++) expect(vad.isSpeech(0.004)).toBe(false);
    expect(vad.threshold()).toBeGreaterThan(0.007);
    expect(vad.isSpeech(0.009)).toBe(true);
  });

  it('长时间安静后仍能降低门槛并保持噪声底下限', () => {
    const vad = createAdaptiveVad();
    for (let i = 0; i < 5000; i++) vad.isSpeech(0);
    expect(vad.threshold()).toBeCloseTo(0.003);
  });
});
