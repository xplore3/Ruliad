import { EventTypes, type QuizQuestion, type QuizQuestionPublic, type Scenario, type Session, type TranscriptTurn } from '@grasp-mvp/core';
import { bandFor, checkConsistency, compilePersona, EmotionTracker, PersonaActor } from '@grasp-mvp/role-engine';
import type { RouteContext } from '../ctx.js';
import { mkEvent } from '../events.js';

const TIME_UP_CLOSING = '时间不早了，今天先聊到这吧，你说的我再想想。';
/** 一致性校验重试仍失败时的兜底角色化文案 */
const CONSISTENCY_FALLBACK = '这个我不太清楚，你接着说。';
/** 重生成时追加的纠正指令 */
const CONSISTENCY_CORRECTION = '（注意：上一次回复出戏或泄露了不该说的信息，务必保持角色，不要暴露 AI 身份或考核相关信息。）';
/** 系统级开场白触发词：电话接通后自动播放问候，不存入 transcript */
const SYSTEM_GREETING_TOKEN = '__SYSTEM_GREETING__';

export function remainingSeconds(session: Session, scenario: Scenario): number {
  const nowMs = Date.now();
  const pausedMs =
    (session.pausedMs ?? 0) +
    (session.pausedAt ? nowMs - new Date(session.pausedAt).getTime() : 0);
  const elapsedMs = nowMs - new Date(session.startedAt).getTime() - pausedMs;
  return Math.max(0, Math.round(scenario.durationMinutes * 60 - elapsedMs / 1000));
}

/** 加载 persona 运行时（编译后的 bundle + 原始配置），配置缺失返回 undefined */
export async function loadRuntime(ctx: RouteContext, scenario: Scenario) {
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
  return { personaConfig, bundle, productKB };
}

export interface TurnResult {
traineeTurn: TranscriptTurn;
personaTurn: TranscriptTurn;
arousal: number | null;
bandKey: string | null;
remainingSeconds: number;
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
const elapsedSec = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000);
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

  const now = new Date().toISOString();
  const traineeTurn: TranscriptTurn = {
    seq: session.transcript.length + 1,
    speaker: 'trainee',
    text: displayText,
    at: now,
  };
  const remaining = remainingSeconds(session, scenario);
  const lastTrace = session.emotionTrace[session.emotionTrace.length - 1];

  // 超时：固定收口文案，不再调 LLM
  if (remaining <= 0) {
    const personaTurn: TranscriptTurn = {
      seq: traineeTurn.seq + 1,
      speaker: 'persona',
      text: TIME_UP_CLOSING,
      at: new Date().toISOString(),
      emotion: lastTrace
        ? { arousal: lastTrace.arousal, bandKey: lastTrace.bandKey }
        : undefined,
    };
    await store.updateSession(session.id, {
      transcript: [...session.transcript, traineeTurn, personaTurn],
    });
    return {
      traineeTurn,
      personaTurn,
      arousal: lastTrace?.arousal ?? null,
      bandKey: lastTrace?.bandKey ?? null,
      remainingSeconds: 0,
      timeUp: true,
    };
  }

  const runtime = await loadRuntime(ctx, scenario);
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
  let replyText = await actor.reply(bundle, band, transcriptSoFar, session.coachIntensity);

  // 一致性校验：出戏/泄露则带纠正指令重生成一次，仍不通过用兜底文案
  const firstCheck = await checkConsistency(gateway.forTask('judge'), bundle, replyText);
  if (!firstCheck.pass) {
    const retryBand = { ...band, instruction: band.instruction + CONSISTENCY_CORRECTION };
      replyText = await actor.reply(bundle, retryBand, transcriptSoFar, session.coachIntensity);
      const secondCheck = await checkConsistency(gateway.forTask('judge'), bundle, replyText);
    if (!secondCheck.pass) {
      replyText = CONSISTENCY_FALLBACK;
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
remainingSeconds: remainingSeconds({ ...session, startedAt: session.startedAt }, scenario),
pendingQuizzes: pendingQuizzes.length > 0 ? pendingQuizzes.map(toPublicQuiz) : undefined,
};
}
