import type {
  LLMGateway,
  LLMProvider,
  Scenario,
  ScoreItemDef,
  ScoreItemResult,
  ScoreReport,
  Session,
} from '@grasp-mvp/core';

interface JudgeParsed {
  levelKey: string;
  /** 直接打分模式的分数（0-100）；档位模式不用 */
  score?: number;
  quote: string;
  quoteTurnSeq: number;
  rationale: string;
  betterScript: string;
}

/** 语音表现统计段落：语速/停顿/口头禅等确定性分析，供语声语调类评分标准判定（LLM 无法从文字转写感知这些维度） */
function buildStatsLines(stats: ScoreReport['ruleStats']): string[] {
  const fillers =
    Object.entries(stats.fillerCounts)
      .map(([w, n]) => `${w}×${n}`)
      .join('、') || '无';
  return [
    '语音表现统计（来自本场录音的确定性分析，判定语速/语调/流畅度类标准时必须以此为依据，不要仅凭对话文字猜测）：',
    `- 对话整体节奏：约 ${stats.avgSpeechRate} 字/分钟（含停顿与倾听时间的整体速率；流畅对练通常 150-250，数值越低节奏越拖沓）`,
    `- 明显停顿（学员应答前静默超过 3 秒）：${stats.pauseCount} 次`,
    `- 口头禅/填充词：${fillers}`,
    `- 学员发言占比：${Math.round(stats.talkRatio * 100)}%`,
    `- 打断客户次数（启发式估算）：${stats.interruptions} 次`,
  ];
}

/** 组装 judge prompt：评分标准定义 + 档位 JSON + 场景考核点 + 语音表现统计 + 带 seq 的转写（+ 可选的重点评分维度） */
function buildJudgePrompt(
  def: ScoreItemDef,
  session: Session,
  scenario?: Scenario,
  scoringFocus?: string[],
  stats?: ScoreReport['ruleStats']
): string {
  const transcriptLines = session.transcript
    .filter((t) => t.speaker !== 'coach')
    .map((t) => `[${t.seq}] ${t.speaker === 'trainee' ? '学员' : '客户'}：${t.text}`)
    .join('\n');
  const scenarioLines: string[] = [];
  if (scenario) {
    scenarioLines.push(`练习场景：${scenario.name}`);
    if (scenario.script?.purpose) scenarioLines.push(`剧本目的：${scenario.script.purpose}`);
    if (scenario.script?.assessmentPoints?.length) {
      scenarioLines.push(`本场主要考核点：${scenario.script.assessmentPoints.join('；')}`);
    }
  }
  return [
    def.judgePrompt,
    `评分标准：${def.name}`,
    `行为锚定：${def.behaviorAnchor}`,
    ...scenarioLines,
    ...(def.scoringMode === 'score' ? [] : [`可选档位（JSON）：${JSON.stringify(def.levels)}`]),
    ...(stats ? buildStatsLines(stats) : []),
    '对话记录：',
    transcriptLines,
    def.scoringMode === 'score'
      ? '请只输出 JSON：{"score":0到100的整数总分,"dimensions":"各维度得分明细（如 激情40/60 语速15/20 音量12/20）","quote":"引用原文","quoteTurnSeq":数字,"rationale":"判定理由","betterScript":"更优话术示范"}'
      : '请只输出 JSON：{"levelKey":"档位key","quote":"引用原文","quoteTurnSeq":数字,"rationale":"判定理由","betterScript":"更优话术示范"}',
    'betterScript 要求：针对该评分标准的扣分点，给一句学员当时可以直接说的中文话术示范，不超过 60 字；若判定为最高档（无扣分）则给空字符串。',
    ...(scoringFocus?.length
      ? [`本次演练重点评分维度：${scoringFocus.join('、')}。打分时对这些维度从严、并明确指出该维度表现。`]
      : []),
  ].join('\n');
}

/** 解析 judge 输出；失败或 levelKey 非法时回退中间档；直接打分模式解析 0-100 分数，失败回退 50 分 */
function parseJudgeOutput(content: string, def: ScoreItemDef): JudgeParsed {
  if (def.scoringMode === 'score') {
    try {
      const parsed = JSON.parse(content) as {
        score?: unknown;
        dimensions?: unknown;
        quote?: unknown;
        quoteTurnSeq?: unknown;
        rationale?: unknown;
        betterScript?: unknown;
      };
      const score = Math.round(Number(parsed.score));
      if (!Number.isFinite(score)) throw new Error('非法 score');
      const dimensions = typeof parsed.dimensions === 'string' && parsed.dimensions.trim() ? `（${parsed.dimensions.trim()}）` : '';
      return {
        levelKey: 'score',
        score: Math.max(0, Math.min(100, score)),
        quote: String(parsed.quote ?? ''),
        quoteTurnSeq: Number(parsed.quoteTurnSeq ?? 0),
        rationale: `${String(parsed.rationale ?? '')}${dimensions}`,
        betterScript: String(parsed.betterScript ?? ''),
      };
    } catch {
      return { levelKey: 'score', score: 50, quote: '', quoteTurnSeq: 0, rationale: 'judge 输出解析失败，回退中间分 50', betterScript: '' };
    }
  }
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
    const mid = def.levels[Math.floor(def.levels.length / 2)] ?? { key: 'unknown', label: '未知', score: 0 };
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
 * 双 judge 判定单个评分标准：
 * 主 judge 与 judge_secondary 独立判定；levelKey 一致则高置信，
 * 不一致取主 judge 结果并标记 isReference（复盘中标注"参考"）。
 */
export async function judgeItem(
  def: ScoreItemDef,
  session: Session,
  gateway: LLMGateway,
  scenario?: Scenario,
  scoringFocus?: string[],
  stats?: ScoreReport['ruleStats']
): Promise<ScoreItemResult> {
  const prompt = buildJudgePrompt(def, session, scenario, scoringFocus, stats);
  const primary = await runJudge(gateway.forTask('judge'), prompt, def);
  const secondary = await runJudge(gateway.forTask('judge_secondary'), prompt, def);

  // 直接打分模式：双 judge 分差 ≤10 视为一致（取均值），否则取主 judge 并标记"参考"
  if (def.scoringMode === 'score') {
    const p = primary.score ?? 0;
    const s = secondary.score ?? 0;
    const agree = Math.abs(p - s) <= 10;
    return {
      itemId: def.id,
      itemName: def.name,
      skillPointId: def.skillPointId,
      levelKey: 'score',
      levelLabel: '得分',
      score: agree ? Math.round((p + s) / 2) : p,
      quote: primary.quote,
      quoteTurnSeq: primary.quoteTurnSeq,
      rationale: agree
        ? primary.rationale
        : `${primary.rationale}（双 judge 不一致：次 judge 判 ${s} 分，取主 judge 结果）`,
      betterScript: primary.betterScript || undefined,
      confidence: agree ? 0.95 : 0.5,
      judgeAgree: agree,
      isReference: !agree,
      isObservation: def.isObservation,
      layer: def.layer,
    };
  }

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
