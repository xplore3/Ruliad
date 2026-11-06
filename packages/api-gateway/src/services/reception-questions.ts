import { RECEPTION_QUESTION_POOL, type ReceptionQuestion } from '@grasp-mvp/core';

export function pickReceptionQuestions(count = 10): ReceptionQuestion[] {
  const pool = RECEPTION_QUESTION_POOL.map((item) => ({ ...item }));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function receptionQuestionPrompt(questions?: ReceptionQuestion[]): string {
  if (!questions || questions.length !== 10) return '';
  return [
    '【咨询接待“对答得当”10题考核（必须执行）】',
    '本场必须从下列题目中按顺序逐题询问学员。该要求优先于剧本中的 FAQ 数量和提前收尾安排。',
    ...questions.map((item, index) => `${index + 1}. ${item.question}`),
    '执行规则：每轮只问一题，等待学员完整回答后再问下一题；不得代替学员回答，不得向学员透露参考答案或评分标准，不得遗漏、增加或更换题目。10题全部问答完成后，再按剧本自然推进预约或结束。',
  ].join('\n');
}
