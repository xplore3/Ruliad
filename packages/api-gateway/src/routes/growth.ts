import type { FastifyInstance } from 'fastify';
import type { RouteContext } from '../ctx.js';

export async function growthRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 成长档案：技能曲线 + 历史成绩 + 口头禅趋势
  app.get('/growth', async (request) => {
    const userId = request.userId;

    const states = await store.listUserSkillStates(userId);
    const skillPoints = await store.listSkillPoints(request.tenantId);
    const nameBySkill = new Map(skillPoints.map((sp) => [sp.id, sp.name]));
    const skills = states.map((s) => ({
      skillPointId: s.skillPointId,
      name: nameBySkill.get(s.skillPointId) ?? s.skillPointId,
      currentLevel: s.currentLevel,
      history: s.history,
    }));

    const completed = (await store.listSessions({ userId }))
      .filter((s) => s.status === 'completed')
      .sort((a, b) => (a.endedAt ?? a.startedAt).localeCompare(b.endedAt ?? b.startedAt));

    const sessions: Array<{
      sessionId: string;
      scenarioName: string | null;
      mode: string;
      totalScore: number;
      passed: boolean;
      at: string;
      prevSessionId?: string;
    }> = [];
    const fillerTrend: Array<{
      sessionId: string;
      at: string;
      fillers: Record<string, number>;
    }> = [];

    for (const s of completed) {
      const report = await store.getScoreReportBySession(s.id);
      if (!report) continue;
      const scenario = await store.getScenario(s.scenarioId);
      const at = s.endedAt ?? s.startedAt;
      sessions.push({
        sessionId: s.id,
        scenarioName: scenario?.name ?? null,
        mode: s.mode,
        totalScore: report.totalScore,
        passed: report.passed,
        at,
        prevSessionId: s.prevSessionId,
      });
      fillerTrend.push({ sessionId: s.id, at, fillers: report.ruleStats.fillerCounts });
    }

    // 已获认证：本人通过的 CertRecord（倒序），附窗口名
    const passedCerts = (await store.listCertRecords({ userId }))
      .filter((c) => c.passed)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    const certs = await Promise.all(
      passedCerts.map(async (c) => {
        const window = await store.getExamWindow(c.examWindowId);
        return {
          id: c.id,
          examWindowId: c.examWindowId,
          examWindowName: window?.name ?? null,
          totalScore: c.totalScore,
          issuedAt: c.issuedAt,
        };
      })
    );

    return { skills, sessions, fillerTrend, certs };
  });
}
