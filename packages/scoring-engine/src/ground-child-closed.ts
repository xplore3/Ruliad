import type { Session } from '@grasp-mvp/core';

export const GROUND_CHILD_CLOSED_QUESTION_DEDUCTION = 10;

export function analyzeGroundChildClosedQuestions(session: Session) {
  const violations = session.transcript.filter((turn) => turn.speaker === 'trainee' && turn.groundChildClosedQuestion);
  const evidence = violations.map((turn) => `第${turn.seq}轮无有效铺垫直接问孩子：“${turn.text}”`);
  return {
    triggered: violations.length > 0,
    deduction: violations.length * GROUND_CHILD_CLOSED_QUESTION_DEDUCTION,
    rationale: violations.length > 0
      ? `${evidence.join('；')}。未先提供情感支持并讲出能逗孩子开心的故事或游戏，答案不确定，属于封闭式提问，每次扣10分，共扣${violations.length * GROUND_CHILD_CLOSED_QUESTION_DEDUCTION}分。`
      : '未发现无有效铺垫直接询问孩子是否喜欢的封闭式问题；完成情感支持和趣味铺垫后提问不扣分。',
    evidence,
    quoteTurnSeq: violations[0]?.seq ?? 0,
  };
}
