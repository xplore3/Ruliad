import type {
  LLMGateway,
  Scenario,
  ScoreItemDef,
  ScoreItemResult,
  ScoreReport,
  Session,
  SkillScore,
  QuizScore,
} from '@grasp-mvp/core';
import { judgeItem } from './judge.js';
import { runRuleChecks } from './rules.js';
import { judgeVideo } from './video-judge.js';

function weightedAverage(items: Array<{ score: number; weight: number }>): number {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  if (totalWeight === 0) {
    return 0;
  }
  return items.reduce((sum, i) => sum + i.score * i.weight, 0) / totalWeight;
}

export interface ScoreOptions {
  /** 对练录像关键帧（base64 data URL）；提供时附带视频表现评审（失败自动跳过） */
  videoFrames?: string[];
  /** 评分过程诊断日志（各阶段耗时与逐项结果）；与 Fastify logger 结构兼容 */
  log?: ScoreLogger;
}

/** 评分过程日志器最小接口 */
export interface ScoreLogger {
  info(obj: object, msg?: string): void;
}

/**
 * 评分主流程：规则层 + 双 judge 评分项 + 汇总报告。
 * 只评 defs 中属于 scenario.skillPointIds 的项；观察项进 items 但不计分。
 * options.videoFrames 存在时附带视频表现评审（videoReview，独立维度不计总分）。
 */
export async function scoreSession(
  session: Session,
  scenario: Scenario,
  defs: ScoreItemDef[],
  gateway: LLMGateway,
  options: ScoreOptions = {}
): Promise<ScoreReport> {
  const { violations, stats } = runRuleChecks(session, scenario.coverageTopics ?? []);

  const relevantDefs = defs.filter((d) => scenario.skillPointIds.includes(d.skillPointId));

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

  const items: ScoreItemResult[] = [];
  for (const [i, def] of relevantDefs.entries()) {
    const itemStart = Date.now();
    const item = await judgeItem(def, session, gateway);
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
      '评分项完成'
    );
    items.push(item);
  }

  const weightOf = new Map(relevantDefs.map((d) => [d.id, d.weight]));
  const scored = items.filter((i) => !i.isObservation);

  // 技能点维度：组内加权平均，满分 100
  const bySkill = new Map<string, ScoreItemResult[]>();
  for (const item of scored) {
    const list = bySkill.get(item.skillPointId) ?? [];
    list.push(item);
    bySkill.set(item.skillPointId, list);
  }
  const skillScores: SkillScore[] = [...bySkill.entries()].map(([skillPointId, group]) => ({
    skillPointId,
    skillPointName: skillPointId,
    score: Math.round(
      weightedAverage(group.map((i) => ({ score: i.score, weight: weightOf.get(i.itemId) ?? 1 })))
    ),
    maxScore: 100,
  }));

  const totalScore = Math.round(
    weightedAverage(scored.map((i) => ({ score: i.score, weight: weightOf.get(i.itemId) ?? 1 })))
  );

  const fatalViolation = violations.some((v) => v.fatal);
  const passed = totalScore >= scenario.successCriteria.passScore && !fatalViolation;

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
        total: quizResults.reduce((sum, r) => sum + (r.score > 0 ? r.score : 0), 0),
        results: quizResults.map((r) => ({ quizId: r.quizId, correct: r.correct, score: r.score })),
      }
    : undefined;

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
    passed,
    fatalViolation,
    skillScores,
    items,
    violations,
    ruleStats: stats,
    videoReview: videoReview ?? undefined,
    quizScore,
    createdAt: new Date().toISOString(),
  };
}
