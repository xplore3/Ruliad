import { describe, expect, it } from 'vitest';
import type { BehaviorBand } from '@grasp-mvp/core';
import { bandFor, EmotionTracker } from './emotion.js';

const bands: BehaviorBand[] = [
  { minArousal: 0, maxArousal: 0.4, key: 'calm', instruction: '耐心倾听' },
  { minArousal: 0.4, maxArousal: 0.7, key: 'guarded', instruction: '开始质疑' },
  { minArousal: 0.7, maxArousal: 1.0, key: 'annoyed', instruction: '不耐烦催促' },
];

const dynamics = {
  triggers: [
    { id: 't-claim', keywords: ['理赔', '赔付'], escalation: 0.25, description: '理赔顾虑' },
    { id: 't-price', keywords: ['贵', '价格'], escalation: 0.15, description: '价格敏感' },
  ],
  decayPerTurn: 0.1,
  baseArousal: 0.3,
};

describe('bandFor', () => {
  it('左闭右开匹配', () => {
    expect(bandFor(0, bands).key).toBe('calm');
    expect(bandFor(0.39, bands).key).toBe('calm');
    expect(bandFor(0.4, bands).key).toBe('guarded');
    expect(bandFor(0.7, bands).key).toBe('annoyed');
  });

  it('1.0 边界命中最后一档', () => {
    expect(bandFor(1, bands).key).toBe('annoyed');
  });

  it('超出范围 clamp 后匹配', () => {
    expect(bandFor(-1, bands).key).toBe('calm');
    expect(bandFor(2, bands).key).toBe('annoyed');
  });

  it('区间有空隙时取最近的档', () => {
    const gapped: BehaviorBand[] = [
      { minArousal: 0, maxArousal: 0.3, key: 'low', instruction: '' },
      { minArousal: 0.6, maxArousal: 1.0, key: 'high', instruction: '' },
    ];
    expect(bandFor(0.34, gapped).key).toBe('low');
    expect(bandFor(0.56, gapped).key).toBe('high');
  });

  it('空 bands 抛错', () => {
    expect(() => bandFor(0.5, [])).toThrow();
  });
});

describe('EmotionTracker', () => {
  it('初始唤醒度取 baseArousal', () => {
    const t = new EmotionTracker(dynamics, bands);
    expect(t.arousal).toBeCloseTo(0.3);
  });

  it('命中触发器升唤醒并记录 triggeredBy', () => {
    const t = new EmotionTracker(dynamics, bands);
    const snap = t.update('我想了解一下理赔流程');
    // 0.3 + 0.25 - 0.1 = 0.45
    expect(snap.arousal).toBeCloseTo(0.45);
    expect(snap.triggeredBy).toEqual(['t-claim']);
    expect(snap.bandKey).toBe('guarded');
  });

  it('多个触发器同时命中可叠加', () => {
    const t = new EmotionTracker(dynamics, bands);
    const snap = t.update('赔付多久到账，价格也有点贵');
    // 0.3 + 0.25 + 0.15 - 0.1 = 0.6
    expect(snap.arousal).toBeCloseTo(0.6);
    expect(snap.triggeredBy).toEqual(['t-claim', 't-price']);
  });

  it('未命中时自然衰减', () => {
    const t = new EmotionTracker(dynamics, bands);
    const snap = t.update('您好，很高兴认识您');
    // 0.3 - 0.1 = 0.2
    expect(snap.arousal).toBeCloseTo(0.2);
    expect(snap.triggeredBy).toBeUndefined();
    expect(snap.bandKey).toBe('calm');
  });

  it('clamp 到 [0,1]', () => {
    const high = new EmotionTracker({ ...dynamics, baseArousal: 0.95 }, bands);
    const snapHigh = high.update('理赔价格太贵了');
    // 0.95 + 0.4 - 0.1 = 1.25 -> 1
    expect(snapHigh.arousal).toBe(1);
    expect(snapHigh.bandKey).toBe('annoyed');

    const low = new EmotionTracker({ ...dynamics, baseArousal: 0.05 }, bands);
    const snapLow = low.update('您好');
    // 0.05 - 0.1 = -0.05 -> 0
    expect(snapLow.arousal).toBe(0);
  });

  it('连续多轮触发后档位从 calm 切到 annoyed', () => {
    const t = new EmotionTracker(dynamics, bands);
    // 0.3 + 0.25 - 0.1 = 0.45
    expect(t.update('说说理赔').bandKey).toBe('guarded');
    // 0.45 + 0.25 - 0.1 = 0.6
    expect(t.update('赔付快吗').bandKey).toBe('guarded');
    // 0.6 + 0.25 - 0.1 = 0.75
    expect(t.update('理赔时效呢').bandKey).toBe('annoyed');
  });
});
