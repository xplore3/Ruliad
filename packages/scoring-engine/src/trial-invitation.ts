import type { LLMGateway, Session, TranscriptTurn } from '@grasp-mvp/core';

export const RECEPTION_TRIAL_INVITATION_DEDUCTION = 5;

export interface ReceptionTrialInvitationAnalysis {
  triggered: boolean;
  deduction: number;
  rationale: string;
  evidence: string[];
  quoteTurnSeq: number;
}

const OPEN_TIME_PATTERN = /什么时候|何时|哪天|周几|星期|几点|什么时间|哪个时间|哪个时段|周六|周日|周末|周[一二三四五六日天]/;
const QUESTION_PATTERN = /吗|？|\?|要不要|是否|可否|怎么样|如何/;
const INVITATION_TOPIC_PATTERN = /试听|体验课|活动|邀请函/;
const INVITATION_INTENT_PATTERN = /想|希望|愿意|需要|要不要|是否|可否|考虑|参加|参与|安排|过来|来|去|怎么样|如何|好吗|行吗|可以吗/;
const SUGGESTION_INVITATION_PATTERN = /建议.{0,16}(试听|体验课|活动)|可以.{0,16}(参加|参与|来|去|过来).{0,8}(试听|体验课|活动)|可以带孩子参加/;

function candidateTurns(session: Session): TranscriptTurn[] {
  return session.transcript.filter((turn) => {
    if (turn.speaker !== 'trainee' || !INVITATION_TOPIC_PATTERN.test(turn.text)) return false;
    if (OPEN_TIME_PATTERN.test(turn.text)) return false;
    return SUGGESTION_INVITATION_PATTERN.test(turn.text) ||
      (QUESTION_PATTERN.test(turn.text) && INVITATION_INTENT_PATTERN.test(turn.text));
  });
}

function noDeduction(rationale: string): ReceptionTrialInvitationAnalysis {
  return { triggered: false, deduction: 0, rationale, evidence: [], quoteTurnSeq: 0 };
}

export async function analyzeReceptionTrialInvitation(
  session: Session,
  gateway: LLMGateway
): Promise<ReceptionTrialInvitationAnalysis> {
  const candidates = candidateTurns(session);
  if (candidates.length === 0) return noDeduction('未发现封闭式试听或活动邀约，直接给出时间选择或安排不扣分。');
  const transcript = session.transcript
    .map((turn) => `[${turn.seq}] ${turn.speaker === 'trainee' ? '学员' : turn.speaker === 'persona' ? '客户' : '其他'}：${turn.text}`)
    .join('\n');
  try {
    const result = await gateway.forTask('judge').chat([
      {
        role: 'user',
        content: [
          '你是销售话术审核员。请进行封闭式邀约语义复核，不要仅凭关键词判定。',
          '封闭式邀约包括两类：1）疑问式，让客户决定是否参加，例如“要不要试听”“您想让孩子试听吗”“我们有个活动，您想参加吗”“可以带孩子来参加活动吗”；2）建议式，以建议、邀请或引导的方式让客户考虑是否参加，但没有直接推进到具体时间，例如“建议您来试听”“您可以带孩子参加活动”。邀约目标包括试听、体验课、活动和邀请函，两类都扣5分。',
          '直接给出时间选择或安排的不扣分，例如“什么时候方便”“周六还是周日方便”“周六上午十点我来安排”。单纯介绍“机构有免费试听课或活动”且没有邀约客户参加的信息陈述不扣分。',
          '“再决定要不要报名”本身说的是报名，但如果整句是在建议或邀请客户参加试听或活动，应按建议式邀约扣分，不能因出现“报名”而豁免。必须根据整句话的语义和邀约目的判断。',
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
    if (!parsed.triggered) return noDeduction(`语义复核未发现封闭式试听或活动邀约${reason ? `：${reason}` : '，不扣分。'}`);
    const quoteTurnSeq = Number(parsed.quoteTurnSeq);
    const turn = candidates.find((candidate) => candidate.seq === quoteTurnSeq) ?? candidates[0];
    const evidence = [`第${turn.seq}轮使用封闭式邀约“${turn.text}”`];
    return {
      triggered: true,
      deduction: RECEPTION_TRIAL_INVITATION_DEDUCTION,
      rationale: `${evidence[0]}。${reason || '该句是在让客户决定是否参加试听或活动'}，全局扣5分。`,
      evidence,
      quoteTurnSeq: turn.seq,
    };
  } catch {
    return noDeduction('试听或活动邀约检测未完成，本项未扣分。');
  }
}
