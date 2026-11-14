import type { ImprovementCandidate, LLMGateway, RuleViolation, ScoreItemDef, ScoreItemResult, Session, SuggestionRule } from '@grasp-mvp/core';
import { fillTemplate, suggestionData, SUGGESTION_KEYS } from './suggestion-rules.js';

function firstLine(text: string | undefined): string {
  return text?.split('\n').find((line) => line.trim())?.trim() ?? '';
}

function hasChildCommunication(session: Session): boolean {
  return session.transcript.some((turn) =>
    turn.speaker === 'child' || (
      turn.speaker === 'trainee' && (
        turn.addressedToChild === true || /(?:小朋友|宝贝|宝宝)[，,]?\s*(?=你喜欢|你想|你好|您好|过来|喜欢|想|见过|好不好|听|看|要不要)/.test(turn.text)
      )
    )
  );
}

interface GenericGoalData {
  fatalTitle: string;
  fatalSuggestion: string;
  noIssueTitle: string;
  noIssueRationale: string;
  noIssueSuggestion: string;
  deductionItemFallback: string;
  scoredItemFallback: string;
  receptionQuestionFallback: string;
}

function legacyReceptionCandidates(item: ScoreItemResult, def: ScoreItemDef | undefined, generic: GenericGoalData): ImprovementCandidate[] {
  if (item.itemName !== '对答得当') return [];
  const questionScores = item.rationale.split('\n').map((line) => {
    const match = line.trim().match(/^第(\d+)题《([\s\S]+?)》：(\d+(?:\.\d+)?)\/100/);
    return match ? { index: Number(match[1]), question: match[2], score: Number(match[3]), rationale: line.trim() } : undefined;
  });
  const count = questionScores.length;
  return questionScores.flatMap((entry) => {
    if (!entry) return [];
    const suggestion = item.betterScript?.split('\n').find((line) => line.trim().startsWith(`第${entry.index}题：`))?.trim();
    return [{
      title: `对答得当：第${entry.index}题`,
      impact: (100 - entry.score) * (def?.weight ?? 1) / count,
      rationale: entry.rationale,
      suggestion: suggestion || fillTemplate(generic.receptionQuestionFallback, { index: entry.index, question: entry.question }),
      quoteTurnSeq: item.quoteTurnSeq,
    }];
  });
}

export function buildImprovementGoal(
  items: ScoreItemResult[],
  defs: ScoreItemDef[],
  violations: RuleViolation[],
  baseScore?: number,
  rules?: SuggestionRule[]
): ImprovementCandidate {
  const generic = suggestionData<GenericGoalData>(rules, SUGGESTION_KEYS.genericGoal);
  const fatal = violations.find((violation) => violation.fatal);
  if (fatal) {
    return {
      title: generic.fatalTitle,
      impact: Number.MAX_SAFE_INTEGER,
      rationale: fatal.detail,
      suggestion: generic.fatalSuggestion,
    };
  }

  const defById = new Map(defs.map((def) => [def.id, def]));
  const scoredItems = items.filter((item) => !item.isObservation && !item.isDeduction);
  const totalWeight = scoredItems.reduce((sum, item) => sum + Math.max(0, defById.get(item.itemId)?.weight ?? 1), 0);
  const effectiveBaseScore = baseScore ?? (totalWeight > 0
    ? Math.round(scoredItems.reduce((sum, item) => sum + item.score * Math.max(0, defById.get(item.itemId)?.weight ?? 1), 0) / totalWeight)
    : 0);
  const deductionScale = effectiveBaseScore > 0 ? effectiveBaseScore / 100 : 1;
  const candidates: ImprovementCandidate[] = [];
  for (const item of items) {
    if (item.isObservation) continue;
    if (item.isDeduction) {
      if (item.improvementCandidates?.length) {
        candidates.push(...item.improvementCandidates
          .filter((candidate) => candidate.suggestion.trim())
          .map((candidate) => ({ ...candidate, impact: candidate.impact * deductionScale })));
      } else if (item.score > 0) {
        candidates.push({
          title: item.itemName,
          impact: item.score * deductionScale,
          rationale: firstLine(item.rationale),
          suggestion: firstLine(item.betterScript) || fillTemplate(generic.deductionItemFallback, { itemName: item.itemName }),
          quoteTurnSeq: item.quoteTurnSeq,
        });
      }
      continue;
    }
    if (item.score >= 100) continue;
    const weight = Math.max(0, defById.get(item.itemId)?.weight ?? 1);
    if (weight === 0 || totalWeight === 0) continue;
    if (item.improvementCandidates?.length) {
      candidates.push(...item.improvementCandidates
        .filter((candidate) => candidate.suggestion.trim())
        .map((candidate) => ({
          ...candidate,
          impact: item.itemName === '对答得当'
            ? candidate.impact / totalWeight
            : (100 - item.score) * weight / totalWeight,
        }))
        .filter((candidate) => candidate.impact > 0));
      continue;
    }
    const legacyCandidates = legacyReceptionCandidates(item, defById.get(item.itemId), generic);
    if (legacyCandidates.length > 0) {
      candidates.push(...legacyCandidates.map((candidate) => ({
        ...candidate,
        impact: candidate.impact / totalWeight,
      })).filter((candidate) => candidate.impact > 0));
      continue;
    }
    candidates.push({
      title: item.itemName,
      impact: (100 - item.score) * weight / totalWeight,
      rationale: firstLine(item.rationale),
      suggestion: firstLine(item.betterScript) || fillTemplate(generic.scoredItemFallback, { itemName: item.itemName }),
      quoteTurnSeq: item.quoteTurnSeq,
    });
  }
  candidates.sort((a, b) => b.impact - a.impact);
  return candidates[0] ?? {
    title: generic.noIssueTitle,
    impact: 0,
    rationale: generic.noIssueRationale,
    suggestion: generic.noIssueSuggestion,
  };
}

interface GroundIncompleteStage {
  key: string;
  title: string;
  missing: string;
  suggestion: string;
  done: { type: 'customerAcceptedInvitation' | 'traineeSaid'; all?: string[]; also?: string[] };
}

interface GroundIncompleteData {
  childFailure: { completionReasonContains: string; title: string; suggestion: string };
  stages: GroundIncompleteStage[];
  fallback: { title: string; missing: string; suggestion: string };
  afterCardGuidance?: {
    title: string;
    titleChildDone: string;
    rationale: string;
    rationaleChildDone: string;
    activitySuggestion: string;
    childSuggestion: string;
  };
  stageAssessmentPrompt?: string;
  sellChildDoneSuggestion?: string;
  rationaleTemplate: string;
  acceptCard: {
    textPattern: string;
    negativePattern: string;
    positivePattern: string;
    declinedNegativePattern: string;
    retreatPattern: string;
    noAcceptEvidence: string;
    declinedEvidence: string;
    retreatEvidence: string;
  };
}

export function buildGroundPushIncompleteGoal(session: Session, rules?: SuggestionRule[], category: '地推' | '电销' = '地推'): ImprovementCandidate {
  const data = suggestionData<GroundIncompleteData>(rules, SUGGESTION_KEYS.groundPushIncomplete, category);
  if (session.completionReason?.includes(data.childFailure.completionReasonContains)) {
    return {
      title: data.childFailure.title,
      impact: Number.MAX_SAFE_INTEGER,
      rationale: session.completionReason,
      suggestion: data.childFailure.suggestion,
    };
  }

  const traineeTurns = session.transcript.filter((turn) => turn.speaker === 'trainee');
  const traineeText = traineeTurns.map((turn) => turn.text).join('\n');
  const accept = data.acceptCard;
  const customerAcceptedInvitation = session.transcript.some((turn) => {
    if (turn.speaker !== 'persona' || !new RegExp(accept.textPattern).test(turn.text)) return false;
    if (new RegExp(accept.negativePattern).test(turn.text)) return false;
    return new RegExp(accept.positivePattern).test(turn.text);
  });
  const traineeSaid = (pattern: RegExp, also?: RegExp) =>
    pattern.test(traineeText) && (!also || also.test(traineeText));
  const isStageDone = (stage: GroundIncompleteStage): boolean => {
    if (stage.done.type === 'customerAcceptedInvitation') return customerAcceptedInvitation;
    return traineeSaid(new RegExp(stage.done.all?.[0] ?? ''), stage.done.also?.[0] ? new RegExp(stage.done.also[0]) : undefined);
  };
  const sellStage = data.stages.find((entry) => entry.key === 'sell');
  const afterCard = data.afterCardGuidance;
  if (afterCard && customerAcceptedInvitation && sellStage && !isStageDone(sellStage)) {
    const childCommunicated = hasChildCommunication(session);
    return {
      title: childCommunicated ? afterCard.titleChildDone : afterCard.title,
      impact: Number.MAX_SAFE_INTEGER,
      rationale: `客户已经接过介绍材料，递卡这一步已经完成。${childCommunicated ? afterCard.rationaleChildDone : afterCard.rationale}`,
      suggestion: [afterCard.activitySuggestion, childCommunicated ? '' : afterCard.childSuggestion].filter(Boolean).join('\n'),
    };
  }
  const stage = data.stages.find((entry) => !isStageDone(entry)) ?? data.fallback;
  const customerDeclinedCard = session.transcript.some((turn) =>
    turn.speaker === 'persona' && new RegExp(accept.textPattern).test(turn.text) && new RegExp(accept.declinedNegativePattern).test(turn.text)
  );
  const retreatHandoff = traineeTurns.some((turn) => new RegExp(accept.retreatPattern).test(turn.text));
  const isFirstStage = data.stages.length > 0 && stage === data.stages[0];
  const acceptedEvidence = !isFirstStage && customerAcceptedInvitation
    ? '客户已经接过介绍材料，递卡这一步已经完成。'
    : '';
  const currentEvidence = isFirstStage
    ? [
        customerDeclinedCard ? accept.declinedEvidence : accept.noAcceptEvidence,
        retreatHandoff ? accept.retreatEvidence : '',
      ].filter(Boolean).join('；')
    : '';
  return {
    title: stage.title,
    impact: Number.MAX_SAFE_INTEGER,
    rationale: fillTemplate(data.rationaleTemplate, {
      evidence: `${acceptedEvidence}${currentEvidence ? `${currentEvidence}。` : ''}`,
      missing: stage.missing,
    }),
    suggestion: stage.suggestion,
  };
}


interface GroundStageAssessment {
  stage?: 'accept-card' | 'after-card-guidance' | 'sell' | 'contact' | 'payment' | 'schedule' | 'complete';
  childCommunicated?: boolean;
  reason?: string;
}

export async function buildGroundPushIncompleteGoalWithLLM(
  session: Session,
  gateway: LLMGateway,
  rules?: SuggestionRule[],
  category: '地推' | '电销' = '地推'
): Promise<ImprovementCandidate> {
  const data = suggestionData<GroundIncompleteData>(rules, SUGGESTION_KEYS.groundPushIncomplete, category);
  if (!data.stageAssessmentPrompt || session.completionReason?.includes(data.childFailure.completionReasonContains)) {
    return buildGroundPushIncompleteGoal(session, rules, category);
  }
  try {
    const transcript = session.transcript
      .slice(-40)
      .map((turn) => `[${turn.seq}] ${turn.speaker === 'trainee' ? '销售' : turn.speaker === 'persona' ? '客户' : turn.speaker === 'child' ? '孩子' : '旁白'}：${turn.text}`)
      .join('\n');
    const result = await gateway.forTask('judge').chat([
      { role: 'system', content: `${data.stageAssessmentPrompt}\n只输出JSON：{"stage":"accept-card|after-card-guidance|sell|contact|payment|schedule|complete","childCommunicated":true或false,"reason":"当前阶段的通俗说明"}` },
      { role: 'user', content: `完整对话：\n${transcript}` },
    ], { jsonMode: true, temperature: 0, maxTokens: 1000 });
    const match = result.content.match(/\{[\s\S]*\}/);
    if (!match) return buildGroundPushIncompleteGoal(session, rules, category);
    const assessment = JSON.parse(match[0]) as GroundStageAssessment;
    const childCommunicated = assessment.childCommunicated === true || hasChildCommunication(session);
    const reason = assessment.reason?.trim();

    if (assessment.stage === 'accept-card') return buildGroundPushIncompleteGoal(session, rules, category);
    if (assessment.stage === 'after-card-guidance' && data.afterCardGuidance) {
      const afterCard = data.afterCardGuidance;
      return {
        title: childCommunicated ? afterCard.titleChildDone : afterCard.title,
        impact: Number.MAX_SAFE_INTEGER,
        rationale: reason ?? `客户已经接过介绍材料，递卡这一步已经完成。${childCommunicated ? afterCard.rationaleChildDone : afterCard.rationale}`,
        suggestion: [afterCard.activitySuggestion, childCommunicated ? '' : afterCard.childSuggestion].filter(Boolean).join('\n'),
      };
    }
    if (assessment.stage === 'complete') {
      return {
        title: data.fallback.title,
        impact: Number.MAX_SAFE_INTEGER,
        rationale: reason ?? data.fallback.missing,
        suggestion: data.fallback.suggestion,
      };
    }
    const stage = data.stages.find((entry) => entry.key === assessment.stage);
    if (!stage) return buildGroundPushIncompleteGoal(session, rules, category);
    return {
      title: stage.title,
      impact: Number.MAX_SAFE_INTEGER,
      rationale: reason ?? fillTemplate(data.rationaleTemplate, { evidence: '', missing: stage.missing }),
      suggestion: assessment.stage === 'sell' && childCommunicated
        ? data.sellChildDoneSuggestion ?? stage.suggestion
        : stage.suggestion,
    };
  } catch {
    return buildGroundPushIncompleteGoal(session, rules, category);
  }
}
