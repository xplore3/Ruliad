import type { Session } from '@grasp-mvp/core';

export const RECEPTION_REPETITION_DEDUCTION = 10;
const REPEAT_THRESHOLD = 2;
const REPEATED_GROUPS_THRESHOLD = 3;
const MEANINGLESS_THRESHOLD = 12;
const SIMILARITY_THRESHOLD = 0.78;
const MEANINGLESS_CLAUSE_PATTERN = /^(?:嗯+|啊+|呃+|额+|这个|那个|就是|然后|其实)[\s，。！？；、]*$/;

export interface RepeatedIdea {
  text: string;
  count: number;
  turnSeqs: number[];
  occurrences: { text: string; turnSeq: number }[];
}

export interface ReceptionRepetitionAnalysis {
  triggered: boolean;
  deduction: number;
  rationale: string;
  evidence: string[];
  affectedTurns: number;
  quoteTurnSeq: number;
  groups: RepeatedIdea[];
  meaninglessCount: number;
}

interface Clause {
  text: string;
  normalized: string;
  seq: number;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/小朋友/g, '孩子')
    .replace(/试听课|体验课/g, '试听')
    .replace(/了解一下/g, '了解')
    .replace(/[与及]/g, '和')
    .replace(/就是说|嗯|啊|呃|额|这个|那个|就是|然后|其实|我们|的/g, '')
    .replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '');
}

function shingles(text: string): Set<string> {
  if (text.length < 2) return new Set([text]);
  const result = new Set<string>();
  for (let index = 0; index < text.length - 1; index++) result.add(text.slice(index, index + 2));
  return result;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (lengthRatio < 0.6) return 0;
  const aParts = shingles(a);
  const bParts = shingles(b);
  let shared = 0;
  for (const part of aParts) if (bParts.has(part)) shared++;
  return shared * 2 / (aParts.size + bParts.size);
}

function repeatedIdeas(clauses: Clause[]): RepeatedIdea[] {
  const parents = clauses.map((_, index) => index);
  const find = (index: number): number => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  for (let left = 0; left < clauses.length; left++) {
    for (let right = left + 1; right < clauses.length; right++) {
      if (similarity(clauses[left].normalized, clauses[right].normalized) >= SIMILARITY_THRESHOLD) {
        parents[find(right)] = find(left);
      }
    }
  }
  const groups = new Map<number, Clause[]>();
  clauses.forEach((clause, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), clause]);
  });
  const repeated = [...groups.values()]
    .filter((group) => group.length >= REPEAT_THRESHOLD)
    .map((group) => ({
      text: group[0].text,
      count: group.length,
      turnSeqs: [...new Set(group.map((clause) => clause.seq))].sort((a, b) => a - b),
      occurrences: group.map((clause) => ({ text: clause.text, turnSeq: clause.seq })),
    }))
    .sort((a, b) => b.count - a.count);
  const byTurns = new Map<string, RepeatedIdea>();
  for (const group of repeated) {
    const key = group.turnSeqs.join(',');
    const existing = byTurns.get(key);
    if (!existing || group.text.length > existing.text.length) byTurns.set(key, group);
  }
  return [...byTurns.values()];
}

export function analyzeReceptionRepetition(session: Session): ReceptionRepetitionAnalysis {
  const traineeTurns = session.transcript.filter((turn) => turn.speaker === 'trainee');
  const clauses = traineeTurns
    .flatMap((turn) => turn.text
      .split(/[。！？!?；;，,\n]+/)
      .map((text) => ({ text: text.trim(), normalized: normalize(text), seq: turn.seq }))
      .filter((clause) => clause.text && clause.normalized.length >= 6)
    );
  const meaninglessClauses = traineeTurns.flatMap((turn) => turn.text
    .split(/[。！？!?；;，,\n]+/)
    .map((text) => text.trim())
    .filter((text) => MEANINGLESS_CLAUSE_PATTERN.test(text))
    .map((text) => ({ text, seq: turn.seq }))
  );
  const meaningless = meaninglessClauses.map((clause) => clause.seq);
  const groups = repeatedIdeas(clauses);
  const repeatedTriggered = groups.length >= REPEATED_GROUPS_THRESHOLD;
  const meaninglessTriggered = meaningless.length >= MEANINGLESS_THRESHOLD && new Set(meaningless).size >= 2;
  const triggered = repeatedTriggered || meaninglessTriggered;
  const affectedTurns = new Set([
    ...(repeatedTriggered ? groups.flatMap((group) => group.turnSeqs) : []),
    ...(meaninglessTriggered ? meaningless : []),
  ]).size;
  const evidence = repeatedTriggered
    ? groups.map((group, index) => `重复${index + 1}：${group.occurrences.map((occurrence) => `第${occurrence.turnSeq}轮“${occurrence.text}”`).join('；')}（同一意思共${group.count}次）`)
    : [];
  if (meaninglessTriggered) {
    const byTurn = new Map<number, string[]>();
    for (const clause of meaninglessClauses) byTurn.set(clause.seq, [...(byTurn.get(clause.seq) ?? []), clause.text]);
    const details = [...byTurn.entries()]
      .map(([seq, texts]) => `第${seq}轮${texts.map((text) => `“${text}”`).join('、')}`)
      .join('；');
    evidence.push(`无实际信息的语气或填充表达共${meaningless.length}次：${details}`);
  }
  const rationale = triggered
    ? `${evidence.join('；')}。重复表达的情况出现3次及以上（例如A说两遍、B说两遍、C说两遍），或无实际意义表达过多，商务沟通不够简洁，全局扣10分。`
    : '未发现3组及以上重复表达（例如A说两遍、B说两遍、C说两遍），或过多没有实际意义的表达，简洁沟通项不扣分。';
  return {
    triggered,
    deduction: triggered ? RECEPTION_REPETITION_DEDUCTION : 0,
    rationale,
    evidence,
    affectedTurns,
    quoteTurnSeq: repeatedTriggered ? groups[0]?.turnSeqs[0] ?? 0 : meaningless[0] ?? 0,
    groups,
    meaninglessCount: meaningless.length,
  };
}
