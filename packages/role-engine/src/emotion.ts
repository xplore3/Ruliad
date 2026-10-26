import type { BehaviorBand, EmotionSnapshot, PersonaRuntimeBundle } from '@grasp-mvp/core';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * 按唤醒度选择行为档位：区间 [minArousal, maxArousal) 匹配。
 * 最后一档的上界按闭区间处理（arousal=1.0 也能命中）。
 * 无匹配时取区间距离最近的档。
 */
export function bandFor(arousal: number, bands: BehaviorBand[]): BehaviorBand {
  if (bands.length === 0) {
    throw new Error('bandFor: bands 不能为空');
  }
  const sorted = [...bands].sort((a, b) => a.minArousal - b.minArousal);
  const a = clamp01(arousal);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    const upperOk = i === sorted.length - 1 ? a <= b.maxArousal : a < b.maxArousal;
    if (a >= b.minArousal && upperOk) {
      return b;
    }
  }
  // 无匹配（区间有空隙）：取最近的档
  let best = sorted[0];
  let bestDist = Infinity;
  for (const b of sorted) {
    const dist = a < b.minArousal ? b.minArousal - a : a - b.maxArousal;
    if (dist < bestDist) {
      best = b;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * 单变量情绪跟踪器：
 * 每轮先命中 trigger 关键词叠加 escalation，再衰减 decayPerTurn，clamp [0,1]。
 */
export class EmotionTracker {
  private currentArousal: number;

  constructor(
    private dynamics: PersonaRuntimeBundle['dynamics'],
    private bands: BehaviorBand[],
    initialArousal?: number
  ) {
    this.currentArousal = clamp01(initialArousal ?? dynamics.baseArousal);
  }

  get arousal(): number {
    return this.currentArousal;
  }

  update(traineeText: string): EmotionSnapshot {
    const triggeredBy: string[] = [];
    let delta = 0;
    for (const trigger of this.dynamics.triggers) {
      if (trigger.keywords.some((k) => traineeText.includes(k))) {
        triggeredBy.push(trigger.id);
        delta += trigger.escalation;
      }
    }
    this.currentArousal = clamp01(this.currentArousal + delta - this.dynamics.decayPerTurn);
    const band = bandFor(this.currentArousal, this.bands);
    const snapshot: EmotionSnapshot = { arousal: this.currentArousal, bandKey: band.key };
    if (triggeredBy.length > 0) {
      snapshot.triggeredBy = triggeredBy;
    }
    return snapshot;
  }
}
