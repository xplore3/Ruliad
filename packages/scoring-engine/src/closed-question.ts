import type { LLMGateway, Session, TranscriptTurn } from '@grasp-mvp/core';

export const CLOSED_ADVANCE_QUESTION_DEDUCTION = 5;

export interface ClosedAdvanceQuestionAnalysis {
  triggered: boolean;
  deduction: number;
  rationale: string;
  evidence: string[];
  quoteTurnSeq: number;
}

const QUESTION_PATTERN = /吗|？|\?|要不要|是否|可否|是不是|能不能|想不想|感兴趣|需要|了解|听听|介绍一下|好吗|行吗|可以吗/;
const INVITATION_TOPIC_PATTERN = /试听|体验课|活动|邀请函/;
const OPEN_QUESTION_PATTERN = /什么时候|何时|哪天|周几|星期|几点|什么时间|哪个时间|哪个时段|哪里|哪儿|多少|为什么|怎么|如何|哪些|什么/;

function candidateTurns(session: Session): TranscriptTurn[] {
  return session.transcript.filter((turn) => {
    if (turn.speaker !== 'trainee') return false;
    if (!QUESTION_PATTERN.test(turn.text)) return false;
    if (INVITATION_TOPIC_PATTERN.test(turn.text)) return false;
    if (OPEN_QUESTION_PATTERN.test(turn.text)) return false;
    return true;
  });
}

function noDeduction(rationale: string): ClosedAdvanceQuestionAnalysis {
  return { triggered: false, deduction: 0, rationale, evidence: [], quoteTurnSeq: 0 };
}

export async function analyzeClosedAdvanceQuestions(
  session: Session,
  gateway: LLMGateway
): Promise<ClosedAdvanceQuestionAnalysis> {
  const candidates = candidateTurns(session);
  if (candidates.length === 0) return noDeduction('未发现非邀约场景的封闭式推进提问。');
  const transcript = session.transcript
    .map((turn) => `[${turn.seq}] ${turn.speaker === 'trainee' ? '学员' : turn.speaker === 'persona' ? '客户' : '其他'}：${turn.text}`)
    .join('\n');
  try {
    const result = await gateway.forTask('judge').chat([
      {
        role: 'user',
        content: [
          '你是销售话术审核员。请进行封闭式推进提问语义复核，不要仅凭关键词判定。',
          '本规则只评价「非邀约场景」的封闭式推进提问。邀约客户参加试听、体验课、活动或邀请函的封闭式问题已由其他规则处理，本规则不再重复扣分。',
          '封闭式推进提问：学员为了推进对话或销售流程，向客户提出答案不确定为肯定的问题，让客户决定是否继续了解、倾听或配合。例如“你是不是要了解一下”“你要不要听我介绍一下”“您需要吗”“您感兴趣吗”“我可以给您介绍一下吗”“你想不想知道”。',
          '不扣分的情况：1）开放式问题，如“您最关心哪方面”“您什么时候方便”“您想了解什么”；2）答案已确定为肯定的问题，如客户已明确表达需求后，学员确认“那我给您详细介绍一下，好吗”；3）单纯陈述信息，没有提问；4）邀约类封闭式问题（由其他规则扣分）。',
          `候选轮次：${candidates.map((turn) => turn.seq).join('、')}。只判断这些轮次，其他轮次不得新增扣分。`,
          '完整对话：',
          transcript,
          '只输出JSON：{"triggered":true或false,"quoteTurnSeq":候选轮次中的数字,"reason":"一句话说明语义依据"}',
        ].join('\n'),
      },
    ], { jsonMode: true, temperature: 0, maxTokens: 500 });
    const raw = result.content.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? result.content;
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'))) as { triggered?: boolean; quoteTurnSeq?: unknown; reason?: unknown };
    const reason = String(parsed.reason ?? '');
    if (!parsed.triggered) return noDeduction(`语义复核未发现非邀约封闭式推进提问${reason ? `：${reason}` : '，不扣分。'}`);
    const quoteTurnSeq = Number(parsed.quoteTurnSeq);
    const turn = candidates.find((candidate) => candidate.seq === quoteTurnSeq) ?? candidates[0];
    const evidence = [`第${turn.seq}轮使用封闭式推进提问“${turn.text}”`];
    return {
      triggered: true,
      deduction: CLOSED_ADVANCE_QUESTION_DEDUCTION,
      rationale: `${evidence[0]}。${reason || '该句是在答案不确定时让客户决定是否继续了解或倾听'}，全局扣5分。`,
      evidence,
      quoteTurnSeq: turn.seq,
    };
  } catch {
    return noDeduction('封闭式推进提问检测未完成，本项未扣分。');
  }
}
