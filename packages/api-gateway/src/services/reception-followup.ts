import { findTrialInitiativeTurn, isReceptionTrialDeclined, type Session } from '@grasp-mvp/core';

export const RECEPTION_TRIAL_TRANSITION = '好的，我了解情况了。';
export const RECEPTION_TRIAL_LAST_CHANCE = '那我们考虑好了找您。';
export const RECEPTION_TRIAL_CLOSE = '好的，那您先考虑一下，我们再联系。';

export interface ReceptionFollowup {
  text: string;
  shouldClose: boolean;
}

export function receptionTrialFollowup(session: Session): ReceptionFollowup | undefined {
  if (session.receptionQuestions?.length !== 10) return undefined;
  if (isReceptionTrialDeclined(session)) return undefined;
  if (findTrialInitiativeTurn(session.transcript)) return undefined;
  if (session.receptionQuestionIndex !== 10) return undefined;
  const personaText = session.transcript.filter((turn) => turn.speaker === 'persona').map((turn) => turn.text).join('\n');
  if (personaText.includes(RECEPTION_TRIAL_LAST_CHANCE)) {
    return { text: RECEPTION_TRIAL_CLOSE, shouldClose: true };
  }
  if (personaText.includes(RECEPTION_TRIAL_TRANSITION)) {
    return { text: RECEPTION_TRIAL_LAST_CHANCE, shouldClose: false };
  }
  return { text: RECEPTION_TRIAL_TRANSITION, shouldClose: false };
}
