import type { ImprovementCandidate, RuleViolation, ScoreItemDef, ScoreItemResult, Session } from '@grasp-mvp/core';

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

export function buildGroundPushIncompleteGoal(session: Session): ImprovementCandidate {
  if (session.completionReason?.includes('卖邀请函失败')) {
    return {
      title: '改进与孩子沟通的策略',
      impact: Number.MAX_SAFE_INTEGER,
      rationale: session.completionReason,
      suggestion: '先给孩子情感支持，再讲一个能逗孩子开心的故事或做有趣游戏，最后才问孩子是否喜欢；不要用无铺垫的封闭式问题逼孩子表态。',
    };
  }

  const traineeTurns = session.transcript.filter((turn) => turn.speaker === 'trainee');
  const customerAcceptedInvitation = session.transcript.some((turn) => {
    if (turn.speaker !== 'persona' || !/邀请函|邀请卡|体验卡/.test(turn.text)) return false;
    if (/没接|没有接|不接|未接|没拿|没有拿|不收/.test(turn.text)) return false;
    return /接过|拿到|收下|拿了/.test(turn.text);
  });
  const traineeSaid = (pattern: RegExp, also?: RegExp) =>
    traineeTurns.some((turn) => pattern.test(turn.text) && (!also || also.test(turn.text)));
  const stages = [
    {
      done: customerAcceptedInvitation,
      title: '先让家长拿上邀请函',
      missing: '让家长现场实际接过邀请函；只展示邀请卡、让家长回去看或回去考虑都不算完成接卡',
      suggestion: '先只练递卡这一步：将邀请函递给家长并明确说：“来，您拿上邀请函，我给您介绍一下活动。”',
    },
    {
      done: traineeSaid(/邀请函|邀请卡|体验卡/, /买|卖|订|定|购|付款|支付|五元|5元|五块/),
      title: '明确现场销售邀请函',
      missing: '在家长接卡后明确提出现场购买邀请函',
      suggestion: '直接说：“这张邀请函5元，您现在给孩子订一张。”',
    },
    {
      done: traineeSaid(/填|登记|留/, /姓名|名字|电话|联系方式/),
      title: '引导填写姓名和电话',
      missing: '明确引导家长填写姓名和电话',
      suggestion: '直接说：“来，您在这里填一下姓名和电话。”',
    },
    {
      done: traineeSaid(/微信|支付宝|现金|支付|付款/),
      title: '引导选择支付方式',
      missing: '明确引导家长选择支付方式并完成付款',
      suggestion: '直接问：“您是微信还是支付宝？现在完成付款。”',
    },
    {
      done: traineeSaid(/约|安排|确定/, /时间|试听|体验|到校|周[一二三四五六日天]/),
      title: '约定到校体验时间',
      missing: '明确与家长约定到校体验时间',
      suggestion: '直接问：“您周六上午方便吗？我们现在把孩子到校体验的时间定下来。”',
    },
  ];
  const stage = stages.find((entry) => !entry.done) ?? {
    title: '完成当场成交动作',
    missing: '把已有介绍转化为明确的当场成交行动',
    suggestion: '明确请家长现在确认参加，不再让客户回去考虑。',
  };
  const customerDeclinedCard = session.transcript.some((turn) =>
    turn.speaker === 'persona' && /邀请函|邀请卡|体验卡/.test(turn.text) && /没接|没有接|不接|未接|没拿|没有拿/.test(turn.text)
  );
  const retreatHandoff = traineeTurns.some((turn) => /拿[上着]?.*回去|回去.*(?:考虑|琢磨)/.test(turn.text));
  const currentEvidence = stage === stages[0]
    ? [
        customerDeclinedCard ? '客户看过邀请卡但没有实际接过' : '对话中没有客户实际接过邀请函的记录',
        retreatHandoff ? '“拿上回去琢磨一下”是让客户离开，不算完成现场递卡' : '',
      ].filter(Boolean).join('；')
    : '';
  return {
    title: stage.title,
    impact: Number.MAX_SAFE_INTEGER,
    rationale: `${currentEvidence}${currentEvidence ? '。' : ''}地推客户通常比较被动，销售没有给出明确的下一步动作，客户往往就会直接离开。当前最早缺失的是${stage.missing}，本次只改进这一步。`,
    suggestion: stage.suggestion,
  };
}
