import { findTrialInitiativeTurn, type ScoreItemDef, type ScoreItemResult, type Session } from '@grasp-mvp/core';

export function judgeReceptionTrialInitiative(def: ScoreItemDef, session: Session): ScoreItemResult {
  const initiative = findTrialInitiativeTurn(session.transcript);
  return {
    itemId: def.id,
    itemName: def.name,
    skillPointId: def.skillPointId,
    levelKey: 'score',
    levelLabel: '主动性确认试听时间',
    score: initiative ? 100 : 0,
    quote: initiative?.text ?? '',
    quoteTurnSeq: initiative?.seq ?? 0,
    rationale: initiative
      ? `第${initiative.seq}轮主动提出试听：“${initiative.text}”。只要在过程中主动提出试听，本项即得100分；邀约是否属于封闭式提问只在咨询接待忌讳项另行扣分，不影响本项结果。`
      : '10题问答后，客户已给出过渡和最后一次邀约机会，学员仍未主动提出试听，本项得0分。',
    betterScript: initiative ? '' : '您什么时候方便试听？我给您安排。',
    confidence: 0.99,
    judgeAgree: true,
    isReference: false,
    isObservation: def.isObservation,
    isDeduction: def.deductionOnly,
    layer: def.layer,
  };
}
