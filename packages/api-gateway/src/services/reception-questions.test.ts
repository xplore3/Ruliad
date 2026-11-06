import { expect, it, vi } from 'vitest';
import { RECEPTION_QUESTION_POOL } from '@grasp-mvp/core';
import { pickReceptionQuestions, receptionQuestionPrompt } from './reception-questions.js';

it('从详解题池不放回抽取10题并固定到本场提示词', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  const questions = pickReceptionQuestions();
  expect(RECEPTION_QUESTION_POOL).toHaveLength(36);
  expect(questions).toHaveLength(10);
  expect(new Set(questions.map((item) => item.question)).size).toBe(10);
  expect(questions.every((item) => RECEPTION_QUESTION_POOL.some((source) => source.question === item.question))).toBe(true);
  expect(questions.every((item) => item.referenceAnswer && item.scoringGuide)).toBe(true);

  const prompt = receptionQuestionPrompt(questions);
  for (const [index, item] of questions.entries()) {
    expect(prompt).toContain(`${index + 1}. ${item.question}`);
  }
  expect(prompt).toContain('每轮只问一题');
  expect(prompt).toContain('不得遗漏、增加或更换题目');
  vi.restoreAllMocks();
});
