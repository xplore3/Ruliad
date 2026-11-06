import type { ScoreItemResult } from '@grasp-mvp/core';

export function deductionPoints(items: ScoreItemResult[]): number {
  return items
    .filter((item) => item.isDeduction)
    .reduce((sum, item) => sum + Math.max(0, item.score), 0);
}

export function confidenceIndexOf(items: ScoreItemResult[]): number {
  return Math.max(0.2, 1 - deductionPoints(items) / 100);
}

export function applyConfidenceIndex(baseScore: number, items: ScoreItemResult[]): {
  baseScore: number;
  confidenceIndex: number;
  totalScore: number;
} {
  const confidenceIndex = confidenceIndexOf(items);
  const hasScoredItems = items.some((item) => !item.isObservation && !item.isDeduction);
  const adjusted = Math.round(baseScore * confidenceIndex);
  return {
    baseScore,
    confidenceIndex,
    totalScore: hasScoredItems ? Math.max(1, adjusted) : adjusted,
  };
}
