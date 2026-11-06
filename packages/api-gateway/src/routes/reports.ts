import type { FastifyInstance } from 'fastify';
import { buildImprovementGoal, confidenceIndexOf, deductionPoints } from '@grasp-mvp/scoring-engine';
import type { RouteContext } from '../ctx.js';
import { ensureSessionFinalization, getFinalizationError } from './sessions.js';

export async function reportsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 复盘页聚合：会话 + 报告 + 场景/角色信息 + 前次成绩
  app.get<{ Params: { id: string } }>('/sessions/:id/review', async (request, reply) => {
    const startedAt = Date.now();
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) {
      return reply.code(404).send({ error: '会话不存在' });
    }

    // 会话被放弃（对话不足 2 轮）—— 不生成报告
    if (session.status === 'abandoned') {
      request.log.info(
        { sessionId: session.id, status: session.status, ms: Date.now() - startedAt },
        'GET /sessions/:id/review：会话已放弃，返回空报告'
      );
      return reply.code(200).send({
        session,
        report: null,
        skipped: true,
        scenario: null,
        persona: null,
        prevScore: null,
      });
    }

    const report = await store.getScoreReportBySession(session.id);
    if (!report) {
      const scoringError = getFinalizationError(session.id);
      if (!scoringError) ensureSessionFinalization(session, ctx, request.log);
      request.log.info(
        { sessionId: session.id, status: session.status, scoring: !scoringError, ms: Date.now() - startedAt },
        'GET /sessions/:id/review：评分尚未完成'
      );
      return {
        session,
        report: null,
        scoring: !scoringError,
        scoringError: scoringError ?? null,
        skipped: false,
        scenario: null,
        persona: null,
        prevScore: null,
      };
    }

    const deduction = deductionPoints(report.items);
    const reportWithGoal = {
      ...report,
      baseScore: report.baseScore ?? Math.min(100, report.totalScore + deduction),
      confidenceIndex: report.confidenceIndex ?? confidenceIndexOf(report.items),
      improvementGoal: report.improvementGoal ?? buildImprovementGoal(
        report.items,
        await store.listScoreItemDefs(session.tenantId),
        report.violations,
        report.baseScore ?? Math.min(100, report.totalScore + deduction)
      ),
    };

    const scenario = await store.getScenario(session.scenarioId);
    const personaConfig = scenario
      ? await store.getPersonaConfig(scenario.personaConfigId)
      : undefined;

    let prevScore: number | null = null;
    if (session.prevSessionId) {
      const prevReport = await store.getScoreReportBySession(session.prevSessionId);
      prevScore = prevReport?.totalScore ?? null;
    }

    request.log.info(
      { sessionId: session.id, status: session.status, totalScore: report.totalScore, ms: Date.now() - startedAt },
      'GET /sessions/:id/review：命中报告'
    );
    return {
      session,
      report: reportWithGoal,
      scenario: scenario
        ? { id: scenario.id, name: scenario.name, passScore: scenario.successCriteria.passScore }
        : null,
      persona: personaConfig
        ? {
            name: personaConfig.name,
            age: personaConfig.age,
            occupation: personaConfig.occupation,
            background: personaConfig.background,
          }
        : null,
      prevScore,
    };
  });
}
