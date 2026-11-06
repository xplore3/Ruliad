import type { Session } from '@grasp-mvp/core';

export const RECEPTION_REPETITION_DEDUCTION = 10;
const REPEAT_THRESHOLD = 3;
const SIMILARITY_THRESHOLD = 0.78;

export interface RepeatedIdea {
  text: string;
  count: number;
  turnSeqs: number[];
}

export interface ReceptionRepetitionAnalysis {
  triggered: boolean;
  deduction: number;
  rationale: string;
  evidence: string[];
  affectedTurns: number;
  quoteTurnSeq: number;
  groups: RepeatedIdea[];
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
  return [...groups.values()]
    .filter((group) => group.length >= REPEAT_THRESHOLD)
    .map((group) => ({
      text: group[0].text,
      count: group.length,
      turnSeqs: [...new Set(group.map((clause) => clause.seq))].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.count - a.count);
}

export function analyzeReceptionRepetition(session: Session): ReceptionRepetitionAnalysis {
  const clauses = session.transcript
    .filter((turn) => turn.speaker === 'trainee')
    .flatMap((turn) => turn.text
      .split(/[。！？!?；;，,\n]+/)
      .map((text) => ({ text: text.trim(), normalized: normalize(text), seq: turn.seq }))
      .filter((clause) => clause.text && clause.normalized.length >= 6)
    );
  const groups = repeatedIdeas(clauses);
  const triggered = groups.length > 0;
  const affectedTurns = new Set(groups.flatMap((group) => group.turnSeqs)).size;
  const evidence = groups.map((group) =>
    `第${group.turnSeqs.join('、')}轮反复表达“${group.text}”共${group.count}次`
  );
  const rationale = triggered
    ? `${evidence.join('；')}。同一句话或同一意思反复出现已超出偶尔重复，商务沟通不够简洁，容易让客户厌烦，全局扣10分。`
    : '未发现同一句话或同一意思反复出现3次及以上，简洁沟通项不扣分。';
  return {
    triggered,
    deduction: triggered ? RECEPTION_REPETITION_DEDUCTION : 0,
    rationale,
    evidence,
    affectedTurns,
    quoteTurnSeq: groups[0]?.turnSeqs[0] ?? 0,
    groups,
  };
}
