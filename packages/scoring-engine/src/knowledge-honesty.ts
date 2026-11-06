import type { LLMGateway, ProductKB, Session } from '@grasp-mvp/core';

export const RECEPTION_KNOWLEDGE_HONESTY_DEDUCTION = 40;

export interface KnowledgeContradiction {
  turnSeq: number;
  question: string;
  claim: string;
  expected: string;
  reason: string;
}

export interface ReceptionKnowledgeHonestyAnalysis {
  triggered: boolean;
  deduction: number;
  contradictionCount: number;
  contradictions: KnowledgeContradiction[];
  rationale: string;
  evidence: string[];
  quoteTurnSeq: number;
}

function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : content;
  const start = raw.indexOf('{');
  return start >= 0 ? raw.slice(start) : raw;
}

function emptyAnalysis(): ReceptionKnowledgeHonestyAnalysis {
  return {
    triggered: false,
    deduction: 0,
    contradictionCount: 0,
    contradictions: [],
    rationale: '机构资料未覆盖或没有明确事实冲突，本项不扣分。',
    evidence: [],
    quoteTurnSeq: 0,
  };
}

export async function analyzeReceptionKnowledgeHonesty(
  session: Session,
  gateway: LLMGateway,
  institutionKB?: ProductKB
): Promise<ReceptionKnowledgeHonestyAnalysis> {
  if (!institutionKB?.entries.length) return emptyAnalysis();
  const facts = institutionKB.entries.map((entry) => `- ${entry.title}：${entry.content}`).join('\n');
  const transcript = session.transcript.map((turn) =>
    `[${turn.seq}] ${turn.speaker === 'trainee' ? '学员' : turn.speaker === 'persona' ? '客户' : '其他'}：${turn.text}`
  ).join('\n');
  try {
    const result = await gateway.forTask('judge').chat([
      {
        role: 'user',
        content: [
          '【机构资料事实核对】只检查学员回答是否与机构初始化资料存在明确事实冲突，不评价其他销售表现。',
          '计数规则：同一学员轮次只计一次，即使该轮有多个冲突；资料没有覆盖的问题不得猜测或判定冲突；措辞不同但意思一致不算冲突；记错价格、课频、排班、师资、退费、分班等明确事实才算冲突；坦诚表示“我是新来的，这个问题不清楚，我马上了解清楚再回复您”不属于冲突。',
          '只输出JSON：{"contradictions":[{"turnSeq":学员轮次数字,"question":"对应的客户问题","claim":"学员错误说法","expected":"资料中的正确事实","reason":"明确冲突点"}]}。没有明确冲突则输出空数组，禁止虚构。',
          '机构初始化资料：',
          facts,
          '完整对话：',
          transcript,
        ].join('\n'),
      },
    ], { jsonMode: true, maxTokens: 4000 });
    const parsed = JSON.parse(extractJson(result.content)) as { contradictions?: unknown };
    if (!Array.isArray(parsed.contradictions)) return emptyAnalysis();
    const traineeSeqs = new Set(session.transcript.filter((turn) => turn.speaker === 'trainee').map((turn) => turn.seq));
    const byTurn = new Map<number, KnowledgeContradiction>();
    for (const item of parsed.contradictions) {
      const contradiction = item as Partial<KnowledgeContradiction>;
      const turnSeq = Number(contradiction.turnSeq);
      if (!Number.isInteger(turnSeq) || !traineeSeqs.has(turnSeq) || byTurn.has(turnSeq)) continue;
      if (!contradiction.claim || !contradiction.expected || !contradiction.reason) continue;
      byTurn.set(turnSeq, {
        turnSeq,
        question: String(contradiction.question ?? ''),
        claim: String(contradiction.claim),
        expected: String(contradiction.expected),
        reason: String(contradiction.reason),
      });
    }
    const contradictions = [...byTurn.values()].sort((a, b) => a.turnSeq - b.turnSeq);
    const contradictionCount = contradictions.length;
    const triggered = contradictionCount > 2;
    const evidence = contradictions.map((item) =>
      `第${item.turnSeq}轮“${item.claim}”与资料“${item.expected}”冲突（${item.reason}）`
    );
    return {
      triggered,
      deduction: triggered ? RECEPTION_KNOWLEDGE_HONESTY_DEDUCTION : 0,
      contradictionCount,
      contradictions,
      rationale: triggered
        ? `${evidence.join('；')}。明确资料冲突共${contradictionCount}处，已超过2次，不能再按记错或口误理解，属于信口胡说，全局扣40分。不确定时应回答“我是新来的，对您问的问题确实不清楚，我马上了解清楚再回复您”。`
        : `明确资料冲突共${contradictionCount}处，未超过2次，按咨询师记错或口误处理，本项不扣分。`,
      evidence,
      quoteTurnSeq: contradictions[0]?.turnSeq ?? 0,
    };
  } catch {
    return emptyAnalysis();
  }
}
