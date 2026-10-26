import type {
  LLMGateway,
  LLMProvider,
  ScoreItemDef,
  ScoreItemResult,
  Session,
} from '@grasp-mvp/core';

interface JudgeParsed {
  levelKey: string;
  quote: string;
  quoteTurnSeq: number;
  rationale: string;
  betterScript: string;
}

/** 组装 judge prompt：评分项定义 + 档位 JSON + 带 seq 的转写 */
function buildJudgePrompt(def: ScoreItemDef, session: Session): string {
  const transcriptLines = session.transcript
    .filter((t) => t.speaker !== 'coach')
    .map((t) => `[${t.seq}] ${t.speaker === 'trainee' ? '学员' : '客户'}：${t.text}`)
    .join('\n');
  return [
    def.judgePrompt,
    `评分项：${def.name}`,
    `行为锚定：${def.behaviorAnchor}`,
    `可选档位（JSON）：${JSON.stringify(def.levels)}`,
    '对话记录：',
    transcriptLines,
    '请只输出 JSON：{"levelKey":"档位key","quote":"引用原文","quoteTurnSeq":数字,"rationale":"判定理由","betterScript":"更优话术示范"}',
    'betterScript 要求：针对该评分项的扣分点，给一句学员当时可以直接说的中文话术示范，不超过 60 字；若判定为最高档（无扣分）则给空字符串。',
  ].join('\n');
}

/** 解析 judge 输出；失败或 levelKey 非法时回退中间档 */
function parseJudgeOutput(content: string, def: ScoreItemDef): JudgeParsed {
  try {
    const parsed = JSON.parse(content) as Partial<JudgeParsed>;
    const level = def.levels.find((l) => l.key === parsed.levelKey);
    if (!level) {
      throw new Error(`非法 levelKey: ${String(parsed.levelKey)}`);
    }
    return {
      levelKey: level.key,
      quote: String(parsed.quote ?? ''),
      quoteTurnSeq: Number(parsed.quoteTurnSeq ?? 0),
      rationale: String(parsed.rationale ?? ''),
      betterScript: String(parsed.betterScript ?? ''),
    };
  } catch {
    const mid = def.levels[Math.floor(def.levels.length / 2)];
    return {
      levelKey: mid.key,
      quote: '',
      quoteTurnSeq: 0,
      rationale: `judge 输出解析失败，回退中间档 ${mid.key}`,
      betterScript: '',
    };
  }
}

async function runJudge(
  provider: LLMProvider,
  prompt: string,
  def: ScoreItemDef
): Promise<JudgeParsed> {
  const result = await provider.chat([{ role: 'user', content: prompt }], { jsonMode: true });
  return parseJudgeOutput(result.content, def);
}

/**
 * 双 judge 判定单个评分项：
 * 主 judge 与 judge_secondary 独立判定；levelKey 一致则高置信，
 * 不一致取主 judge 结果并标记 isReference（复盘中标注"参考"）。
 */
export async function judgeItem(
  def: ScoreItemDef,
  session: Session,
  gateway: LLMGateway
): Promise<ScoreItemResult> {
  const prompt = buildJudgePrompt(def, session);
  const primary = await runJudge(gateway.forTask('judge'), prompt, def);
  const secondary = await runJudge(gateway.forTask('judge_secondary'), prompt, def);

  const agree = primary.levelKey === secondary.levelKey;
  const chosen = primary;
  const level = def.levels.find((l) => l.key === chosen.levelKey) ?? def.levels[0];

  return {
    itemId: def.id,
    itemName: def.name,
    skillPointId: def.skillPointId,
    levelKey: level.key,
    levelLabel: level.label,
    score: level.score,
    quote: chosen.quote,
    quoteTurnSeq: chosen.quoteTurnSeq,
    rationale: agree
      ? chosen.rationale
      : `${chosen.rationale}（双 judge 不一致：次 judge 判 ${secondary.levelKey}，取主 judge 结果）`,
    betterScript: chosen.betterScript || undefined,
    confidence: agree ? 0.95 : 0.5,
    judgeAgree: agree,
    isReference: !agree,
    isObservation: def.isObservation,
    layer: def.layer,
  };
}
