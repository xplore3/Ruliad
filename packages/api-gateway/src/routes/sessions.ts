import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { EventTypes, type CertRecord, type QuizResult, type Session, type TranscriptTurn } from '@grasp-mvp/core';
import { bandFor, PersonaActor } from '@grasp-mvp/role-engine';
import { scoreSession } from '@grasp-mvp/scoring-engine';
import type { RouteContext } from '../ctx.js';
import { mkEvent } from '../events.js';
import { effectiveCountdownSeconds, loadRuntime, remainingSeconds, runTurn } from '../services/turn.js';
import { decideOpening } from '../services/drill.js';
import { personaVoice } from './voice.js';
import { readFramesAsDataUrls } from '../services/video-store.js';

const MAX_HINTS = 3;
const REVIEW_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** 最小学员发言轮次：少于此值不生成报告 */
const MIN_TRAINEE_TURNS = 2;
/** 最短对练时长（秒）：短于此值不生成报告 */
const MIN_DURATION_SECONDS = 30;

/**
 * 结束会话并评分：end 端点与监考自动交卷共用。
 * 场景已删除时无法评分，会话标记 abandoned 并返回 skippedReport；
 * 评分异常时会话回滚为 active，允许调用方重试。
 * 评分、bestScore、reviewDueAt、UserSkillState、cert 签发、事件行为与原 end 端点完全一致。
 *
 * 当学员发言轮次过少或对练时长过短时，跳过评分报告，会话标记为 abandoned。
 */
async function finalizeSession(session: Session, ctx: RouteContext, log?: FastifyBaseLogger) {
  const { store, gateway } = ctx;
  const startedAt = Date.now();
  log?.info({ sessionId: session.id, scenarioId: session.scenarioId, mode: session.mode }, '结束会话：开始');

  const scenario = await store.getScenario(session.scenarioId);
  if (!scenario) {
    // 场景已被删除：无法评分，将活跃会话标记 abandoned，避免永远卡 active 的僵尸会话
    log?.warn({ sessionId: session.id, scenarioId: session.scenarioId }, '结束会话：场景已删除，标记 abandoned');
    const endedAt = new Date().toISOString();
    await store.updateSession(session.id, { status: 'abandoned', endedAt });
    void store.appendEvent(
      mkEvent(EventTypes.SESSION_COMPLETED, {
        tenantId: session.tenantId,
        sessionId: session.id,
        userId: session.userId,
        payload: {
          scenarioId: session.scenarioId,
          mode: session.mode,
          skipped: true,
          reason: 'scenario_deleted',
        },
      })
    );
    return { sessionId: session.id, skippedReport: true, reason: 'scenario_deleted' };
  }

  const endedAt = new Date().toISOString();

  // 检查是否有足够的对话内容生成报告
  const traineeTurns = session.transcript.filter((t) => t.speaker === 'trainee').length;
  const durationSec =
    (new Date(endedAt).getTime() - new Date(session.liveStartedAt ?? session.startedAt).getTime()) / 1000;

  if (traineeTurns < MIN_TRAINEE_TURNS || durationSec < MIN_DURATION_SECONDS) {
    log?.info(
      { sessionId: session.id, traineeTurns, durationSec: Math.round(durationSec), minTurns: MIN_TRAINEE_TURNS, minDurationSec: MIN_DURATION_SECONDS },
      '结束会话：内容不足，标记 abandoned（不生成报告）'
    );
    // 对话太少或时间太短，跳过报告生成，标记为 abandoned
    await store.updateSession(session.id, { status: 'abandoned', endedAt });
    void store.appendEvent(
      mkEvent(EventTypes.SESSION_COMPLETED, {
        tenantId: session.tenantId,
        sessionId: session.id,
        userId: session.userId,
        payload: {
          scenarioId: session.scenarioId,
          mode: session.mode,
          skipped: true,
          reason: 'insufficient_content',
          traineeTurns,
          durationSec: Math.round(durationSec),
        },
      })
    );
    return { sessionId: session.id, skippedReport: true, traineeTurns, durationSec: Math.round(durationSec) };
  }

  const completed: Session = { ...session, status: 'completed', endedAt };
  await store.updateSession(session.id, { status: 'completed', endedAt });

  let report: Awaited<ReturnType<typeof scoreSession>>;
  try {
    const defs = await store.listScoreItemDefs(session.tenantId);
    const skillPoints = await store.listSkillPoints(session.tenantId);
    const skillPointNames = Object.fromEntries(skillPoints.map((sp) => [sp.id, sp.name]));
    // 新手指引流程配置的重点评分维度（第5步）：有值时 judge 对这些维度从严
    const guidance = await store.getScenarioGuidance(session.scenarioId).catch(() => undefined);
    // 有录像关键帧时附带视频表现评审（无视觉模型/评审失败时自动跳过，不影响文字评分）
    const framesStart = Date.now();
    const videoFrames = completed.videoFrames?.length
      ? await readFramesAsDataUrls(completed.id, completed.videoFrames.length)
      : undefined;
    log?.info(
      { sessionId: session.id, scoreItems: defs.length, videoFrames: videoFrames?.length ?? 0, ms: Date.now() - framesStart },
      '结束会话：评分前准备完成（评分标准定义 + 视频关键帧）'
    );

    const scoringStart = Date.now();
    report = await scoreSession(completed, scenario, defs, gateway, { videoFrames, log, skillPointNames, scoringFocus: guidance?.scoringFocus });
    log?.info(
      { sessionId: session.id, reportId: report.id, totalScore: report.totalScore, passed: report.passed, ms: Date.now() - scoringStart },
      '结束会话：评分完成'
    );
  } catch (err) {
    // 评分异常：回滚会话为 active，允许重新 end 重试；
    // 否则会话停在 completed 但无报告，复盘页永久 404 且无法补救
    await store.updateSession(session.id, { status: 'active' });
    throw err;
  }
  await store.saveScoreReport(report);
  log?.info({ sessionId: session.id, reportId: report.id }, '结束会话：评分报告已落库');

  // 场景任务：最好成绩 / 通过状态 / 间隔复训
  const existingTask = await store.getScenarioTask(session.userId, session.scenarioId);
  const bestScore = Math.max(existingTask?.bestScore ?? 0, report.totalScore);
  await store.upsertScenarioTask({
    ...existingTask,
    userId: session.userId,
    scenarioId: session.scenarioId,
    status: report.passed ? 'passed' : 'failed_pending_retry',
    bestScore,
    lastSessionId: session.id,
    reviewDueAt: report.passed
      ? new Date(Date.now() + REVIEW_INTERVAL_MS).toISOString()
      : existingTask?.reviewDueAt,
    isReview: report.passed ? true : existingTask?.isReview,
  });

  // 用户技能状态：按本次技能得分更新档位与历史
  for (const skillPointId of scenario.skillPointIds) {
    const skillScore = report.skillScores.find((s) => s.skillPointId === skillPointId);
    const score = skillScore?.score ?? 0;
    const existing = await store.getUserSkillState(session.userId, skillPointId);
    await store.upsertUserSkillState({
      userId: session.userId,
      skillPointId,
      currentLevel: Math.min(5, Math.max(0, Math.floor(score / 20))),
      history: [
        ...(existing?.history ?? []),
        { at: endedAt, score, sessionId: session.id, mode: session.mode },
      ],
      nextReviewAt: new Date(Date.now() + REVIEW_INTERVAL_MS).toISOString(),
    });
  }

  void store.appendEvent(
    mkEvent(EventTypes.SESSION_COMPLETED, {
      tenantId: session.tenantId,
      sessionId: session.id,
      userId: session.userId,
      payload: { scenarioId: session.scenarioId, mode: session.mode },
    })
  );
  void store.appendEvent(
    mkEvent(EventTypes.SCORING_COMPLETED, {
      tenantId: session.tenantId,
      sessionId: session.id,
      userId: session.userId,
      payload: { reportId: report.id, totalScore: report.totalScore, passed: report.passed },
    })
  );

  // 考核模式：签发认证记录（passed/failed 都落库，failed 用于补考冷却判定）
  let cert: CertRecord | null = null;
  if (session.mode === 'exam' && session.examWindowId) {
    cert = {
      id: randomUUID(),
      tenantId: session.tenantId,
      userId: session.userId,
      examWindowId: session.examWindowId,
      passed: report.passed,
      totalScore: report.totalScore,
      skillDetail: Object.fromEntries(report.skillScores.map((s) => [s.skillPointId, s.score])),
      sessionIds: [session.id],
      issuedAt: endedAt,
    };
    await store.saveCertRecord(cert);
    void store.appendEvent(
      mkEvent(EventTypes.CERT_ISSUED, {
        tenantId: session.tenantId,
        sessionId: session.id,
        userId: session.userId,
        payload: {
          certId: cert.id,
          examWindowId: session.examWindowId,
          passed: report.passed,
          totalScore: report.totalScore,
        },
      })
    );
  }

  log?.info({ sessionId: session.id, ms: Date.now() - startedAt }, '结束会话：全部完成');

  return { sessionId: session.id, report, cert };
}

export async function sessionsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway } = ctx;

  // 创建对练会话（含 persona 开场白）
  app.post<{
    Body: {
      scenarioId: string;
      mode?: 'practice' | 'exam';
      examWindowId?: string;
      coachIntensity?: 'low' | 'medium' | 'high';
    };
  }>(
    '/sessions',
    async (request, reply) => {
      const { scenarioId, mode = 'practice', examWindowId, coachIntensity } = request.body ?? {};
      if (!scenarioId) return reply.code(400).send({ error: 'scenarioId 必填' });
      if (coachIntensity !== undefined && !['low', 'medium', 'high'].includes(coachIntensity)) {
        return reply.code(400).send({ error: 'coachIntensity 只能是 low / medium / high' });
      }

      const scenario = await store.getScenario(scenarioId);
      if (!scenario || scenario.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '场景不存在' });
      }

      // 考核模式：窗口校验 + 补考冷却
      if (mode === 'exam') {
        if (!examWindowId) return reply.code(400).send({ error: 'exam 模式必须提供 examWindowId' });
        const window = await store.getExamWindow(examWindowId);
        if (!window) return reply.code(404).send({ error: '考核窗口不存在' });
        if (window.status !== 'open') return reply.code(409).send({ error: '考核窗口未开放' });
        const nowMs = Date.now();
        if (nowMs < new Date(window.startsAt).getTime() || nowMs > new Date(window.endsAt).getTime()) {
          return reply.code(409).send({ error: '当前不在考核时间范围内' });
        }
        if (!window.userIds.includes(request.userId)) {
          return reply.code(403).send({ error: '你不在本窗口考核名单内' });
        }
        if (!window.scenarioIds.includes(scenarioId)) {
          return reply.code(400).send({ error: '该场景不在本窗口考核范围内' });
        }
        // 监考规则：单场景最大尝试次数
        const maxAttempts = window.proctoring?.maxAttemptsPerScenario;
        if (maxAttempts !== undefined) {
          const attempts = (
            await store.listSessions({ userId: request.userId, examWindowId })
          ).filter((s) => s.scenarioId === scenarioId && s.status !== 'abandoned').length;
          if (attempts >= maxAttempts) {
            return reply.code(409).send({ error: '该场景考核次数已用完' });
          }
        }
        const failedCerts = (await store.listCertRecords({ userId: request.userId, examWindowId }))
          .filter((c) => !c.passed)
          .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
        const lastFailed = failedCerts[0];
        if (lastFailed) {
          const nextRetakeAt = new Date(
            new Date(lastFailed.issuedAt).getTime() + window.retakeCooldownDays * 24 * 60 * 60 * 1000
          ).toISOString();
          if (nowMs < new Date(nextRetakeAt).getTime()) {
            return reply.code(409).send({ error: '补考冷却期内，暂不能再次考核', nextRetakeAt });
          }
        }
      }

      const runtime = await loadRuntime(ctx, scenario);
      if (!runtime) return reply.code(500).send({ error: '场景对应的 persona 配置缺失' });
      const { personaConfig, bundle, drillScript } = runtime;

      // 演练开场：有剧本按剧本确定性判定谁先开口，判定不了由 LLM 按剧本/场景设定决定；学员先开口则不留客户开场白
      const decision = await decideOpening(gateway, bundle, !!drillScript, drillScript?.content);
      const openingText =
        decision.firstSpeaker === 'persona'
          ? decision.openingLine ??
            (await new PersonaActor(gateway.forTask('actor')).reply(
              bundle,
              bandFor(bundle.dynamics.baseArousal, bundle.behaviorBands),
              [],
              coachIntensity
            ))
          : undefined;
      const initialBand = bandFor(bundle.dynamics.baseArousal, bundle.behaviorBands);

      const prevCompleted = (await store.listSessions({ userId: request.userId, scenarioId }))
        .filter((s) => s.status === 'completed')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

      const now = new Date().toISOString();
      // 客户先开口：开场白作第 1 轮；学员先开口：transcript 为空，等待学员发起
      const openingTurn: TranscriptTurn | undefined = openingText
        ? {
            seq: 1,
            speaker: 'persona',
            text: openingText,
            at: now,
            emotion: { arousal: bundle.dynamics.baseArousal, bandKey: initialBand.key },
          }
        : undefined;
      const session: Session = {
        id: randomUUID(),
        tenantId: request.tenantId,
        userId: request.userId,
        scenarioId,
        mode,
        status: 'active',
        transcript: openingTurn ? [openingTurn] : [],
        emotionTrace: openingTurn
          ? [{ seq: 1, arousal: bundle.dynamics.baseArousal, bandKey: initialBand.key, at: now }]
          : [],
        hintsUsed: 0,
        prevSessionId: prevCompleted?.id,
        examWindowId: mode === 'exam' ? examWindowId : undefined,
        coachIntensity,
        startedAt: now,
      };
      await store.createSession(session);

      const existingTask = await store.getScenarioTask(request.userId, scenarioId);
      await store.upsertScenarioTask({
        ...existingTask,
        userId: request.userId,
        scenarioId,
        // 已 passed 的任务开新练习不回退状态（防止 abandoned 局把通过状态冲掉）
        status: existingTask?.status === 'passed' ? 'passed' : 'in_progress',
        lastSessionId: session.id,
      });

      void store.appendEvent(
        mkEvent(EventTypes.SESSION_STARTED, {
          tenantId: session.tenantId,
          sessionId: session.id,
          userId: session.userId,
          payload: { scenarioId, mode },
        })
      );

      return reply.code(201).send({
        session,
        persona: {
          name: personaConfig.name,
          age: personaConfig.age,
          occupation: personaConfig.occupation,
          background: personaConfig.background,
          avatar: personaConfig.avatar,
        },
        scenario: {
          name: scenario.name,
          durationMinutes: scenario.durationMinutes,
          coverageTopics: scenario.coverageTopics,
          description: scenario.description,
          sceneType: scenario.sceneType,
          script: scenario.script,
          participants: scenario.participants,
        },
        remainingSeconds: remainingSeconds(session, scenario, await effectiveCountdownSeconds(store, scenario)),
      });
    }
  );

  // 会话详情 + 剩余时间（含 persona/场景信息，供刷新页面后恢复对练）
  app.get<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }
    const scenario = await store.getScenario(session.scenarioId);
    const personaConfig = scenario
      ? await store.getPersonaConfig(scenario.personaConfigId)
      : undefined;
    return {
      session,
      persona: personaConfig
        ? {
            name: personaConfig.name,
            age: personaConfig.age,
            occupation: personaConfig.occupation,
            background: personaConfig.background,
            avatar: personaConfig.avatar,
          }
        : null,
      scenario: scenario
        ? {
            name: scenario.name,
            durationMinutes: scenario.durationMinutes,
            coverageTopics: scenario.coverageTopics,
            description: scenario.description,
            sceneType: scenario.sceneType,
            script: scenario.script,
            participants: scenario.participants,
          }
        : null,
      remainingSeconds: scenario
        ? remainingSeconds(session, scenario, await effectiveCountdownSeconds(store, scenario))
        : null,
    };
  });

  // 学员发言一轮：情绪更新 + persona 回复
  app.post<{ Params: { id: string }; Body: { text: string } }>(
    '/sessions/:id/turns',
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }
      if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });
      if (session.pausedAt) return reply.code(409).send({ error: '会话已暂停，请先继续' });
      const text = request.body?.text?.trim();
      if (!text) return reply.code(400).send({ error: 'text 必填' });

      const scenario = await store.getScenario(session.scenarioId);
      if (!scenario) return reply.code(404).send({ error: '场景已被删除' });

      try {
        const result = await runTurn(ctx, session, scenario, text);
        if (!result) return reply.code(500).send({ error: '场景对应的 persona 配置缺失' });
        return result;
      } catch (err) {
        request.log.error({ err, sessionId: request.params.id, text: text.slice(0, 100) }, 'runTurn 异常');
        return reply.code(500).send({ error: err instanceof Error ? err.message : '服务器内部错误' });
      }
    }
  );

  // 教练提示（仅 practice，最多 3 次）
  app.post<{ Params: { id: string } }>('/sessions/:id/hint', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });
    if (session.pausedAt) return reply.code(409).send({ error: '会话已暂停，请先继续' });
    if (session.mode !== 'practice') return reply.code(400).send({ error: '仅 practice 模式可用提示' });
    if (session.hintsUsed >= MAX_HINTS) return reply.code(409).send({ error: '提示次数已用完' });

    const scenario = await store.getScenario(session.scenarioId);
    const transcriptText = session.transcript
      .map((t) => `[${t.seq}] ${t.speaker === 'trainee' ? '学员' : t.speaker === 'persona' ? '客户' : '教练'}：${t.text}`)
      .join('\n');

    const scenarioLines: string[] = [];
    if (scenario) {
      scenarioLines.push(`本场场景：${scenario.name}`);
      if (scenario.methodology) scenarioLines.push(`销售方法论：${scenario.methodology}`);
      if (scenario.script?.purpose) scenarioLines.push(`本场目标：${scenario.script.purpose}`);
      if (scenario.script?.assessmentPoints && scenario.script.assessmentPoints.length > 0) {
        scenarioLines.push(`主要考核点：${scenario.script.assessmentPoints.join('、')}`);
      }
      const topics = scenario.coverageTopics ?? [];
      if (topics.length > 0) {
        const traineeAll = session.transcript
          .filter((t) => t.speaker === 'trainee')
          .map((t) => t.text)
          .join('\n');
        const hits = topics.filter((t) => traineeAll.includes(t));
        const misses = topics.filter((t) => !traineeAll.includes(t));
        if (hits.length > 0) scenarioLines.push(`话题已覆盖：${hits.join('、')}`);
        if (misses.length > 0) scenarioLines.push(`话题未覆盖：${misses.join('、')}（建议优先往未覆盖话题引导）`);
      }
    }

    const result = await gateway.forTask('judge').chat([
      {
        role: 'user',
        content: [
          '你是销售教练。结合本场场景配置与以下对话，给学员一句不超过40字的下一步话术建议。',
          ...scenarioLines,
          '',
          transcriptText,
        ].join('\n'),
      },
    ]);

    const hintTurn: TranscriptTurn = {
      seq: session.transcript.length + 1,
      speaker: 'coach',
      text: result.content,
      at: new Date().toISOString(),
      isHint: true,
    };
    const hintsUsed = session.hintsUsed + 1;
    await store.updateSession(session.id, {
      transcript: [...session.transcript, hintTurn],
      hintsUsed,
    });

    void store.appendEvent(
      mkEvent(EventTypes.SESSION_HINT_USED, {
        tenantId: session.tenantId,
        sessionId: session.id,
        userId: session.userId,
        payload: { seq: hintTurn.seq, hintsUsed },
      })
    );

    return { hintTurn, hintsRemaining: MAX_HINTS - hintsUsed };
  });

  // AI 教练开场白（进入练习页时调用）：介绍本场练习内容并询问是否准备好。
  // coachOpening 首次生成后缓存在会话上；query voice=1 时附带教练与 persona 开场白的 TTS 音频（base64 wav）。
  app.post<{ Params: { id: string }; Querystring: { voice?: string } }>(
    '/sessions/:id/opening',
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }
      if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });
      const scenario = await store.getScenario(session.scenarioId);
      if (!scenario) return reply.code(404).send({ error: '场景已被删除' });
      const personaConfig = await store.getPersonaConfig(scenario.personaConfigId);
      if (!personaConfig) return reply.code(500).send({ error: '场景对应的 persona 配置缺失' });

      let coachText = session.coachOpening;
      if (!coachText) {
        const result = await gateway.forTask('judge').chat([
          {
            role: 'user',
            content: [
              '你是销售培训 AI 教练。一场销售对练即将开始，请对学员说一段开场白（不超过 80 字）：',
              '先打招呼，再简要介绍本场练习内容与规则（场景目标、限时、对方人设），最后问学员"准备好了吗？"。',
              `场景：${scenario.name}${scenario.personaTitle ? `（${scenario.personaTitle}）` : ''}`,
              `限时：${scenario.durationMinutes} 分钟`,
              ...(scenario.script?.purpose ? [`本场目标：${scenario.script.purpose}`] : []),
              ...(scenario.script?.executionOrder ? [`剧本流程：${scenario.script.executionOrder}`] : []),
              `对方：${personaConfig.name}${personaConfig.occupation ? `，${personaConfig.occupation}` : ''}。背景：${personaConfig.background}`,
              '只输出开场白本身，不要加任何解释或引号。',
            ].join('\n'),
          },
        ]);
        coachText = result.content.trim();
        await store.updateSession(session.id, { coachOpening: coachText });
      }

      let coachAudio: string | undefined;
      let personaAudio: string | undefined;
      if (request.query.voice === '1') {
        const ttsProfile = await personaVoice(store, scenario.id, scenario.personaConfigId, request.log);
        coachAudio = (await ctx.speech.tts.synthesize(coachText, { ...ttsProfile })).audio.toString('base64');
        const personaOpening = session.transcript.find((t) => t.speaker === 'persona');
        if (personaOpening) {
          personaAudio = (
            await ctx.speech.tts.synthesize(personaOpening.text, {
              arousal: personaOpening.emotion?.arousal,
              ...ttsProfile,
            })
          ).audio.toString('base64');
        }
      }

      return { coachText, coachAudio, personaAudio };
    }
  );

  // 暂停会话：冻结倒计时与对话（考核模式不允许暂停）
  app.post<{ Params: { id: string } }>('/sessions/:id/pause', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });
    if (session.mode === 'exam') return reply.code(400).send({ error: '考核模式不支持暂停' });
    if (session.pausedAt) return reply.code(409).send({ error: '会话已处于暂停中' });

    const pausedAt = new Date().toISOString();
    await store.updateSession(session.id, { pausedAt });
    const scenario = await store.getScenario(session.scenarioId);
    return {
      pausedAt,
      remainingSeconds: scenario
        ? remainingSeconds({ ...session, pausedAt }, scenario, await effectiveCountdownSeconds(store, scenario))
        : null,
    };
  });

  // 继续会话：累计暂停时长并解冻
  app.post<{ Params: { id: string } }>('/sessions/:id/resume', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });
    if (!session.pausedAt) return reply.code(409).send({ error: '会话未在暂停中' });

    const pausedMs =
      (session.pausedMs ?? 0) + (Date.now() - new Date(session.pausedAt).getTime());
    const updated: Session = { ...session, pausedMs, pausedAt: undefined };
    await store.updateSession(session.id, { pausedMs, pausedAt: undefined });
    const scenario = await store.getScenario(session.scenarioId);
    return {
      remainingSeconds: scenario
        ? remainingSeconds(updated, scenario, await effectiveCountdownSeconds(store, scenario))
        : null,
    };
  });

  // 进入正式对练（live）：从此时起倒计时开始；开场/新手指引阶段不消耗时长。幂等，重复调用不重置
  app.post<{ Params: { id: string } }>('/sessions/:id/live-start', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

    const updated: Session = session.liveStartedAt
      ? session
      : { ...session, liveStartedAt: new Date().toISOString(), pausedMs: 0 };
    if (!session.liveStartedAt) {
      // 开场/指引阶段的累计暂停时长不计入对练倒计时，一并清零
      await store.updateSession(session.id, { liveStartedAt: updated.liveStartedAt, pausedMs: 0 });
    }
    const scenario = await store.getScenario(session.scenarioId);
    // 第4步演练旁白+目标：无新手指引流程配置时为 null
    const guidance = await store.getScenarioGuidance(session.scenarioId).catch(() => undefined);
    return {
      remainingSeconds: scenario
        ? remainingSeconds(updated, scenario, await effectiveCountdownSeconds(store, scenario))
        : null,
      liveIntro: guidance?.liveIntro ?? null,
    };
  });

  // ---- 考题答题 ----
  app.post<{ Params: { id: string }; Body: { quizId?: string; answer?: string[] } }>(
    '/sessions/:id/quiz-answer',
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }
      if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });
      const { quizId, answer } = request.body ?? {};
      if (!quizId) return reply.code(400).send({ error: 'quizId 必填' });
      if (!answer || !Array.isArray(answer)) return reply.code(400).send({ error: 'answer 必填且为数组' });

      const allQuizzes = await store.listQuizQuestions(session.tenantId);
      const quiz = allQuizzes.find((q) => q.id === quizId);
      if (!quiz) return reply.code(404).send({ error: '考题不存在' });

      let correct = false;
      if (quiz.type === 'single_choice' || quiz.type === 'true_false') {
        correct = answer[0] === (quiz.correctAnswer as string[])[0];
      } else if (quiz.type === 'multi_choice') {
        const correctSet = new Set((quiz.correctAnswer as string[]).sort());
        const answerSet = new Set([...answer].sort());
        correct = correctSet.size === answerSet.size && [...correctSet].every((v) => answerSet.has(v));
      } else if (quiz.type === 'short_answer' || quiz.type === 'scenario_pick') {
        const referencePoints = quiz.referencePoints ?? [];
        const userAnswer = answer.join('；');
        const judgePrompt = [
          `你是评分老师。学员回答简答题。`,
          `题目：${quiz.prompt}`,
          `参考要点：${referencePoints.join('；')}`,
          `学员答案：${userAnswer}`,
          '',
          '请判断学员答案是否命中了大部分参考要点（命中>=60%算正确）。',
          '只输出 JSON：{"correct":true或false,"rationale":"判定理由"}',
        ].join('\n');
        try {
          const judgeResult = await gateway.forTask('judge').chat(
            [{ role: 'user', content: judgePrompt }],
            { jsonMode: true }
          );
          const parsed = JSON.parse(judgeResult.content) as { correct?: boolean };
          correct = !!parsed.correct;
        } catch {
          correct = false;
        }
      }

      const earnedScore = correct ? quiz.score : 0;
      const atTurnSeq = session.transcript.length;
      const quizResult: QuizResult = {
        quizId,
        answer,
        correct,
        score: earnedScore,
        maxScore: quiz.score,
        atTurnSeq,
        answeredAt: new Date().toISOString(),
      };
      const quizResults = [...(session.quizResults ?? []), quizResult];
      await store.updateSession(session.id, { quizResults });

      return {
        correct,
        score: earnedScore,
        explanation: quiz.explanation,
        correctAnswer: quiz.correctAnswer,
      };
    }
  );

  // 监考事件上报（仅 exam 会话）：切屏计数，达到上限自动交卷
  app.post<{ Params: { id: string }; Body: { kind?: string } }>(
    '/sessions/:id/proctor-events',
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }
      if (session.mode !== 'exam') {
        return reply.code(400).send({ error: '仅 exam 模式会话接受监考事件' });
      }
      if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });
      const kind = request.body?.kind;
      if (kind !== 'tab_switch') return reply.code(400).send({ error: "kind 仅支持 'tab_switch'" });

      await store.appendEvent(
        mkEvent(EventTypes.SESSION_PROCTOR_EVENT, {
          tenantId: session.tenantId,
          sessionId: session.id,
          userId: session.userId,
          payload: { kind, seq: session.transcript.length },
        })
      );

      const count = (
        await store.listEvents({ sessionId: session.id, type: EventTypes.SESSION_PROCTOR_EVENT })
      ).filter((e) => e.payload.kind === 'tab_switch').length;

      const window = session.examWindowId
        ? await store.getExamWindow(session.examWindowId)
        : undefined;
      const maxTabSwitches = window?.proctoring?.maxTabSwitches;
      if (maxTabSwitches !== undefined && count >= maxTabSwitches) {
        const result = await finalizeSession(session, ctx, request.log);
        if (!result) return reply.code(500).send({ error: '场景缺失' });
        return { ended: true, reason: 'tab_switch_limit' };
      }
      return { ended: false, count };
    }
  );

  // 结束会话并评分
  app.post<{ Params: { id: string } }>('/sessions/:id/end', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

    request.log.info(
      { sessionId: session.id, turns: session.transcript.length, traineeTurns: session.transcript.filter((t) => t.speaker === 'trainee').length },
      'POST /sessions/:id/end：收到结束请求，开始评分（逐项 LLM 评分可能较慢）'
    );
    try {
      const result = await finalizeSession(session, ctx, request.log);
      if (!result) return reply.code(500).send({ error: '场景缺失' });
      return result;
    } catch (err) {
      // finalizeSession 内部已把会话回滚为 active，学员可重新 end 重试
      request.log.error(
        { sessionId: session.id, err },
        'POST /sessions/:id/end：评分异常（会话已回滚为 active，可重试）'
      );
      return reply.code(500).send({ error: err instanceof Error ? err.message : '评分失败' });
    }
  });
}
