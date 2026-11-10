import { EventTypes, type PersonaConfig, type QuizQuestion, type QuizQuestionPublic, type ReceptionQuestion, type Scenario, type ScenarioGuidance, type Session, type TranscriptTurn, type VoiceFeatures } from '@grasp-mvp/core';
import { analyzeExpressionIntent, bandFor, checkConsistency, classifyAddressTarget, compilePersona, EmotionTracker, GROUND_PUSH_CLOSE_CONTROL, PersonaActor, replyAsChild, ruleCheck } from '@grasp-mvp/role-engine';
import type { RouteContext } from '../ctx.js';
import { mkEvent } from '../events.js';
import { drillScriptPrompt, institutionKnowledgePrompt, archetypePrompt, resolveDrillScript, initialCustomerArchetype, FIRST_SCENE_MAX_MS, GIVE_UP_PATTERN, SCENE_TRANSITION_NARRATION } from './drill.js';
import { receptionQuestionPrompt } from './reception-questions.js';
import { receptionTrialFollowup } from './reception-followup.js';
import { assessGroundPushProgress } from './ground-push-progress.js';
import { assessChildStrategy, isChildClosedQuestion, isStoryOfferQuestion } from './child-strategy.js';
import { preScoreSession } from './scoring.js';

/** 一致性校验重试仍失败时的兜底角色化文案 */
const CONSISTENCY_FALLBACK = '这个我不太清楚，你接着说。';
/** 重生成时追加的纠正指令 */
const CONSISTENCY_CORRECTION = '（注意：上一次回复出戏或泄露了不该说的信息，务必保持角色，不要暴露 AI 身份或考核相关信息。）';
/** 系统级开场白触发词：电话接通后自动播放问候，不存入 transcript */
const SYSTEM_GREETING_TOKEN = '__SYSTEM_GREETING__';
/** 学员轮数极端安全上限：仅作防止对话无限进行的兜底（20 分钟对练正常轮数可能远超 40；结束时机由 AI 判断 + 倒计时到点决定） */
const MAX_LIVE_TURNS = 200;

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

/** 中性兜底陪练员：陪练员库为空或场景未绑定时使用——演练行为完全由场景设定与演练剧本驱动，不携带任何角色库设定 */
function fallbackPersona(scenario: Scenario): PersonaConfig {
  return {
    id: 'persona-neutral-fallback',
    tenantId: scenario.tenantId,
    version: 1,
    name: '客户',
    background: '本场演练的客户，行为完全由场景设定与演练剧本决定。',
    elementIds: [],
    behaviorBands: [
      { minArousal: 0, maxArousal: 1, key: 'neutral', instruction: '按演练剧本与对话情境自然反应' },
    ],
    knowledgeBoundary: { mustNotKnow: [], loadedKnowledge: [] },
  };
}

/** 加载 persona 运行时（编译后的 bundle + 原始配置 + 演练剧本 + 本场客户类型）；陪练员缺失时用中性兜底角色，保证演练只受场景与剧本影响 */
export async function loadRuntime(
  ctx: RouteContext,
  scenario: Scenario,
  difficulty?: number,
  archetype?: 'uninterested' | 'interested',
  receptionQuestions?: ReceptionQuestion[],
  receptionTrialDisposition?: Session['receptionTrialDisposition']
) {
  const configuredPersona = await ctx.store.getPersonaConfig(scenario.personaConfigId);
  const personaConfig = configuredPersona?.tenantId === scenario.tenantId
    ? configuredPersona
    : fallbackPersona(scenario);
  const elements = (await ctx.store.listElements({}))
    .filter((element) => element.tenantId === undefined || element.tenantId === scenario.tenantId);

  // 所有运行时引用再次校验租户，兼容历史脏数据但不允许跨租户注入。
  const kbId = scenario.productKBId ?? personaConfig.productKBId;
  const referencedKB = kbId ? await ctx.store.getProductKBById(kbId) : undefined;
  const productKB = kbId
    ? referencedKB?.tenantId === scenario.tenantId
      ? referencedKB
      : await ctx.store.getProductKB(scenario.tenantId)
    : await ctx.store.getProductKB(personaConfig.tenantId);
  const institutionKB = kbId
    ? await ctx.store.getProductKB(scenario.tenantId)
    : productKB;

  // 演练剧本优先解析：有剧本时客户行为只由剧本+本场客户类型决定（剧情参照为唯一行为来源），
  // 不再注入场景难度、指引配置、人设要素等其他指令，避免与剧本中的行为约束冲突
  const drillScript = await resolveDrillScript(ctx.store, scenario).catch(() => undefined);

  const bundle = drillScript
    ? compilePersona(personaConfig, [], undefined, undefined)
    : compilePersona(personaConfig, elements, productKB, scenario);

  // 注入新手指引流程配置的第4步参数：难度系数说明（选定档位的客户行为要求）+ 演练真实度标准库
  const guidance = drillScript
    ? undefined
    : await ctx.store.getScenarioGuidance(scenario.id).catch(() => undefined);
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
  if (drillScript) {
    bundle.systemPrompt = `${bundle.systemPrompt}\n\n${drillScriptPrompt(drillScript)}`;
  }
  // 非剧本场景的默认库已由 compilePersona 注入；其余情况都必须显式补上机构定制库
  if (institutionKB && (drillScript || productKB?.id !== institutionKB.id)) {
    bundle.systemPrompt = `${bundle.systemPrompt}\n\n${institutionKnowledgePrompt(institutionKB)}`;
  }
  if (scenario.flowType ? scenario.flowType === 'ground_push' : scenario.category === '地推') {
    bundle.systemPrompt = `${bundle.systemPrompt}\n\n${GROUND_PUSH_CLOSE_CONTROL}`;
  }
  if ((scenario.flowType ? scenario.flowType === 'reception' : scenario.category === '咨询接待')) {
    bundle.systemPrompt = `${bundle.systemPrompt}\n\n${receptionQuestionPrompt(receptionQuestions, receptionTrialDisposition)}`;
  }
  // 注入本场客户类型：地推按双场制执行；咨询接待固定为有兴趣客户（包括旧会话）
  const effectiveArchetype = (scenario.flowType ? scenario.flowType === 'reception' : scenario.category === '咨询接待') ? 'interested' : archetype;
  if (effectiveArchetype) {
    bundle.systemPrompt = `${bundle.systemPrompt}\n\n${archetypePrompt(effectiveArchetype, scenario.category)}`;
  }
  return { personaConfig, bundle, productKB, drillScript };
}

export interface TurnResult {
traineeTurn: TranscriptTurn;
/** 客户应答轮；孩子模式下销售对孩子说话时无客户轮（由 childTurn 承担主应答） */
personaTurn?: TranscriptTurn;
/** 双场制切场旁白（第一小场结束、切换有意向客户时下发；speaker=coach，不参与轮次与评分统计） */
narratorTurn?: TranscriptTurn;
/** 孩子回答轮（客户转头问孩子时由独立 LLM 以孩子口吻生成；speaker=child，不计入学员评分统计） */
childTurn?: TranscriptTurn;
/** 首句 TTS 预合成结果（与语义审查并行；审查违例重生成后作废为 undefined） */
warmupAudio?: Buffer;
warmupFormat?: string;
arousal: number | null;
bandKey: string | null;
remainingSeconds: number;
/** AI 判断本场对练应自然结束（剧情终点/目标达成/客户离开）、倒计时用尽（到点自动结束），或达到极端轮数上限 */
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

export interface PrecomputedPersonaReply {
  text: string;
  shouldClose: boolean;
  asksChild: boolean;
  questionIndex?: number;
  warmupAudio?: Buffer;
  warmupFormat?: string;
}

/** ASR 稳定句后的预测性回复：只生成草稿与首句音频，不写会话；最终文本匹配时才复用 */
export async function preparePersonaReply(
  ctx: RouteContext,
  session: Session,
  scenario: Scenario,
  text: string,
  ttsWarmup?: (text: string) => Promise<{ audio: Buffer; format: string } | null>
): Promise<PrecomputedPersonaReply | null> {
  try {
    if (!text.trim() || session.childMode || (scenario.flowType ? scenario.flowType === 'reception' : scenario.category === '咨询接待')) return null;
    const runtime = await loadRuntime(ctx, scenario, session.difficulty, session.customerArchetype, session.receptionQuestions, session.receptionTrialDisposition);
    const lastTrace = session.emotionTrace[session.emotionTrace.length - 1];
    const tracker = new EmotionTracker(runtime.bundle.dynamics, runtime.bundle.behaviorBands, lastTrace?.arousal);
    const snapshot = tracker.update(text);
    const band = bandFor(snapshot.arousal, runtime.bundle.behaviorBands);
    const actor = new PersonaActor(ctx.gateway.forTask('actor'));
    let warmupPromise: Promise<{ audio: Buffer; format: string } | null> | undefined;
    const reply = await actor.replyWithSignal(
      runtime.bundle,
      band,
      [...session.transcript, { seq: session.transcript.length + 1, speaker: 'trainee', text, at: new Date().toISOString() }],
      session.coachIntensity,
      (sentence) => {
        if (!warmupPromise && ttsWarmup) warmupPromise = ttsWarmup(sentence).catch(() => null);
      }
    );
    const warm = await warmupPromise;
    return {
      text: reply.text,
      shouldClose: reply.shouldClose,
      asksChild: reply.asksChild,
      questionIndex: reply.questionIndex,
      warmupAudio: warm?.audio,
      warmupFormat: warm?.format,
    };
  } catch (err) {
    console.warn('[preparePersonaReply] 预测回复失败，最终回合将重新生成:', err instanceof Error ? err.message : String(err));
    return null;
  }
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
  text: string,
  voiceFeatures?: VoiceFeatures,
  /** 首句 TTS 预合成：与语义一致性审查并行执行，响应延迟取两者最大值而非相加 */
  ttsWarmup?: (text: string) => Promise<{ audio: Buffer; format: string } | null>,
  /** ASR 稳定句提前生成的草稿；仅在最终识别文本与预测输入一致时传入 */
  precomputedReply?: PrecomputedPersonaReply | null
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
    ...(voiceFeatures && !isSystemGreeting ? { voiceFeatures } : {}),
  };
  const analyzeIntentInBackground = () => {
    if (!voiceFeatures || isSystemGreeting) return;
    void analyzeExpressionIntent(
      gateway.forTask('actor'),
      traineeTurn,
      `${scenario.name}${scenario.script?.purpose ? `：${scenario.script.purpose}` : ''}`
    ).then(async (expressionIntent) => {
      const latest = await store.getSession(session.id);
      if (!latest) return;
      const transcript = latest.transcript.map((turn) =>
        turn.seq === traineeTurn.seq && turn.speaker === 'trainee'
          ? { ...turn, expressionIntent }
          : turn
      );
      await store.updateSession(session.id, { transcript });
    }).catch((err) => {
      console.warn('[runTurn] 后台表达意图分析落库失败:', err instanceof Error ? err.message : String(err));
    });
  };
  const guidance = await store.getScenarioGuidance(scenario.id).catch(() => undefined);
  const totalSeconds = countdownSecondsOf(scenario, guidance);
  const lastTrace = session.emotionTrace[session.emotionTrace.length - 1];
  const traineeTurnCount = session.transcript.filter((t) => t.speaker === 'trainee').length;

  // ---- 孩子模式：家长问孩子后激活。学员发言先经路由器判定对话对象——
  // 对孩子说的由孩子角色直接应答；第二次沟通仍抗拒时家长直接带走孩子并结束 ----
  if (session.childMode && !isSystemGreeting) {
    const target = await classifyAddressTarget(gateway.forTask('actor'), session.transcript, text);
    if (target === 'child') {
      traineeTurn.addressedToChild = true;
      const storyOffer = (scenario.flowType ? scenario.flowType === 'ground_push' : scenario.category === '地推') && isStoryOfferQuestion(text);
      const closedQuestion = (scenario.flowType ? scenario.flowType === 'ground_push' : scenario.category === '地推') && !storyOffer && isChildClosedQuestion(text);
      const strategy = (scenario.flowType ? scenario.flowType === 'ground_push' : scenario.category === '地推') && !storyOffer
        ? await assessChildStrategy(gateway.forTask('actor'), [...session.transcript, traineeTurn])
        : { effective: null, reason: '' };
      let childReply: { text: string; resistant: boolean };
      if (storyOffer) {
        childReply = { text: '我不想学。', resistant: true };
      } else if (strategy.effective === true) {
        childReply = { text: closedQuestion ? '我喜欢！' : '哈哈，真好玩！', resistant: false };
      } else if (strategy.effective === false) {
        childReply = { text: closedQuestion ? '我不喜欢。' : '我不想玩。', resistant: true };
        if (closedQuestion) traineeTurn.groundChildClosedQuestion = true;
      } else {
        childReply = await replyAsChild(gateway.forTask('actor'), [...session.transcript, traineeTurn], text)
          .catch(() => ({ text: '', resistant: true }));
      }
      const childInterestResolved = session.childInterestResolved || (closedQuestion && strategy.effective === true);
      const childStoryOffered = session.childStoryOffered || storyOffer;
      const childReplyTurn: TranscriptTurn = {
        seq: traineeTurn.seq + 1,
        speaker: 'child',
        text: childReply.text.trim() || '（孩子抿着嘴没说话）',
        at: new Date().toISOString(),
      };
      const childAttemptCount = (session.childAttemptCount ?? 0) + 1;
      const pendingQuizzes = await checkQuizTriggers(ctx, session, scenario, displayText, traineeTurn.seq);
      const left = remainingSeconds(session, scenario, totalSeconds);

      if (childAttemptCount >= 2 && childReply.resistant) {
        const personaTurn: TranscriptTurn = {
          seq: childReplyTurn.seq + 1,
          speaker: 'persona',
          text: '（家长牵起孩子的手）孩子还是不太愿意，我们先走了。',
          at: new Date().toISOString(),
        };
        await store.updateSession(session.id, {
          transcript: [...session.transcript, traineeTurn, childReplyTurn, personaTurn],
          childMode: false,
          childAttemptCount,
          childInterestResolved,
          childStoryOffered,
          completionStatus: 'incomplete',
          completionReason: `家长认为孩子不感兴趣，带孩子离开了：销售未能用合理策略说服孩子。${strategy.reason}`,
        });
        analyzeIntentInBackground();
        return {
          traineeTurn,
          personaTurn,
          arousal: lastTrace?.arousal ?? null,
          bandKey: lastTrace?.bandKey ?? null,
          remainingSeconds: left,
          timeUp: true,
          pendingQuizzes: pendingQuizzes.length > 0 ? pendingQuizzes.map(toPublicQuiz) : undefined,
        };
      }

      await store.updateSession(session.id, {
        transcript: [...session.transcript, traineeTurn, childReplyTurn],
        childMode: true,
        childAttemptCount,
        childInterestResolved,
        childStoryOffered,
      });
      analyzeIntentInBackground();
      void store.appendEvent(
        mkEvent(EventTypes.SESSION_TURN, {
          tenantId: session.tenantId,
          sessionId: session.id,
          userId: session.userId,
          payload: { seq: traineeTurn.seq, text: displayText, addressedToChild: true },
        })
      );
      return {
        traineeTurn,
        childTurn: childReplyTurn,
        arousal: lastTrace?.arousal ?? null,
        bandKey: lastTrace?.bandKey ?? null,
        remainingSeconds: left,
        timeUp: left <= 0 || traineeTurnCount + 1 >= MAX_LIVE_TURNS,
        pendingQuizzes: pendingQuizzes.length > 0 ? pendingQuizzes.map(toPublicQuiz) : undefined,
      };
    }
    // 学员转向家长：退出孩子模式，本轮起恢复客户应答
    session = { ...session, childMode: false };
    await store.updateSession(session.id, { childMode: false });
  }

  // 结束时机：AI 判断（replyWithSignal 的 shouldClose）+ 倒计时到点自动结束；
  // MAX_LIVE_TURNS 仅作防止对话无限进行的极端兜底
  const runtime = await loadRuntime(ctx, scenario, session.difficulty, session.customerArchetype, session.receptionQuestions, session.receptionTrialDisposition);
  if (!runtime) {
    console.error('[runTurn] persona 运行时加载失败, scenarioId=', scenario.id, 'personaConfigId=', scenario.personaConfigId);
    return null;
  }
  const { bundle, drillScript } = runtime;
  if ((scenario.flowType ? scenario.flowType === 'ground_push' : scenario.category === '地推') && session.childInterestResolved) {
    bundle.systemPrompt = `${bundle.systemPrompt}\n\n【六连问末题替换（必须执行）】\n销售已提前说服孩子，孩子已明确喜欢或愿意参加。六连问最后一问不得再使用“孩子不喜欢/宝贝你想去吗”，改从以下问题中选择一道本场尚未问过的问题：孩子学的太多了、我太忙了、一周上几次课、我们家有点远、学费怎么收、你们根据年龄分班吗、这个需要孩子练习很长时间吗、你们有内部教材和课程体系吗。检查完整对话，任何问题都不得重复。`;
  }

  // 双场制只适用于地推：咨询接待永不进入固定无兴趣小场
  const dualScene =
    (scenario.flowType ? scenario.flowType === 'ground_push' : scenario.category === '地推') &&
    session.customerArchetype === 'uninterested' &&
    !!drillScript &&
    initialCustomerArchetype(drillScript.content, scenario.category) === 'uninterested';
  // 学员明确放弃当前客户（"那打扰您了"等话术）：跳过 LLM 回复，客户直接离场，立即切场
  const traineeGaveUp = GIVE_UP_PATTERN.test(text);

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
  let replyText: string;
  let shouldClose = false;
  let asksChild = false;
  let receptionQuestionIndex = session.receptionQuestionIndex;
  let groundPushLastChance = session.groundPushLastChance ?? false;
  let completionStatus = session.completionStatus;
  let completionReason = session.completionReason;
  let warmupAudio: Buffer | undefined;
  let warmupFormat: string | undefined;
  const receptionFollowup = !isSystemGreeting && (scenario.flowType ? scenario.flowType === 'reception' : scenario.category === '咨询接待')
    ? receptionTrialFollowup({ ...session, transcript: transcriptSoFar })
    : undefined;
  const groundPushProgress = !receptionFollowup && !isSystemGreeting && !dualScene && (scenario.flowType ? scenario.flowType === 'ground_push' : scenario.category === '地推')
    ? await assessGroundPushProgress(gateway.forTask('actor'), transcriptSoFar, groundPushLastChance, await store.listSuggestionRules(session.tenantId))
    : undefined;
  if (receptionFollowup) {
    replyText = receptionFollowup.text;
    shouldClose = receptionFollowup.shouldClose;
  } else if (groundPushProgress && !groundPushProgress.substantive) {
    if (groundPushLastChance) {
      replyText = '好的，我回去琢磨琢磨，先走了。';
      shouldClose = true;
      completionStatus = 'incomplete';
      completionReason = `客户已给“我回去琢磨琢磨”的最后推进机会，但学员仍未作出售卖邀请函、填写信息、选择支付方式或约定时间等实质动作。${groundPushProgress.reason}`;
    } else {
      replyText = '好的，我回去琢磨琢磨。';
      groundPushLastChance = true;
    }
  } else if (!isSystemGreeting && dualScene && traineeGaveUp) {
    // 快速通道：不再调用 LLM 生成客户回复与一致性校验
    replyText = '（客户摆了摆手，快步走远了）';
  } else {
    // 主回复同时判断剧情结束与地推客户离场；流式生成时第一个完整短句立即预合成
    let streamedFirstWarmup: { sentence: string; promise: Promise<{ audio: Buffer; format: string } | null> } | undefined;
    const reply = precomputedReply ?? await actor.replyWithSignal(
      bundle,
      band,
      transcriptSoFar,
      session.coachIntensity,
      (sentence) => {
        if (!streamedFirstWarmup && ttsWarmup) {
          streamedFirstWarmup = { sentence, promise: ttsWarmup(sentence).catch(() => null) };
        }
      }
    );
    replyText = reply.text;
    shouldClose = reply.shouldClose;
    asksChild = reply.asksChild;
    receptionQuestionIndex = reply.questionIndex ?? receptionQuestionIndex;

    // 一致性校验分两层：
    // ① 明显关键词违例（AI 自曝/考核泄露）同步拦截并重生成一次——快，不额外调 LLM；
    // ② 低延迟语义审查与首句 TTS 预合成并行：审查必须通过才播放，
    //    但等待时间取两者最大值而非相加；语义违例时预合成音频作废、带纠正指令重生成一次。
    if (ruleCheck(replyText).length > 0) {
      const retryBand = { ...band, instruction: band.instruction + CONSISTENCY_CORRECTION };
      const retry = await actor.replyWithSignal(bundle, retryBand, transcriptSoFar, session.coachIntensity);
      if (ruleCheck(retry.text).length === 0) {
        replyText = retry.text;
        shouldClose = retry.shouldClose;
        asksChild = retry.asksChild;
        receptionQuestionIndex = retry.questionIndex ?? receptionQuestionIndex;
      } else {
        replyText = CONSISTENCY_FALLBACK;
        shouldClose = false;
        asksChild = false;
      }
    }
    const firstSentence = replyText.match(/^[^。？！；!?\n]+[。？！；!?]/)?.[0];
    const precomputedWarmup = precomputedReply?.text === replyText && precomputedReply.warmupAudio && precomputedReply.warmupFormat
      ? { audio: precomputedReply.warmupAudio, format: precomputedReply.warmupFormat }
      : null;
    const streamedWarmup = firstSentence && streamedFirstWarmup?.sentence === firstSentence
      ? streamedFirstWarmup.promise
      : undefined;
    const warmupPromise = precomputedWarmup
      ? Promise.resolve(precomputedWarmup)
      : (streamedWarmup ?? (ttsWarmup ? ttsWarmup(replyText) : Promise.resolve(null))).catch(() => null);
    const audit = await checkConsistency(gateway.forTask('judge_realtime'), bundle, replyText).catch(() => ({ pass: true, reasons: [] as string[] }));
    if (!audit.pass) {
      const retryBand = { ...band, instruction: band.instruction + CONSISTENCY_CORRECTION };
      const retry = await actor.replyWithSignal(bundle, retryBand, transcriptSoFar, session.coachIntensity);
      const recheck = await checkConsistency(gateway.forTask('judge_realtime'), bundle, retry.text).catch(() => ({ pass: true, reasons: [] as string[] }));
      if (recheck.pass) {
        replyText = retry.text;
        shouldClose = retry.shouldClose;
        asksChild = retry.asksChild;
        receptionQuestionIndex = retry.questionIndex ?? receptionQuestionIndex;
      } else {
        replyText = CONSISTENCY_FALLBACK;
        shouldClose = false;
        asksChild = false;
      }
      void store.appendEvent(
        mkEvent(EventTypes.PERSONA_CONSISTENCY_VIOLATION, {
          tenantId: session.tenantId,
          sessionId: session.id,
          userId: session.userId,
          payload: { seq: traineeTurn.seq, reasons: audit.reasons, repairedBy: recheck.pass ? 'regenerate' : 'fallback' },
        })
      );
    } else {
      const warm = await warmupPromise;
      warmupAudio = warm?.audio;
      warmupFormat = warm?.format;
    }
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

  // ---- 孩子作答：客户本轮转头向孩子提问（[[CHILD]]）时，由独立 LLM 以孩子口吻回答，问题不由销售作答 ----
  let childTurn: TranscriptTurn | undefined;
  if (asksChild && !isSystemGreeting && replyText.trim()) {
    const childReply = await replyAsChild(gateway.forTask('actor'), [...transcriptSoFar, personaTurn], replyText)
      .catch(() => ({ text: '', resistant: true }));
    if (childReply.text.trim()) {
      childTurn = {
        seq: personaTurn.seq + 1,
        speaker: 'child',
        text: childReply.text.trim(),
        at: new Date().toISOString(),
      };
    }
  }

  // ---- 双场制切场：第一场（不感兴趣）满 100 秒、学员说出放弃类话术、或 LLM 判定对话自然结束时，
  // 旁白切换到第二场（潜在意向）。第一场客户离开是预期剧情，不结束整场演练；
  // 旁白轮 speaker=coach，不计入轮次与评分统计
  let narratorTurn: TranscriptTurn | undefined;
  const firstSceneElapsedMs =
    Date.now() - new Date(session.liveStartedAt ?? session.startedAt).getTime() - (session.pausedMs ?? 0);
  if (
    !isSystemGreeting &&
    dualScene &&
    (firstSceneElapsedMs >= FIRST_SCENE_MAX_MS || traineeGaveUp || shouldClose)
  ) {
    shouldClose = false;
    narratorTurn = {
      seq: (childTurn ?? personaTurn).seq + 1,
      speaker: 'coach',
      text: SCENE_TRANSITION_NARRATION,
      at: new Date().toISOString(),
    };
    // 新客户情绪重置为基线，并将会话客户类型切换为"潜在意向"（下一轮起生效）
    const baseArousal = bundle.dynamics.baseArousal;
    emotionTrace.push({
      seq: narratorTurn.seq,
      arousal: baseArousal,
      bandKey: bandFor(baseArousal, bundle.behaviorBands).key,
      at: narratorTurn.at,
    });
    await store.updateSession(session.id, { customerArchetype: 'interested' });
  }

  // 系统开场白：不保存到 transcript（仅作为接通问候播放），避免seq不连续
  if (!isSystemGreeting) {
    const transcript = [...transcriptSoFar, personaTurn, ...(childTurn ? [childTurn] : []), ...(narratorTurn ? [narratorTurn] : [])];
    await store.updateSession(session.id, {
      transcript,
      emotionTrace,
      receptionQuestionIndex,
      groundPushLastChance,
      completionStatus,
      completionReason,
      // 家长问孩子 → 激活孩子模式，并从销售第一次说服孩子起计算两轮机会
      ...(childTurn ? { childMode: true, childAttemptCount: 0 } : {}),
    });
    preScoreSession(ctx, { ...session, transcript, emotionTrace, receptionQuestionIndex, groundPushLastChance, completionStatus, completionReason }, scenario);
    analyzeIntentInBackground();
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

const left = remainingSeconds(session, scenario, totalSeconds);
return {
traineeTurn,
personaTurn,
narratorTurn,
childTurn,
warmupAudio,
warmupFormat,
arousal: snapshot.arousal,
bandKey: snapshot.bandKey,
remainingSeconds: left,
// 结束条件：AI 判断本场应自然结束（剧情终点/目标达成/客户离开）、倒计时到点自动结束、
// 或达到极端轮数上限；双场制第一小场客户的离开是预期切场，不视为整场结束
timeUp: shouldClose || left <= 0 || traineeTurnCount + 1 >= MAX_LIVE_TURNS,
pendingQuizzes: pendingQuizzes.length > 0 ? pendingQuizzes.map(toPublicQuiz) : undefined,
};
}
