import { EventTypes, type QuizQuestion, type QuizQuestionPublic, type Scenario, type ScenarioGuidance, type Session, type TranscriptTurn } from '@grasp-mvp/core';
import { bandFor, checkConsistency, compilePersona, EmotionTracker, PersonaActor } from '@grasp-mvp/role-engine';
import type { RouteContext } from '../ctx.js';
import { mkEvent } from '../events.js';
import { drillScriptPrompt, resolveDrillScript } from './drill.js';

/** 一致性校验重试仍失败时的兜底角色化文案 */
const CONSISTENCY_FALLBACK = '这个我不太清楚，你接着说。';
/** 重生成时追加的纠正指令 */
const CONSISTENCY_CORRECTION = '（注意：上一次回复出戏或泄露了不该说的信息，务必保持角色，不要暴露 AI 身份或考核相关信息。）';
/** 系统级开场白触发词：电话接通后自动播放问候，不存入 transcript */
const SYSTEM_GREETING_TOKEN = '__SYSTEM_GREETING__';
/** 学员轮数极端安全上限：防止对话无限进行（正常演练远低于此；结束时机由 AI 判断，不由倒计时决定） */
const MAX_LIVE_TURNS = 40;

export function remainingSeconds(session: Session, scenario: Scenario, overrideSeconds?: number): number {
  const totalSeconds = overrideSeconds ?? scenario.durationMinutes * 60;
  // 倒计时从进入正式对练（live）起算；开场/新手指引阶段不消耗时长
  if (!session.liveStartedAt) return totalSeconds;
  const nowMs = Date.now();
  const pausedMs =
    (session.pausedMs ?? 0) +
    (session.pausedAt ? nowMs - new Date(session.pausedAt).getTime() : 0);
  const elapsedMs = nowMs - new Date(session.liveStartedAt).getTime() - pausedMs;
  return Math.min(
    totalSeconds,
    Math.max(0, Math.round(totalSeconds - elapsedMs / 1000))
  );
}

/** 演练倒计时总秒数：guidance.duration.countdownSeconds 优先，其次 targetMinutes 换算，缺省用场景 durationMinutes */
export function countdownSecondsOf(scenario: Scenario, guidance?: ScenarioGuidance): number {
  const d = guidance?.duration;
  return d?.countdownSeconds ?? Math.round((d?.targetMinutes ?? scenario.durationMinutes) * 60);
}

/** 读新手指引流程配置并计算倒计时总秒数（无指引配置或读取失败时回退场景时长，行为与原来一致） */
export async function effectiveCountdownSeconds(
  store: RouteContext['store'],
  scenario: Scenario
): Promise<number> {
  const guidance = await store.getScenarioGuidance(scenario.id).catch(() => undefined);
  return countdownSecondsOf(scenario, guidance);
}

/** 加载 persona 运行时（编译后的 bundle + 原始配置 + 演练剧本），配置缺失返回 undefined */
export async function loadRuntime(ctx: RouteContext, scenario: Scenario, difficulty?: number) {
  const personaConfig = await ctx.store.getPersonaConfig(scenario.personaConfigId);
  if (!personaConfig) return undefined;
  const elements = await ctx.store.listElements({});

  // 加载产品知识库：场景级 productKBId 优先于陪练员级 productKBId
  const kbId = scenario.productKBId ?? personaConfig.productKBId;
  let productKB;
  if (kbId) {
    productKB = await ctx.store.getProductKBById(kbId);
  } else {
    // 兜底：取租户默认 KB
    productKB = await ctx.store.getProductKB(personaConfig.tenantId);
  }

  const bundle = compilePersona(personaConfig, elements, productKB, scenario);

  // 注入新手指引流程配置的第4步参数：难度系数说明（选定档位的客户行为要求）+ 演练真实度标准库
  const guidance = await ctx.store.getScenarioGuidance(scenario.id).catch(() => undefined);
  if (guidance) {
    const level =
      guidance.difficultyLevels.find((l) => l.level === (difficulty ?? guidance.defaultDifficulty)) ??
      guidance.difficultyLevels.find((l) => l.level === guidance.defaultDifficulty) ??
      guidance.difficultyLevels[0];
    const realism = (await ctx.store.listRealismStandards(guidance.tenantId).catch(() => [])).filter((s) =>
      guidance.realismStandardIds.includes(s.id)
    );
    const parts: string[] = [];
    if (level) {
      parts.push(`演练难度：${level.label}（${level.level}级）——${level.description}。你的行为要求：${level.customerBehavior}`);
    }
    if (realism.length > 0) {
      parts.push(`真实度要求：${realism.map((s) => `${s.name}——${s.description}`).join('；')}`);
    }
    if (guidance.liveIntro?.goal) {
      parts.push(`本场演练目标：${guidance.liveIntro.goal}`);
    }
    if (parts.length > 0) {
      bundle.systemPrompt = `${bundle.systemPrompt}\n\n【演练要求】\n${parts.join('\n')}`;
    }
  }

  // 注入演练剧本（整篇剧情参照）：LLM 依此理解谁先开口、客户如何回应、何时自然结束
  const drillScript = await resolveDrillScript(ctx.store, scenario).catch(() => undefined);
  if (drillScript) {
    bundle.systemPrompt = `${bundle.systemPrompt}\n\n${drillScriptPrompt(drillScript)}`;
  }
  return { personaConfig, bundle, productKB, drillScript };
}

export interface TurnResult {
traineeTurn: TranscriptTurn;
personaTurn: TranscriptTurn;
arousal: number | null;
bandKey: string | null;
remainingSeconds: number;
/** AI 判断本场对练应自然结束（剧情终点/目标达成/客户离开），或达到极端轮数上限；不再由倒计时驱动 */
timeUp?: boolean;
/** 本轮触发的待弹出考题（脱敏视图，不含答案） */
pendingQuizzes?: QuizQuestionPublic[];
}

/** 完整考题 → 下发前端的脱敏视图（剥离答案、参考要点、解析与触发条件） */
function toPublicQuiz(q: QuizQuestion): QuizQuestionPublic {
return { id: q.id, type: q.type, prompt: q.prompt, options: q.options, score: q.score, required: q.required };
}

/**
 * 检查本轮是否触发考题：遍历该场景绑定的 QuizQuestion，根据 trigger 条件判断。
 * 排除已答过的考题（session.quizResults 中已有 quizId）。
 */
async function checkQuizTriggers(
ctx: RouteContext,
session: Session,
scenario: Scenario,
traineeText: string,
traineeSeq: number,
): Promise<QuizQuestion[]> {
let quizzes: QuizQuestion[] = [];
let genericQuizzes: QuizQuestion[] = [];
try {
quizzes = await ctx.store.listQuizQuestions(session.tenantId, scenario.id);
// 也包含未绑定场景的通用考题
genericQuizzes = await ctx.store.listQuizQuestions(session.tenantId, undefined);
} catch (err) {
console.error('[checkQuizTriggers] 查询考题失败，跳过考题检测:', err instanceof Error ? err.message : String(err));
return [];
}
const allQuizzes = [...quizzes, ...genericQuizzes.filter((q) => !q.scenarioId)];
const answeredIds = new Set((session.quizResults ?? []).map((r) => r.quizId));
const pending: QuizQuestion[] = [];
const elapsedSec = Math.round((Date.now() - new Date(session.liveStartedAt ?? session.startedAt).getTime()) / 1000);
const traineeTurns = session.transcript.filter((t) => t.speaker === 'trainee');
const traineeAll = traineeTurns.map((t) => t.text).join('\n') + '\n' + traineeText;
const coverageHits = (scenario.coverageTopics ?? []).filter((topic) => traineeAll.includes(topic));

for (const q of allQuizzes) {
if (answeredIds.has(q.id)) continue;
const t = q.trigger;
let hit = false;
if (t.kind === 'turn_count') {
const traineeTurnCount = Math.ceil(traineeSeq / 2);
if (traineeTurnCount >= t.afterNTurns) hit = true;
} else if (t.kind === 'keyword_hit') {
if (t.keywords.some((kw) => traineeText.includes(kw))) hit = true;
} else if (t.kind === 'topic_covered') {
if (coverageHits.includes(t.topic)) hit = true;
} else if (t.kind === 'time_elapsed') {
if (elapsedSec >= t.seconds) hit = true;
}
if (hit) pending.push(q);
}
return pending;
}

/**
 * 学员发言一轮：情绪更新 + persona 回复（含超时收口与一致性校验），落库 transcript/emotionTrace。
 * POST /sessions/:id/turns 与语音链路（voice-turn / WS voice）共用，行为与原 turns 端点一致。
 * 返回 null 表示 persona 配置缺失（调用方按 500 处理）。
 */
export async function runTurn(
  ctx: RouteContext,
  session: Session,
  scenario: Scenario,
  text: string
): Promise<TurnResult | null> {
  const { store, gateway } = ctx;
  const isSystemGreeting = text === SYSTEM_GREETING_TOKEN;
  const displayText = isSystemGreeting ? '（电话接通）' : text;

  // 兜底：学员实际发言说明已进入对练，若倒计时尚未启动则此刻启动（兼容旧会话）
  if (!session.liveStartedAt) {
    session = { ...session, liveStartedAt: new Date().toISOString(), pausedMs: 0 };
    await store.updateSession(session.id, { liveStartedAt: session.liveStartedAt, pausedMs: 0 });
  }

  const now = new Date().toISOString();
  const traineeTurn: TranscriptTurn = {
    seq: session.transcript.length + 1,
    speaker: 'trainee',
    text: displayText,
    at: now,
  };
  const guidance = await store.getScenarioGuidance(scenario.id).catch(() => undefined);
  const totalSeconds = countdownSecondsOf(scenario, guidance);
  const lastTrace = session.emotionTrace[session.emotionTrace.length - 1];
  const traineeTurnCount = session.transcript.filter((t) => t.speaker === 'trainee').length;

  // 结束时机由 AI 判断（replyWithSignal 的 shouldClose），不再由倒计时/maxTurns 强制收口；
  // 仅保留学员轮数极端上限 MAX_LIVE_TURNS 兜底，防止对话无限进行
  const runtime = await loadRuntime(ctx, scenario, session.difficulty);
  if (!runtime) {
    console.error('[runTurn] persona 运行时加载失败, scenarioId=', scenario.id, 'personaConfigId=', scenario.personaConfigId);
    return null;
  }
  const { bundle } = runtime;

  // 请求无状态：用上轮 arousal 重建 tracker
  const tracker = new EmotionTracker(
    bundle.dynamics,
    bundle.behaviorBands,
    lastTrace?.arousal
  );
  const snapshot = tracker.update(displayText);
  const band = bandFor(snapshot.arousal, bundle.behaviorBands);

  const actor = new PersonaActor(gateway.forTask('actor'));
  const transcriptSoFar = [...session.transcript, traineeTurn];
  // LLM 回复时顺带判断本场是否应自然结束（shouldClose）：剧情终点/目标达成/谈判破裂/客户离开
  let { text: replyText, shouldClose } = await actor.replyWithSignal(bundle, band, transcriptSoFar, session.coachIntensity);

  // 一致性校验：出戏/泄露则带纠正指令重生成一次，仍不通过用兜底文案
  const firstCheck = await checkConsistency(gateway.forTask('judge'), bundle, replyText);
  if (!firstCheck.pass) {
    const retryBand = { ...band, instruction: band.instruction + CONSISTENCY_CORRECTION };
      const retry = await actor.replyWithSignal(bundle, retryBand, transcriptSoFar, session.coachIntensity);
      const secondCheck = await checkConsistency(gateway.forTask('judge'), bundle, retry.text);
    if (secondCheck.pass) {
      replyText = retry.text;
      shouldClose = retry.shouldClose;
    } else {
      replyText = CONSISTENCY_FALLBACK;
      shouldClose = false;
    }
    void store.appendEvent(
      mkEvent(EventTypes.PERSONA_CONSISTENCY_VIOLATION, {
        tenantId: session.tenantId,
        sessionId: session.id,
        userId: session.userId,
        payload: {
          seq: traineeTurn.seq,
          reasons: firstCheck.reasons,
          repairedBy: secondCheck.pass ? 'regenerate' : 'fallback',
        },
      })
    );
  }

  const personaTurn: TranscriptTurn = {
    seq: traineeTurn.seq + 1,
    speaker: 'persona',
    text: replyText,
    at: new Date().toISOString(),
    emotion: snapshot,
  };
  const emotionTrace = [
    ...session.emotionTrace,
    { seq: personaTurn.seq, arousal: snapshot.arousal, bandKey: snapshot.bandKey, at: personaTurn.at },
  ];
  // 系统开场白：不保存到 transcript（仅作为接通问候播放），避免seq不连续
  if (!isSystemGreeting) {
    await store.updateSession(session.id, {
      transcript: [...transcriptSoFar, personaTurn],
      emotionTrace,
    });
  }

  void store.appendEvent(
    mkEvent(EventTypes.SESSION_TURN, {
      tenantId: session.tenantId,
      sessionId: session.id,
      userId: session.userId,
      payload: { seq: traineeTurn.seq, text: displayText },
    })
  );
  void store.appendEvent(
mkEvent(EventTypes.SESSION_EMOTION_UPDATED, {
tenantId: session.tenantId,
sessionId: session.id,
userId: session.userId,
payload: { arousal: snapshot.arousal, bandKey: snapshot.bandKey, triggeredBy: snapshot.triggeredBy },
})
);

// ---- 考题触发检测 ----
const pendingQuizzes = await checkQuizTriggers(ctx, session, scenario, displayText, traineeTurn.seq);

return {
traineeTurn,
personaTurn,
arousal: snapshot.arousal,
bandKey: snapshot.bandKey,
remainingSeconds: remainingSeconds(session, scenario, totalSeconds),
// AI 判断本场应自然结束（剧情终点/目标达成/客户离开），或达到极端轮数上限；倒计时用尽不再强制结束
timeUp: shouldClose || traineeTurnCount + 1 >= MAX_LIVE_TURNS,
pendingQuizzes: pendingQuizzes.length > 0 ? pendingQuizzes.map(toPublicQuiz) : undefined,
};
}
