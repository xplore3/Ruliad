import type { ImprovementCandidate, LLMGateway, Scenario, ScoreItemDef, ScoreItemResult, Session } from '@grasp-mvp/core';

export interface SummaryInput {
  totalScore: number;
  passed: boolean;
  fatalViolation: boolean;
  items: ScoreItemResult[];
  /** 本场评分标准库原文（行为锚定/档位定义），总结只允许依据这些内容点评 */
  defs?: ScoreItemDef[];
  fillerTotal: number;
  improvementGoal?: ImprovementCandidate;
}

/** 模板回退总结：不依赖 LLM，任何环境下都能给出有信息量的教练点评 */
export function buildFallbackSummary(scenario: Scenario, input: SummaryInput): string {
  const lines: string[] = [];
  lines.push(
    `本次练习总分 ${input.totalScore} 分，${input.passed ? '已通过' : '未通过'}（及格线 ${scenario.successCriteria.passScore} 分）。`
  );
  const scored = input.items.filter((i) => !i.isObservation && !i.isDeduction);
  if (scored.length > 0) {
    const best = [...scored].sort((a, b) => b.score - a.score)[0];
    if (best.score >= 60) lines.push(`表现较好：${best.itemName}（${best.score} 分），继续保持。`);
  }
  if (input.improvementGoal) {
    lines.push(`最需要改进：${input.improvementGoal.title}——${input.improvementGoal.rationale}`);
    lines.push(`具体建议：${input.improvementGoal.suggestion}`);
  } else {
    if (input.fatalViolation) lines.push('注意：本次话术命中合规红线，一票否决，务必避免任何效果承诺类表述。');
    const worst = [...scored].sort((a, b) => a.score - b.score)[0];
    if (worst?.score < 60) {
      const reason = worst.rationale ? `——${worst.rationale}` : '';
      lines.push(`最需要改进：${worst.itemName}（${worst.score} 分）${reason}`);
      lines.push(`建议：针对「${worst.itemName}」参照报告中的更优话术做专项练习，再练一次巩固。`);
    } else {
      lines.push('建议：保持当前节奏，尝试在更高难度场景中巩固发挥。');
    }
  }
  return lines.join('\n');
}

function buildSummaryPrompt(scenario: Scenario, input: SummaryInput): string {
  // 喂评分标准库原文（名称+行为锚定+档位）与得分，但不喂 judge 自由文本理由——
  // LLM 拿库里的标准做点评依据，库外概念（如"共情"）没有渗入路径
  const defById = new Map((input.defs ?? []).map((d) => [d.id, d]));
  const itemLines = input.items
    .map((i) => {
      const def = defById.get(i.itemId);
      const anchorLines: string[] = [];
      if (def?.behaviorAnchor) anchorLines.push(`  行为锚定：${def.behaviorAnchor}`);
      if (def?.levels?.length) {
        anchorLines.push(
          `  档位定义：${def.levels.map((l) => `${l.label}（${l.score}分）${l.description ? `：${l.description}` : ''}`).join('；')}`
        );
      }
      return [def?.deductionOnly ? `- ${i.itemName}：信心指数扣减参数 ${i.score}` : `- ${i.itemName}：${i.score} 分（${i.levelLabel ?? i.levelKey}）`, ...anchorLines].join('\n');
    })
    .join('\n');
  return [
    '你是一位销售培训教练，请根据本场对练评分结果，给学员写一段总结点评。',
    `练习场景：${scenario.name}`,
    `总分：${input.totalScore} 分，${input.passed ? '已通过' : '未通过'}（及格线 ${scenario.successCriteria.passScore} 分）`,
    input.fatalViolation ? '本场命中合规红线（一票否决）。' : '',
    '各评分标准（来自评分标准库，是本场全部评分依据，除此之外不存在其他评分维度）：',
    itemLines || '（无评分标准）',
    input.improvementGoal ? `本场唯一需要强调的问题：${input.improvementGoal.title}。依据：${input.improvementGoal.rationale}。具体建议：${input.improvementGoal.suggestion}` : '',
    '要求：教练口吻，先总体评价，再指出一个最值得保持的亮点；随后只指出上方指定的这一项问题，并给出这一条具体建议；150字以内。',
    '只改进一个问题：不得罗列其他扣分项、薄弱维度、口头禅或其他错误，不得给出第二项改进目标或第二条练习建议。',
    '铁律：只允许依据上面列出的评分标准（名称、行为锚定、档位定义）及其得分进行点评和建议，禁止提及标准原文未涵盖的任何维度、技巧或概念（例如共情、倾听、提问等，除非标准原文里明确写了）；亮点、改进点、练习建议都必须能对应到上面某一条标准。',
    '请只输出 JSON：{"summary":"总结文案"}',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 生成教练总结：优先 LLM（judge 通道），输出缺失或解析失败时回退模板文案。
 * 永不抛错，保证报告始终带 summary。
 */
export async function generateSummary(
  session: Session,
  scenario: Scenario,
  gateway: LLMGateway,
  input: SummaryInput
): Promise<string> {
  try {
    const result = await gateway
      .forTask('judge')
      .chat([{ role: 'user', content: buildSummaryPrompt(scenario, input) }], { jsonMode: true });
    const parsed = JSON.parse(result.content) as { summary?: unknown };
    if (typeof parsed.summary === 'string' && parsed.summary.trim().length > 0) {
      return parsed.summary.trim();
    }
  } catch {
    // 落入模板回退
  }
  return buildFallbackSummary(scenario, input);
}
