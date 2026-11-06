import {
  RECEPTION_DIRECT_ENROLL_QUESTION,
  RECEPTION_QUESTION_POOL,
  RECEPTION_TRIAL_SCHEDULE_QUESTION,
  type ReceptionQuestion,
  type ReceptionTrialDisposition,
} from '@grasp-mvp/core';

export interface ReceptionPlan {
  questions: ReceptionQuestion[];
  receptionTrialDisposition?: ReceptionTrialDisposition;
}

export function pickReceptionQuestions(count = 10, random: () => number = Math.random): ReceptionQuestion[] {
  const pool = RECEPTION_QUESTION_POOL.map((item) => ({ ...item }));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function pickReceptionTrialDisposition(random: () => number = Math.random): ReceptionTrialDisposition {
  return random() < 0.8 ? 'accept' : 'decline';
}

export function applyReceptionTrialDisposition(
  questions: ReceptionQuestion[],
  disposition: ReceptionTrialDisposition
): ReceptionQuestion[] {
  if (disposition !== 'decline' || !questions.some((item) => item.question === RECEPTION_TRIAL_SCHEDULE_QUESTION)) {
    return questions;
  }
  const selected = new Set(questions.map((item) => item.question));
  const replacement = RECEPTION_QUESTION_POOL.find((item) =>
    !selected.has(item.question) &&
    item.question !== RECEPTION_DIRECT_ENROLL_QUESTION &&
    item.question !== RECEPTION_TRIAL_SCHEDULE_QUESTION
  );
  if (!replacement) return questions;
  return questions.map((item) => item.question === RECEPTION_TRIAL_SCHEDULE_QUESTION ? { ...replacement } : item);
}

export function createReceptionPlan(random: () => number = Math.random): ReceptionPlan {
  const questions = pickReceptionQuestions(10, random);
  if (!questions.some((item) => item.question === RECEPTION_DIRECT_ENROLL_QUESTION)) return { questions };
  const receptionTrialDisposition = pickReceptionTrialDisposition(random);
  return {
    questions: applyReceptionTrialDisposition(questions, receptionTrialDisposition),
    receptionTrialDisposition,
  };
}

export function receptionQuestionPrompt(
  questions?: ReceptionQuestion[],
  disposition?: ReceptionTrialDisposition
): string {
  if (!questions || questions.length !== 10) return '';
  const hasDirectEnrollQuestion = questions.some((item) => item.question === RECEPTION_DIRECT_ENROLL_QUESTION);
  const trialDispositionRules = hasDirectEnrollQuestion && disposition
    ? [
        disposition === 'accept'
          ? '本场家长愿意接受试听。问到“不用试听，我们到时候看一下直接报名吧”后，只要学员合理建议仍先试听，就必须当场明确同意，例如“好的，听您的，还是先带孩子试听一下”，不得继续拒绝、拖延或说再考虑；之后可配合学员确定试听时间，但仍不得由家长主动发起邀约。'
          : '本场家长坚持不试听。问到“不用试听，我们到时候看一下直接报名吧”后，即使学员合理建议仍先试听，也要礼貌但明确地坚持到时候直接报名，不得动摇或接受试听；后续正常完成剩余咨询问答，不再进入试听邀约过渡。系统不会因未确定试听时间或未传达试听当天报名优惠而扣分。',
      ]
    : [];
  return [
    '【咨询接待“对答得当”10题考核（必须执行）】',
    '本场必须从下列题目中按顺序逐题询问学员。该要求优先于剧本中的 FAQ 数量和提前收尾安排。',
    ...questions.map((item, index) => `${index + 1}. ${item.question}`),
    '执行规则：每轮只问一题，等待学员完整回答后再问下一题；不得代替学员回答，不得向学员透露参考答案或评分标准，不得遗漏、增加、更换或重复提问。已经问过的固定题不得再次询问，即使前面自由问答涉及过相同话题，也只能作为该固定题提问一次。每次实际提出第n道固定题时，必须在回复末尾加上内部标记[[Q:n]]；没有提出新的固定题时不得加标记。10题全部问答完成后，客户只接收信息，不主动提出试听、不主动约定时间，由系统按固定过渡流程给学员邀约机会。',
    ...trialDispositionRules,
  ].join('\n');
}
