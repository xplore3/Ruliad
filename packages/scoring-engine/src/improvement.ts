import type { ImprovementCandidate, RuleViolation, ScoreItemDef, ScoreItemResult, Session, SuggestionRule } from '@grasp-mvp/core';
import { fillTemplate, suggestionData, SUGGESTION_KEYS } from './suggestion-rules.js';

function firstLine(text: string | undefined): string {
  return text?.split('\n').find((line) => line.trim())?.trim() ?? '';
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

export function buildGroundPushIncompleteGoal(session: Session, rules?: SuggestionRule[]): ImprovementCandidate {
  const data = suggestionData<GroundIncompleteData>(rules, SUGGESTION_KEYS.groundPushIncomplete, '地推');
  if (session.completionReason?.includes(data.childFailure.completionReasonContains)) {
    return {
      title: data.childFailure.title,
      impact: Number.MAX_SAFE_INTEGER,
      rationale: session.completionReason,
      suggestion: data.childFailure.suggestion,
    };
  }

  const traineeTurns = session.transcript.filter((turn) => turn.speaker === 'trainee');
  const accept = data.acceptCard;
  const customerAcceptedInvitation = session.transcript.some((turn) => {
    if (turn.speaker !== 'persona' || !new RegExp(accept.textPattern).test(turn.text)) return false;
    if (new RegExp(accept.negativePattern).test(turn.text)) return false;
    return new RegExp(accept.positivePattern).test(turn.text);
  });
  const traineeSaid = (pattern: RegExp, also?: RegExp) =>
    traineeTurns.some((turn) => pattern.test(turn.text) && (!also || also.test(turn.text)));
  const isStageDone = (stage: GroundIncompleteStage): boolean => {
    if (stage.done.type === 'customerAcceptedInvitation') return customerAcceptedInvitation;
    return traineeSaid(new RegExp(stage.done.all?.[0] ?? ''), stage.done.also?.[0] ? new RegExp(stage.done.also[0]) : undefined);
  };
  const stage = data.stages.find((entry) => !isStageDone(entry)) ?? data.fallback;
  const customerDeclinedCard = session.transcript.some((turn) =>
    turn.speaker === 'persona' && new RegExp(accept.textPattern).test(turn.text) && new RegExp(accept.declinedNegativePattern).test(turn.text)
  );
  const retreatHandoff = traineeTurns.some((turn) => new RegExp(accept.retreatPattern).test(turn.text));
  const isFirstStage = data.stages.length > 0 && stage === data.stages[0];
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
      evidence: currentEvidence ? `${currentEvidence}。` : '',
      missing: stage.missing,
    }),
    suggestion: stage.suggestion,
  };
}
