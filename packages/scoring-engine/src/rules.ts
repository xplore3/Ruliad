import type { RuleViolation, ScoreReport, Session } from '@grasp-mvp/core';

/** 合规红线词（一票否决） */
const REDLINE_PATTERN = /保证收益|一定赔|肯定赚|稳赚|保本/;
/** 口头禅/填充词 */
const FILLER_WORDS = ['其实', '那个', '就是说', '然后', '嗯'];
/** 口头禅总次数阈值 */
const FILLER_TOTAL_THRESHOLD = 10;

function countOccurrences(text: string, word: string): number {
  let count = 0;
  let idx = text.indexOf(word);
  while (idx !== -1) {
    count++;
    idx = text.indexOf(word, idx + word.length);
  }
  return count;
}

/**
 * 确定性规则层：红线 / 口头禅 / 打断启发式 / 话题覆盖。
 * 不依赖 LLM，结果可复现。
 */
export function runRuleChecks(
  session: Session,
  coverageTopics: string[]
): { violations: RuleViolation[]; stats: ScoreReport['ruleStats'] } {
  const violations: RuleViolation[] = [];
  const traineeTurns = session.transcript.filter((t) => t.speaker === 'trainee');

  // ---- 红线 ----
  for (const turn of traineeTurns) {
    if (REDLINE_PATTERN.test(turn.text)) {
      violations.push({
        ruleId: 'redline-promise',
        kind: 'redline',
        detail: `学员话术命中合规红线：${turn.text.slice(0, 50)}`,
        turnSeq: turn.seq,
        fatal: true,
      });
    }
  }

  // ---- 口头禅 ----
  const traineeAll = traineeTurns.map((t) => t.text).join('\n');
  const fillerCounts: Record<string, number> = {};
  let fillerTotal = 0;
  for (const word of FILLER_WORDS) {
    const n = countOccurrences(traineeAll, word);
    if (n > 0) {
      fillerCounts[word] = n;
      fillerTotal += n;
    }
  }
  if (fillerTotal > FILLER_TOTAL_THRESHOLD) {
    violations.push({
      ruleId: 'filler-heavy',
      kind: 'filler',
      detail: `口头禅总次数 ${fillerTotal} 次，超过阈值 ${FILLER_TOTAL_THRESHOLD}`,
      fatal: false,
    });
  }

  // ---- 打断启发式：学员轮紧接 persona 长文本轮且学员发言很短 ----
  let interruptions = 0;
  for (let i = 1; i < session.transcript.length; i++) {
    const prev = session.transcript[i - 1];
    const curr = session.transcript[i];
    if (
      curr.speaker === 'trainee' &&
      prev.speaker === 'persona' &&
      prev.text.length > 40 &&
      curr.text.length < 8
    ) {
      interruptions++;
    }
  }

  // ---- 话题覆盖 ----
  const coverageHits: string[] = [];
  const coverageMisses: string[] = [];
  for (const topic of coverageTopics) {
    if (traineeAll.includes(topic)) {
      coverageHits.push(topic);
    } else {
      coverageMisses.push(topic);
    }
  }
  if (coverageMisses.length > 0) {
    violations.push({
      ruleId: 'coverage-miss',
      kind: 'coverage',
      detail: `未覆盖话题：${coverageMisses.join('、')}`,
      fatal: false,
    });
  }

  return {
    violations,
    stats: { interruptions, fillerCounts, coverageHits, coverageMisses },
  };
}
