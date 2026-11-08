import { expect, it } from 'vitest';
import type { ScoreItemResult } from '@grasp-mvp/core';
import { applyConfidenceIndex, confidenceIndexOf } from './confidence.js';

function item(score: number, deduction: boolean): ScoreItemResult {
  return {
    itemId: deduction ? 'taboo' : 'base',
    itemName: deduction ? '忌讳' : '基础项',
    skillPointId: 'sp',
    levelKey: 'score',
    levelLabel: '得分',
    score,
    quote: '',
    quoteTurnSeq: 0,
    rationale: '',
    confidence: 1,
    judgeAgree: true,
    isReference: false,
    isObservation: false,
    isDeduction: deduction,
    layer: 'company',
  };
}

it('基础分乘以信心指数', () => {
  const result = applyConfidenceIndex(80, [item(80, false), item(40, true)]);
  expect(result.confidenceIndex).toBe(0.6);
  expect(result.totalScore).toBe(48);
});

it('咨询接待忌讳40分始终按乘法计算总分', () => {
  const result = applyConfidenceIndex(77, [item(85, false), item(40, true)]);
  expect(result.confidenceIndex).toBe(0.6);
  expect(result.totalScore).toBe(46);
});

it('地推销售忌讳同样按固定信心指数乘算总分', () => {
  const groundPushTaboo = { ...item(45, true), itemName: '地推销售忌讳' };
  const result = applyConfidenceIndex(80, [item(80, false), groundPushTaboo]);
  expect(result.confidenceIndex).toBe(0.55);
  expect(result.totalScore).toBe(44);
});

it('扣减参数再高信心指数也不低于20%', () => {
  const items = [item(80, false), item(100, true), item(50, true)];
  expect(confidenceIndexOf(items)).toBe(0.2);
  expect(applyConfidenceIndex(80, items).totalScore).toBe(16);
});

it('有效演练基础分为0时最终仍保留1分', () => {
  expect(applyConfidenceIndex(0, [item(0, false)]).totalScore).toBe(1);
});

it('没有忌讳调整时信心指数为100%', () => {
  const result = applyConfidenceIndex(75, [item(75, false)]);
  expect(result.confidenceIndex).toBe(1);
  expect(result.totalScore).toBe(75);
});
