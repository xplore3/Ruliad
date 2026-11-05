import type { LLMGateway, ProductKB, ScoreItemDef, ScoreItemResult, Session } from '@grasp-mvp/core';

interface Evaluation {
  score: number;
  rationale: string;
  improvement: string;
}

function parseEvaluations(content: string): Evaluation[] {
  try {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1] : content;
    const start = raw.indexOf('{');
    const parsed = JSON.parse(start >= 0 ? raw.slice(start) : raw) as { evaluations?: unknown };
    if (!Array.isArray(parsed.evaluations)) throw new Error('缺少 evaluations');
    return parsed.evaluations.map((item) => {
      const evaluation = item as { score?: unknown; rationale?: unknown; improvement?: unknown };
      const score = Math.round(Number(evaluation.score));
      if (!Number.isFinite(score)) throw new Error('非法题目分数');
      return {
        score: Math.max(0, Math.min(100, score)),
        rationale: String(evaluation.rationale ?? ''),
        improvement: String(evaluation.improvement ?? ''),
      };
    });
  } catch {
    return [];
  }
}

function prompt(def: ScoreItemDef, session: Session, institutionKB?: ProductKB): string {
  const transcript = session.transcript
    .map((turn) => `[${turn.seq}] ${turn.speaker === 'trainee' ? '学员' : turn.speaker === 'persona' ? '客户' : '其他'}：${turn.text}`)
    .join('\n');
  const questions = session.receptionQuestions ?? [];
  const institutionFacts = institutionKB?.entries.length
    ? institutionKB.entries.map((entry) => `- ${entry.title}：${entry.content}`).join('\n')
    : '机构尚未提供定制资料；只依据本题的详解和回答要领评分，不自行编造机构事实。';
  return [
    '请评价咨询接待演练的“对答得当”。以下是本场固定抽取的10道题，必须逐题评分，不能合并、漏评或更换题目。',
    ...questions.flatMap((item, index) => [
      `第${index + 1}题：${item.question}`,
      `详解参考回答：${item.referenceAnswer}`,
      `详解评分标准：${item.scoringGuide ?? def.behaviorAnchor}`,
    ]),
    '培训机构定制资料库（涉及课频、收费、排班、师资、退费、分班等机构事实时必须核对）：',
    institutionFacts,
    '完整对话记录：',
    transcript,
    def.judgePrompt,
    '评分纪律：',
    '1. 每题满分100分，只评价该题对应的学员回答；未作答或答非所问给0分。答案不必与参考回答逐字一致，能够满足该题详解中的客户动机、评分标准和关键事实即可。',
    '2. 严格按每题给出的分值和特殊扣分规则评分，不把其他题目的要求混入本题。涉及机构事实时以定制资料库为准，不得凭常识编造。',
    '3. rationale 必须说明该题回答符合或不符合详解评分标准的具体证据；improvement 必须针对失分点给出具体、可执行的改进建议，并参考详解回答要领指出应补充或纠正的内容，不能写空泛的“注意沟通技巧”。',
    '4. 双评审只负责逐题评价，最终总分由系统按10题算术平均计算，不要自行给总分。',
    '只输出JSON：{"evaluations":[{"score":0到100的整数,"rationale":"第1题评语","improvement":"第1题具体改进建议"}]}。evaluations必须严格按题目顺序包含10项。',
  ].join('\n');
}

export async function judgeReceptionAnswers(
  def: ScoreItemDef,
  session: Session,
  gateway: LLMGateway,
  institutionKB?: ProductKB
): Promise<ScoreItemResult> {
  const requestPrompt = prompt(def, session, institutionKB);
  const [primaryResult, secondaryResult] = await Promise.all([
    gateway.forTask('judge').chat([{ role: 'user', content: requestPrompt }], { jsonMode: true, maxTokens: 8000 }),
    gateway.forTask('judge_secondary').chat([{ role: 'user', content: requestPrompt }], { jsonMode: true, maxTokens: 8000 }),
  ]);
  const primary = parseEvaluations(primaryResult.content);
  const secondary = parseEvaluations(secondaryResult.content);
  const fallback = { score: 50, rationale: '评审输出缺失或解析失败，本题回退50分', improvement: '请重新评审本题。' };
  const evaluations = session.receptionQuestions!.map((question, index) => {
    const p = primary[index] ?? fallback;
    const s = secondary[index] ?? fallback;
    const agree = Math.abs(p.score - s.score) <= 10;
    return {
      question: question.question,
      score: agree ? Math.round((p.score + s.score) / 2) : p.score,
      rationale: agree ? p.rationale : `${p.rationale}（双评审不一致，另一评审给${s.score}分，取主评审结果）`,
      improvement: p.improvement,
      agree,
    };
  });
  const score = evaluations.reduce((sum, item) => sum + item.score, 0) / evaluations.length;
  return {
    itemId: def.id,
    itemName: def.name,
    skillPointId: def.skillPointId,
    levelKey: 'score',
    levelLabel: '10题平均分',
    score,
    quote: '',
    quoteTurnSeq: 0,
    rationale: evaluations.map((item, index) =>
      `第${index + 1}题《${item.question}》：${item.score}/100。${item.rationale} 改进建议：${item.improvement}`
    ).join('\n'),
    betterScript: evaluations.map((item, index) => `第${index + 1}题：${item.improvement}`).join('\n'),
    confidence: evaluations.every((item) => item.agree) ? 0.95 : 0.5,
    judgeAgree: evaluations.every((item) => item.agree),
    isReference: evaluations.some((item) => !item.agree),
    isObservation: def.isObservation,
    isDeduction: def.deductionOnly,
    layer: def.layer,
  };
}
