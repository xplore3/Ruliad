import { expect, it, vi } from 'vitest';
import { RECEPTION_DIRECT_ENROLL_QUESTION, RECEPTION_QUESTION_POOL, RECEPTION_TRIAL_SCHEDULE_QUESTION } from '@grasp-mvp/core';
import { applyReceptionTrialDisposition, pickReceptionQuestions, pickReceptionTrialDisposition, receptionQuestionPrompt } from './reception-questions.js';

it('从详解题池不放回抽取10题并固定到本场提示词', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  const questions = pickReceptionQuestions();
  expect(RECEPTION_QUESTION_POOL).toHaveLength(35);
  expect(questions).toHaveLength(10);
  expect(new Set(questions.map((item) => item.question)).size).toBe(10);
  expect(questions.every((item) => RECEPTION_QUESTION_POOL.some((source) => source.question === item.question))).toBe(true);
  expect(questions.every((item) => item.referenceAnswer && item.scoringGuide)).toBe(true);

  const prompt = receptionQuestionPrompt(questions);
  for (const [index, item] of questions.entries()) {
    expect(prompt).toContain(`${index + 1}. ${item.question}`);
  }
  expect(prompt).toContain('每轮只问一题');
  expect(prompt).toContain('不得遗漏、增加、更换或重复提问');
  expect(prompt).toContain('内部标记[[Q:n]]');
  vi.restoreAllMocks();
});

it('语调测试从详解35题中不放回随机抽取6题，客户不主动推进试听', () => {
  const questions = pickReceptionQuestions(6);
  expect(RECEPTION_QUESTION_POOL.some((item) => item.question === RECEPTION_TRIAL_SCHEDULE_QUESTION)).toBe(false);
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

it('直接报名题按80%接受、20%拒绝固定本场试听反应', () => {
  expect(pickReceptionTrialDisposition(() => 0.799)).toBe('accept');
  expect(pickReceptionTrialDisposition(() => 0.8)).toBe('decline');

  const direct = RECEPTION_QUESTION_POOL.find((item) => item.question === RECEPTION_DIRECT_ENROLL_QUESTION)!;
  const schedule = { question: RECEPTION_TRIAL_SCHEDULE_QUESTION, referenceAnswer: '安排试听时间', scoringGuide: '确定时间' };
  const others = RECEPTION_QUESTION_POOL.filter((item) => item !== direct && item !== schedule).slice(0, 8);
  const questions = [direct, schedule, ...others].map((item) => ({ ...item }));

  const acceptPrompt = receptionQuestionPrompt(questions, 'accept');
  expect(acceptPrompt).toContain('必须当场明确同意');
  expect(acceptPrompt).toContain('不得继续拒绝、拖延或说再考虑');

  const declinePrompt = receptionQuestionPrompt(questions, 'decline');
  expect(declinePrompt).toContain('礼貌但明确地坚持到时候直接报名');
  expect(declinePrompt).toContain('不再进入试听邀约过渡');
});

it('拒听场移除试听时间题并补足10道不重复题目', () => {
  const direct = RECEPTION_QUESTION_POOL.find((item) => item.question === RECEPTION_DIRECT_ENROLL_QUESTION)!;
  const schedule = { question: RECEPTION_TRIAL_SCHEDULE_QUESTION, referenceAnswer: '安排试听时间', scoringGuide: '确定时间' };
  const others = RECEPTION_QUESTION_POOL.filter((item) => item !== direct && item !== schedule).slice(0, 8);
  const questions = [direct, schedule, ...others].map((item) => ({ ...item }));
  const adjusted = applyReceptionTrialDisposition(questions, 'decline');

  expect(adjusted).toHaveLength(10);
  expect(adjusted.some((item) => item.question === RECEPTION_DIRECT_ENROLL_QUESTION)).toBe(true);
  expect(adjusted.some((item) => item.question === RECEPTION_TRIAL_SCHEDULE_QUESTION)).toBe(false);
  expect(new Set(adjusted.map((item) => item.question)).size).toBe(10);
  expect(applyReceptionTrialDisposition(questions, 'accept')).toBe(questions);
});
