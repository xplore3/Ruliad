import { isReceptionTrialDeclined, RECEPTION_TRIAL_SCHEDULE_QUESTION, type LLMGateway, type LLMProvider, type ProductKB, type ScoreItemDef, type ScoreItemResult, type Session } from '@grasp-mvp/core';

interface Evaluation {
  score: number;
  rationale: string;
  improvement: string;
}

const RECEPTION_QUESTION_COUNT = 10;
const EVALUATION_MAX_TOKENS = 16000;

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

async function requestEvaluations(provider: LLMProvider, requestPrompt: string): Promise<Evaluation[]> {
  const options = { jsonMode: true, maxTokens: EVALUATION_MAX_TOKENS };
  const first = await provider.chat([{ role: 'user', content: requestPrompt }], options);
  const firstEvaluations = parseEvaluations(first.content);
  if (firstEvaluations.length === RECEPTION_QUESTION_COUNT) return firstEvaluations;

  const retry = await provider.chat(
    [{
      role: 'user',
      content: [
        requestPrompt,
        '上一次输出未能解析为完整的10项 evaluations，可能被截断。请重新评分，每项 rationale 和 improvement 各不超过80个汉字。rationale 中不同语义点请用换行符分隔。禁止输出推理过程、Markdown或任何额外文字，只输出完整JSON。',
      ].join('\n'),
    }],
    options
  );
  return parseEvaluations(retry.content);
}

function prompt(def: ScoreItemDef, session: Session, institutionKB?: ProductKB): string {
  const transcript = session.transcript
    .map((turn) => `[${turn.seq}] ${turn.speaker === 'trainee' ? '学员' : turn.speaker === 'persona' ? '客户' : '其他'}：${turn.text}`)
    .join('\n');
  const questions = session.receptionQuestions ?? [];
  const institutionFacts = institutionKB?.entries.length
    ? institutionKB.entries.map((entry) => `- ${entry.title}：${entry.content}`).join('\n')
    : '机构尚未提供定制资料；只依据本题的详解和回答要领评分，不自行编造机构事实。';
  const trialDeclinedRules = isReceptionTrialDeclined(session)
    ? [
        '本场特殊规则（优先于题目参考标准）：家长在“不用试听直接报名”题后仍坚持不试听。',
        '“什么时候可以试听呀”题由系统标记为不适用且不计入平均分，你仍需在 evaluations 对应位置保留一项。',
        '“学费怎么收啊”和“报名价格能不能优惠点”仍评价实际收费或优惠回答，但未提及试听当天报名优惠不得扣分，也不得作为失分点或改进建议。',
        '不得因学员未确定试听时间、未推进试听或未传达试听当天报名优惠而扣任何题分。',
      ]
    : [];
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
    ...trialDeclinedRules,
    '评分纪律：',
    '1. 每题满分100分，只评价该题对应的学员回答；未作答或答非所问给0分。答案不必与参考回答逐字一致，能够满足该题详解中的客户动机、评分标准和关键事实即可。',
    '2. 严格按每题给出的分值和特殊扣分规则评分，不把其他题目的要求混入本题。涉及机构事实时以定制资料库为准，不得凭常识编造。',
    '3. rationale 必须说明该题回答符合或不符合详解评分标准的具体证据；improvement 必须针对失分点给出具体、可执行的改进建议，并参考详解回答要领指出应补充或纠正的内容，不能写空泛的“注意沟通技巧”。',
    '4. 双评审只负责逐题评价，最终总分由系统按适用题目的算术平均计算，不要自行给总分。',
    '5. 每项 rationale 和 improvement 各不超过120个汉字，禁止输出推理过程、Markdown或任何额外文字。',
    '只输出JSON：{"evaluations":[{"score":0到100的整数,"rationale":"第1题评语（不同语义点用\\n换行分隔）","improvement":"第1题具体改进建议"}]}。evaluations必须严格按题目顺序包含10项。',
  ].join('\n');
}

export async function judgeReceptionAnswers(
  def: ScoreItemDef,
  session: Session,
  gateway: LLMGateway,
  institutionKB?: ProductKB
): Promise<ScoreItemResult> {
  const requestPrompt = prompt(def, session, institutionKB);
  const [primary, secondary] = await Promise.all([
    requestEvaluations(gateway.forTask('judge'), requestPrompt),
    requestEvaluations(gateway.forTask('judge_secondary'), requestPrompt),
  ]);
  const fallback = { score: 50, rationale: '双评审输出缺失或解析失败，本题回退50分', improvement: '请重新评审本题。' };
  const trialDeclined = isReceptionTrialDeclined(session);
  const evaluations = session.receptionQuestions!.map((question, index) => {
    if (trialDeclined && question.question === RECEPTION_TRIAL_SCHEDULE_QUESTION) {
      return {
        question: question.question,
        score: 100,
        rationale: '本场家长坚持不试听，确定试听时间不适用，本题不计分。',
        improvement: '',
        agree: true,
        excluded: true,
      };
    }
    const p = primary[index];
    const s = secondary[index];
    if (p && s) {
      const agree = Math.abs(p.score - s.score) <= 10;
      return {
        question: question.question,
        score: agree ? Math.round((p.score + s.score) / 2) : p.score,
        rationale: agree ? p.rationale : `${p.rationale}（双评审不一致，另一评审给${s.score}分，取主评审结果）`,
        improvement: p.improvement,
        agree,
        excluded: false,
      };
    }
    const only = p ?? s;
    if (only) {
      return {
        question: question.question,
        score: only.score,
        rationale: `${only.rationale}（${p ? '副' : '主'}评审输出无效，采用${p ? '主' : '副'}评审结果）`,
        improvement: only.improvement,
        agree: false,
        excluded: false,
      };
    }
    return { question: question.question, ...fallback, agree: false, excluded: false };
  });
  const scoredEvaluations = evaluations.filter((item) => !item.excluded);
  const score = scoredEvaluations.reduce((sum, item) => sum + item.score, 0) / scoredEvaluations.length;
  return {
    itemId: def.id,
    itemName: def.name,
    skillPointId: def.skillPointId,
    levelKey: 'score',
    levelLabel: `${scoredEvaluations.length}题平均分`,
    score,
    quote: '',
    quoteTurnSeq: 0,
    rationale: evaluations.map((item, index) => item.excluded
      ? `第${index + 1}题《${item.question}》：不适用，不计分。${item.rationale}`
      : `第${index + 1}题《${item.question}》：${item.score}/100。${item.rationale} 改进建议：${item.improvement}`
    ).join('\n'),
    betterScript: evaluations.flatMap((item, index) => item.excluded ? [] : [`第${index + 1}题：${item.improvement}`]).join('\n'),
    confidence: evaluations.every((item) => item.agree) ? 0.95 : 0.5,
    judgeAgree: evaluations.every((item) => item.agree),
    isReference: evaluations.some((item) => !item.agree),
    isObservation: def.isObservation,
    isDeduction: def.deductionOnly,
    layer: def.layer,
    improvementCandidates: evaluations.flatMap((item, index) => item.excluded ? [] : [{
      title: `对答得当：第${index + 1}题`,
      impact: (100 - item.score) * def.weight / scoredEvaluations.length,
      rationale: `第${index + 1}题《${item.question}》：${item.rationale}`,
      suggestion: item.improvement || `针对第${index + 1}题重新组织回答，做到准确、简洁、完整。`,
      quoteTurnSeq: 0,
    }]),
  };
}
