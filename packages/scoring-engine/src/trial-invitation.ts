import type { Session } from '@grasp-mvp/core';

export const RECEPTION_TRIAL_INVITATION_DEDUCTION = 5;

export interface ReceptionTrialInvitationAnalysis {
  triggered: boolean;
  deduction: number;
  rationale: string;
  evidence: string[];
  quoteTurnSeq: number;
}

const OPEN_TIME_PATTERN = /什么时候|何时|哪天|周几|星期|几点|什么时间|哪个时间|哪个时段|周六|周日|周末|周[一二三四五六日天]/;
const QUESTION_PATTERN = /吗|？|\?|要不要|是否|可否|怎么样|如何/;
const CLOSED_INVITATION_PATTERNS = [
  /(想|想要|希望|愿意|需要|要不要|是否|考虑|可以|能|能否).{0,12}(孩子|小朋友|宝宝)?.{0,4}(参加|安排|来|去|过来)?.{0,4}试听/,
  /试听.{0,6}(要不要|需要吗|愿意吗|想吗|好吗|行吗|可以吗|好不好)/,
  /(安排|参加|来|去|过来).{0,6}试听.{0,4}(怎么样|如何)/,
];

export function analyzeReceptionTrialInvitation(session: Session): ReceptionTrialInvitationAnalysis {
  const matches = session.transcript.filter((turn) => {
    if (turn.speaker !== 'trainee' || !turn.text.includes('试听')) return false;
    if (OPEN_TIME_PATTERN.test(turn.text)) return false;
    return QUESTION_PATTERN.test(turn.text) && CLOSED_INVITATION_PATTERNS.some((pattern) => pattern.test(turn.text));
  });
  const triggered = matches.length > 0;
  const evidence = matches.map((turn) => `第${turn.seq}轮使用封闭式邀约“${turn.text}”`);
  return {
    triggered,
    deduction: triggered ? RECEPTION_TRIAL_INVITATION_DEDUCTION : 0,
    rationale: triggered
      ? `${evidence.join('；')}。封闭式提问容易让客户直接拒绝，应改为“您什么时候方便试听？我给您安排。”，全局扣5分。`
      : '未发现封闭式试听邀约，开放式安排试听时间不扣分。',
    evidence,
    quoteTurnSeq: matches[0]?.seq ?? 0,
  };
}
