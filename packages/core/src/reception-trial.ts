import { RECEPTION_DIRECT_ENROLL_QUESTION } from './reception-questions.js';
import type { Session, TranscriptTurn } from './types/session.js';

const OPEN_TIME_PATTERN = /什么时候|何时|哪天|周几|星期|几点|什么时间|哪个时间|哪个时段|周六|周日|周末|周[一二三四五六日天]/;
const QUESTION_PATTERN = /吗|？|\?|要不要|是否|怎么样|如何/;
const ARRANGEMENT_PATTERN = /我.{0,6}(安排|约|确定|定).{0,8}(试听|时间|老师|课程|课)|我给您安排|我给您约|我来安排|我这边.{0,4}安排/;

export function isTrialInitiativeText(text: string): boolean {
  if (ARRANGEMENT_PATTERN.test(text)) return true;
  if (!text.includes('试听')) return false;
  if (OPEN_TIME_PATTERN.test(text) || QUESTION_PATTERN.test(text)) return true;
  return /(安排|约|确定|定).{0,6}试听|试听.{0,6}(安排|约|确定|定)/.test(text);
}

export function findTrialInitiativeTurn(transcript: TranscriptTurn[]): TranscriptTurn | undefined {
  return transcript.find((turn) => turn.speaker === 'trainee' && isTrialInitiativeText(turn.text));
}

export function isReceptionTrialDeclined(session: Session): boolean {
  return session.receptionTrialDisposition === 'decline' &&
    !!session.receptionQuestions?.some((item) => item.question === RECEPTION_DIRECT_ENROLL_QUESTION);
}
