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

it('语调测试从详解36题中不放回随机抽取6题', () => {
  const questions = pickReceptionQuestions(6);
  expect(questions).toHaveLength(6);
  expect(new Set(questions.map((item) => item.question)).size).toBe(6);
  expect(questions.every((item) => RECEPTION_QUESTION_POOL.some((source) => source.question === item.question))).toBe(true);
});

it('退费题按政策70分、最近截图15分、机构信心15分评分', () => {
  const question = RECEPTION_QUESTION_POOL.find((item) => item.question === '学费能不能退呀？');
  expect(question?.scoringGuide).toContain('获得70分');
  expect(question?.scoringGuide).toContain('最近真实退费截图加15分');
  expect(question?.scoringGuide).toContain('信心再加15分');
  expect(question?.scoringGuide).toContain('不再要求必须实际展示截图');
  expect(question?.scoringGuide).not.toContain('30分');
  expect(question?.scoringGuide).not.toContain('40分');
});
