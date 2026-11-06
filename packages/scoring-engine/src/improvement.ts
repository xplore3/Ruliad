import type { ImprovementCandidate, RuleViolation, ScoreItemDef, ScoreItemResult } from '@grasp-mvp/core';

function firstLine(text: string | undefined): string {
  return text?.split('\n').find((line) => line.trim())?.trim() ?? '';
}

function legacyReceptionCandidates(item: ScoreItemResult, def?: ScoreItemDef): ImprovementCandidate[] {
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
      suggestion: suggestion || `针对第${entry.index}题《${entry.question}》重新组织回答。`,
      quoteTurnSeq: item.quoteTurnSeq,
    }];
  });
}

export function buildImprovementGoal(
  items: ScoreItemResult[],
  defs: ScoreItemDef[],
  violations: RuleViolation[],
  baseScore?: number
): ImprovementCandidate {
  const fatal = violations.find((violation) => violation.fatal);
  if (fatal) {
    return {
      title: '避免合规红线话术',
      impact: Number.MAX_SAFE_INTEGER,
      rationale: fatal.detail,
      suggestion: '删除任何保证提分、包过或绝对化效果承诺，改为如实介绍课程特点和适用情况。',
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
          suggestion: firstLine(item.betterScript) || `针对「${item.itemName}」进行专项练习，避免再次触发同类扣分。`,
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
    const legacyCandidates = legacyReceptionCandidates(item, defById.get(item.itemId));
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
      suggestion: firstLine(item.betterScript) || `针对「${item.itemName}」进行专项练习，再完成一次同类场景演练。`,
      quoteTurnSeq: item.quoteTurnSeq,
    });
  }
  candidates.sort((a, b) => b.impact - a.impact);
  return candidates[0] ?? {
    title: '保持当前表现',
    impact: 0,
    rationale: '本次未发现需要优先改进的问题。',
    suggestion: '继续保持当前沟通方式，并尝试更高难度的练习场景。',
  };
}
