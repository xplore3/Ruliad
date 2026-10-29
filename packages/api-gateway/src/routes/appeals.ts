import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { EventTypes, type Appeal, type AppealReReview, type AppealTargetType, type ScoreItemResult } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';
import { mkEvent } from '../events.js';
import { requireRoles } from '../auth.js';

function itemSummary(item: ScoreItemResult | undefined) {
  if (!item) return null;
  return {
    itemName: item.itemName,
    levelLabel: item.levelLabel,
    score: item.score,
    quote: item.quote,
    rationale: item.rationale,
    isReference: item.isReference,
  };
}

export async function appealsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway } = ctx;

  // 发起申诉（"我不同意"）
  app.post<{
    Body: {
      sessionId: string;
      targetType?: AppealTargetType;
      scoreItemResultIndex?: number;
      violationIndex?: number;
      reason: string;
    };
  }>('/appeals', async (request, reply) => {
    const { sessionId, reason } = request.body ?? {};
    const targetType: AppealTargetType = request.body?.targetType ?? 'score_item';
    const scoreItemResultIndex = request.body?.scoreItemResultIndex ?? -1;
    const violationIndex = request.body?.violationIndex ?? -1;

    if (!sessionId || !reason) {
      return reply.code(400).send({ error: 'sessionId / reason 必填' });
    }
    const session = await store.getSession(sessionId);
    if (!session) return reply.code(404).send({ error: '会话不存在' });
    const report = await store.getScoreReportBySession(sessionId);
    if (!report) return reply.code(404).send({ error: '评分报告不存在' });

    if (targetType === 'score_item') {
      if (!Number.isInteger(scoreItemResultIndex) || scoreItemResultIndex < 0 || scoreItemResultIndex >= report.items.length) {
        return reply.code(400).send({ error: 'scoreItemResultIndex 超出范围' });
      }
    } else if (targetType === 'violation') {
      if (!Number.isInteger(violationIndex) || violationIndex < 0 || violationIndex >= report.violations.length) {
        return reply.code(400).send({ error: 'violationIndex 超出范围' });
      }
    }

    const appeal: Appeal = {
      id: randomUUID(),
      sessionId,
      targetType,
      scoreItemResultIndex,
      violationIndex,
      userId: request.userId,
      reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await store.createAppeal(appeal);

    void store.appendEvent(
      mkEvent(EventTypes.APPEAL_CREATED, {
        tenantId: session.tenantId,
        sessionId,
        userId: request.userId,
        payload: { appealId: appeal.id, targetType, scoreItemResultIndex, violationIndex, reason },
      })
    );

    // ---- 触发 AI 复评 ----
    try {
      const reReview = await performReReview(appeal, session, report, gateway);
      const updatedAppeal = { ...appeal, reReview };
      await store.updateAppeal(appeal.id, { reReview });
      return reply.code(201).send({ ...updatedAppeal });
    } catch {
      // AI 复评失败不影响申诉创建
      return reply.code(201).send(appeal);
    }
  });

  // 申诉列表（join 评分标准摘要 / 场景名 / 用户名）；trainee 仅能看到本人的申诉
  app.get<{ Querystring: { status?: string } }>('/appeals', async (request) => {
    let appeals = await store.listAppeals({ status: request.query.status });
    if (request.userRole === 'trainee') {
      appeals = appeals.filter((a) => a.userId === request.userId);
    }
    const items = await Promise.all(
      appeals.map(async (a) => {
        const session = await store.getSession(a.sessionId);
        const scenario = session ? await store.getScenario(session.scenarioId) : undefined;
        const user = await store.getUser(a.userId);
        const report = await store.getScoreReportBySession(a.sessionId);
        const violation = a.targetType === 'violation' && a.violationIndex >= 0
          ? report?.violations[a.violationIndex] ?? null
          : null;
        return {
          ...a,
          scenarioName: scenario?.name ?? null,
          userName: user?.name ?? null,
          scoreItemResult: itemSummary(report?.items[a.scoreItemResultIndex]),
          violation,
        };
      })
    );
    return { appeals: items };
  });

  // 申诉详情 + 完整转写 + 被申诉评分标准
  app.get<{ Params: { id: string } }>('/appeals/:id', async (request, reply) => {
    const appeal = await store.getAppeal(request.params.id);
    if (!appeal) return reply.code(404).send({ error: '申诉不存在' });
    const session = await store.getSession(appeal.sessionId);
    const report = await store.getScoreReportBySession(appeal.sessionId);
    return {
      appeal,
      session,
      scoreItemResult: report?.items[appeal.scoreItemResultIndex] ?? null,
      violation: appeal.targetType === 'violation' && appeal.violationIndex >= 0
        ? report?.violations[appeal.violationIndex] ?? null
        : null,
    };
  });

  // 申诉裁决：更新状态 + 写校准事件
  app.post<{ Params: { id: string }; Body: { status: 'upheld' | 'rejected'; resolution: string } }>(
    '/appeals/:id/resolve',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const appeal = await store.getAppeal(request.params.id);
      if (!appeal) return reply.code(404).send({ error: '申诉不存在' });
      const { status, resolution } = request.body ?? {};
      if (status !== 'upheld' && status !== 'rejected') {
        return reply.code(400).send({ error: "status 必须为 'upheld' 或 'rejected'" });
      }
      if (!resolution) return reply.code(400).send({ error: 'resolution 必填' });

      const resolvedAt = new Date().toISOString();
      await store.updateAppeal(appeal.id, { status, resolution, resolvedAt });

      const report = await store.getScoreReportBySession(appeal.sessionId);
      const item = report?.items[appeal.scoreItemResultIndex];
      const session = await store.getSession(appeal.sessionId);
      await store.saveCalibrationEvent({
        id: randomUUID(),
        scoreItemId: item?.itemId,
        kind: status === 'upheld' ? 'appeal_upheld' : 'appeal_rejected',
        note: resolution,
        sourceSessionId: appeal.sessionId,
        createdAt: resolvedAt,
      });

      void store.appendEvent(
        mkEvent(EventTypes.APPEAL_RESOLVED, {
          tenantId: session?.tenantId,
          sessionId: appeal.sessionId,
          userId: appeal.userId,
          payload: { appealId: appeal.id, status, resolution },
        })
      );
      void store.appendEvent(
        mkEvent(EventTypes.CALIBRATION_RECORDED, {
          tenantId: session?.tenantId,
          sessionId: appeal.sessionId,
          userId: appeal.userId,
          payload: {
            kind: status === 'upheld' ? 'appeal_upheld' : 'appeal_rejected',
            scoreItemId: item?.itemId,
          },
        })
      );

      return store.getAppeal(appeal.id);
    }
  );
}

/* ==================== AI 复评逻辑 ==================== */

async function performReReview(
  appeal: Appeal,
  session: import('@grasp-mvp/core').Session,
  report: import('@grasp-mvp/core').ScoreReport,
  gateway: import('@grasp-mvp/core').LLMGateway
): Promise<AppealReReview> {
  const transcriptLines = session.transcript
    .filter((t) => t.speaker !== 'coach')
    .map((t) => `[${t.seq}] ${t.speaker === 'trainee' ? '学员' : '客户'}：${t.text}`)
    .join('\n');

  let targetDescription = '';
  if (appeal.targetType === 'score_item' && appeal.scoreItemResultIndex >= 0) {
    const item = report.items[appeal.scoreItemResultIndex];
    if (item) {
      targetDescription = [
        `评分标准：${item.itemName}`,
        `档位：${item.levelLabel}（${item.score}分）`,
        `判定依据：${item.rationale}`,
        `引用原文：「${item.quote}」`,
      ].join('\n');
    }
  } else if (appeal.targetType === 'violation' && appeal.violationIndex >= 0) {
    const violation = report.violations[appeal.violationIndex];
    if (violation) {
      targetDescription = [
        `违规类型：${violation.kind}`,
        `违规详情：${violation.detail}`,
        `是否一票否决：${violation.fatal ? '是' : '否'}`,
      ].join('\n');
    }
  } else {
    targetDescription = `总分：${report.totalScore}，达标：${report.passed ? '是' : '否'}`;
  }

  const prompt = [
    '你是复评裁判。学员对 AI 评分提出了异议，请重新审视评分是否合理。',
    '',
    '【对话记录】',
    transcriptLines,
    '',
    '【被申诉的评分/分析】',
    targetDescription,
    '',
    '【学员的异议理由】',
    appeal.reason,
    '',
    '请重新审视原评分是否合理。只输出 JSON：',
    '{"verdict":"agree"或"disagree"或"partial","rationale":"复评理由","suggestedScore":数字或null}',
    'verdict 含义：agree=维持原评 | disagree=支持学员异议（原评有误） | partial=部分支持',
    'suggestedScore 仅在 verdict 为 disagree 或 partial 时给出建议分数，agree 时为 null',
  ].join('\n');

  const result = await gateway.forTask('judge').chat([{ role: 'user', content: prompt }], { jsonMode: true });
  const parsed = JSON.parse(result.content) as { verdict?: string; rationale?: string; suggestedScore?: number | null };

  const verdict = (['agree', 'disagree', 'partial'].includes(parsed.verdict ?? '')
    ? (parsed.verdict as 'agree' | 'disagree' | 'partial')
    : 'agree');

  return {
    verdict,
    rationale: String(parsed.rationale ?? '复评解析失败'),
    suggestedScore: typeof parsed.suggestedScore === 'number' ? parsed.suggestedScore : undefined,
    reviewedAt: new Date().toISOString(),
  };
}
