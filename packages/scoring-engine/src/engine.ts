import type {
  LLMGateway,
  ProductKB,
  Scenario,
  ScoreItemDef,
  ScoreItemResult,
  ScoreReport,
  Session,
  SkillScore,
  QuizScore,
  SuggestionRule,
  VoiceBaseline,
} from '@grasp-mvp/core';
import { isReceptionTrialDeclined } from '@grasp-mvp/core';
import { judgeItem } from './judge.js';
import { runRuleChecks } from './rules.js';
import { generateSummary } from './summary.js';
import { judgeVideo } from './video-judge.js';
import { buildGroundPushIncompleteGoal, buildImprovementGoal } from './improvement.js';
import { applyConfidenceIndex } from './confidence.js';

function weightedAverage(items: Array<{ score: number; weight: number }>): number {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  if (totalWeight === 0) {
    return 0;
  }
  return items.reduce((sum, i) => sum + i.score * i.weight, 0) / totalWeight;
}

async function mapWithConcurrency<T, R>(values: T[], limit: number, fn: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await fn(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

export interface ScoreOptions {
  /** 对练录像关键帧（base64 data URL）；提供时附带视频表现评审（失败自动跳过） */
  videoFrames?: string[];
  /** 评分过程诊断日志（各阶段耗时与逐项结果）；与 Fastify logger 结构兼容 */
  log?: ScoreLogger;
  /** 技能点 id → 名称映射（用于报告中的 skillPointName）；缺省回退为 id */
  skillPointNames?: Record<string, string>;
  /** 新手指引流程配置的重点评分维度（第5步）；有值时 judge prompt 追加从严要求，缺省行为不变 */
  scoringFocus?: string[];
  /** 学员个人语音基线（平静音高/响度）：提供后 ruleStats.voice 附带 f0LiftSemitones/loudnessLiftDb */
  voiceBaseline?: VoiceBaseline;
  /** 机构定制资料库：咨询接待10题评分时核对机构事实 */
  institutionKB?: ProductKB;
  /** 客户 TTS 语速倍率：语速在普通适中区间或该倍率对应的客户匹配区间，任一满足即得分 */
  customerRateMultiplier?: number;
  /** 改进建议库：点评/改进建议文案与阶段逻辑的唯一来源；缺省用内置默认规则（与迁移前一致） */
  suggestionRules?: SuggestionRule[];
}

/** 评分过程日志器最小接口 */
export interface ScoreLogger {
  info(obj: object, msg?: string): void;
}

/**
 * 评分主流程：规则层 + 双 judge 评分标准 + 汇总报告。
 * 评分标准选取：优先使用场景显式绑定的 scoreItemIds；存量数据未绑定时，
 * 有 category 则评该分类及通用标准，无 category 则按 skillPointIds 过滤。观察项进 items 但不计分。
 * options.videoFrames 存在时附带视频表现评审（videoReview，独立维度不计总分）。
 */
export async function scoreSession(
  session: Session,
  scenario: Scenario,
  defs: ScoreItemDef[],
  gateway: LLMGateway,
  options: ScoreOptions = {}
): Promise<ScoreReport> {
  const { violations: ruleViolations, stats } = runRuleChecks(session, scenario.coverageTopics ?? [], options.voiceBaseline);
  // 分类场景（评分库驱动）：默认评分类库全部标准；拒听场排除不适用的试听时间项。
  // 规则层只产出统计指标（供 judge 判定语声语调类标准），不产出库外违规项；无分类的存量场景保持完整规则层
  const violations = scenario.category ? [] : ruleViolations;

  const trialDeclined = isReceptionTrialDeclined(session);
  const relevantDefs = (scenario.scoreItemIds !== undefined
    ? defs.filter((d) => scenario.scoreItemIds!.includes(d.id))
    : scenario.category
      ? defs.filter((d) => !d.category || d.category === scenario.category)
      : defs.filter((d) => scenario.skillPointIds.includes(d.skillPointId))
  ).filter((d) => !(trialDeclined && d.name === '主动性确定试听时间'));

  const startedAt = Date.now();
  const log = options.log;
  log?.info(
    {
      sessionId: session.id,
      scenarioId: scenario.id,
      transcriptTurns: session.transcript.length,
      scoreItems: relevantDefs.length,
    },
    '评分开始'
  );

  const items = await mapWithConcurrency(relevantDefs, 3, async (def, i) => {
    const itemStart = Date.now();
    const item = await judgeItem(def, session, gateway, scenario, options.scoringFocus, stats, options.institutionKB, options.customerRateMultiplier, options.suggestionRules);
    log?.info(
      {
        sessionId: session.id,
        progress: `${i + 1}/${relevantDefs.length}`,
        itemName: def.name,
        levelKey: item.levelKey,
        levelLabel: item.levelLabel,
        judgeAgree: item.judgeAgree,
        ms: Date.now() - itemStart,
      },
      '评分标准完成'
    );
    return item;
  });

  const weightOf = new Map(relevantDefs.map((d) => [d.id, d.weight]));
  const deductionIds = new Set(relevantDefs.filter((d) => d.deductionOnly).map((d) => d.id));
  const scored = items.filter((i) => !i.isObservation && !deductionIds.has(i.itemId));

  // 技能点维度：组内加权平均，满分 100；信心指数调整项不进入基础分
  const bySkill = new Map<string, ScoreItemResult[]>();
  for (const item of scored) {
    const list = bySkill.get(item.skillPointId) ?? [];
    list.push(item);
    bySkill.set(item.skillPointId, list);
  }
  const skillScores: SkillScore[] = [...bySkill.entries()].map(([skillPointId, group]) => ({
    skillPointId,
    skillPointName: options.skillPointNames?.[skillPointId] ?? skillPointId,
    score: Math.round(
      weightedAverage(group.map((i) => ({ score: i.score, weight: weightOf.get(i.itemId) ?? 1 })))
    ),
    maxScore: 100,
  }));

  const { baseScore, confidenceIndex, totalScore: scoredTotal } = applyConfidenceIndex(
    Math.round(weightedAverage(scored.map((i) => ({ score: i.score, weight: weightOf.get(i.itemId) ?? 1 })))),
    items
  );
  const incomplete = session.completionStatus === 'incomplete';
  const totalScore = incomplete ? 0 : scoredTotal;

  const fatalViolation = violations.some((v) => v.fatal);
  const passed = !incomplete && totalScore >= scenario.successCriteria.passScore && !fatalViolation;

  // 视频表现评审：有录像关键帧且配置视觉模型时产出；失败返回 null 不影响主评分
  let videoReview: Awaited<ReturnType<typeof judgeVideo>>;
  if (options.videoFrames?.length) {
    const videoStart = Date.now();
    videoReview = await judgeVideo(session, scenario, options.videoFrames, gateway);
    log?.info(
      {
        sessionId: session.id,
        frames: options.videoFrames.length,
        // null = 未配置视觉模型或调用/解析失败（自动跳过）
        skipped: videoReview == null,
        ms: Date.now() - videoStart,
      },
      '视频评审完成'
    );
  } else {
    videoReview = null;
  }

  // ---- 考题维度 ----
  const quizResults = session.quizResults ?? [];
  const quizScore: QuizScore | undefined = quizResults.length > 0
    ? {
        earned: quizResults.reduce((sum, r) => sum + r.score, 0),
        // total 取各题满分之和；旧数据无 maxScore 快照时回退用得分（答对时得分即满分）
        total: quizResults.reduce((sum, r) => sum + (r.maxScore ?? r.score), 0),
        results: quizResults.map((r) => ({ quizId: r.quizId, correct: r.correct, score: r.score })),
      }
    : undefined;

  const improvementGoal = incomplete
    ? buildGroundPushIncompleteGoal(session, options.suggestionRules)
    : buildImprovementGoal(items, relevantDefs, violations, baseScore, options.suggestionRules);

  // ---- 教练总结：LLM 优先生成，失败回退模板，保证报告始终带 summary ----
  const fillerTotal = Object.values(stats.fillerCounts).reduce((sum, n) => sum + n, 0);
  const summary = incomplete
    ? `本场演练未完成。${improvementGoal.rationale}\n改进建议：${improvementGoal.suggestion}`
    : await generateSummary(session, scenario, gateway, {
        totalScore,
        passed,
        fatalViolation,
        items,
        defs: relevantDefs,
        fillerTotal,
        improvementGoal,
      }, options.suggestionRules);

  log?.info(
    {
      sessionId: session.id,
      totalScore,
      passed,
      fatalViolation,
      items: items.length,
      ms: Date.now() - startedAt,
    },
    '评分完成'
  );

  return {
    id: crypto.randomUUID(),
    sessionId: session.id,
    totalScore,
    baseScore,
    confidenceIndex,
    passed,
    completionStatus: incomplete ? 'incomplete' : 'completed',
    completionReason: session.completionReason,
    fatalViolation,
    skillScores,
    items,
    violations,
    ruleStats: stats,
    videoReview: videoReview ?? undefined,
    quizScore,
    summary,
    improvementGoal,
    createdAt: new Date().toISOString(),
  };
}
