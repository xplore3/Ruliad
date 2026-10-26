import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CertRecord, ExamWindow, ExamWindowStatus } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';
import { requireRoles } from '../auth.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type MyStatus = 'not_started' | 'in_progress' | 'passed' | 'failed' | 'cooldown';

/** 学员在某个窗口下的状态判定：证书优先，其次会话进度，failed 时叠加补考冷却 */
async function myWindowState(
  ctx: RouteContext,
  userId: string,
  window: ExamWindow
): Promise<{ myStatus: MyStatus; myBestScore: number | null; nextRetakeAt: string | null; myCert: CertRecord | null }> {
  const { store } = ctx;
  const sessions = await store.listSessions({ userId, examWindowId: window.id });
  const certs = await store.listCertRecords({ userId, examWindowId: window.id });
  const sortedCerts = [...certs].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const myCert = sortedCerts[0] ?? null;
  const myBestScore = certs.length > 0 ? Math.max(...certs.map((c) => c.totalScore)) : null;

  const lastFailed = sortedCerts.find((c) => !c.passed);
  const nextRetakeAt = lastFailed
    ? new Date(new Date(lastFailed.issuedAt).getTime() + window.retakeCooldownDays * DAY_MS).toISOString()
    : null;

  let myStatus: MyStatus;
  if (certs.some((c) => c.passed)) {
    myStatus = 'passed';
  } else if (lastFailed) {
    myStatus = nextRetakeAt && Date.now() < new Date(nextRetakeAt).getTime() ? 'cooldown' : 'failed';
  } else if (sessions.length > 0) {
    myStatus = 'in_progress';
  } else {
    myStatus = 'not_started';
  }
  return { myStatus, myBestScore, nextRetakeAt, myCert };
}

interface UserProgress {
  userId: string;
  userName: string;
  completedScenarios: number;
  totalScenarios: number;
  bestScore: number | null;
  passed: boolean;
  /** 最新一张通过证书的签发时间 */
  passedAt: string | null;
  status: 'completed' | 'in_progress' | 'not_started';
}

/** 管理端监控/导出共用：逐名单用户聚合进度与通过情况 */
async function buildProgress(ctx: RouteContext, window: ExamWindow): Promise<UserProgress[]> {
  const { store } = ctx;
  return Promise.all(
    window.userIds.map(async (userId) => {
      const user = await store.getUser(userId);
      const sessions = await store.listSessions({ userId, examWindowId: window.id });
      const completedScenarios = new Set(
        sessions.filter((s) => s.status === 'completed').map((s) => s.scenarioId)
      ).size;
      const certs = await store.listCertRecords({ userId, examWindowId: window.id });
      const bestScore = certs.length > 0 ? Math.max(...certs.map((c) => c.totalScore)) : null;
      const passedCerts = certs
        .filter((c) => c.passed)
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
      const status =
        completedScenarios >= window.scenarioIds.length && window.scenarioIds.length > 0
          ? ('completed' as const)
          : sessions.length > 0
            ? ('in_progress' as const)
            : ('not_started' as const);
      return {
        userId,
        userName: user?.name ?? userId,
        completedScenarios,
        totalScenarios: window.scenarioIds.length,
        bestScore,
        passed: passedCerts.length > 0,
        passedAt: passedCerts[0]?.issuedAt ?? null,
        status,
      };
    })
  );
}

/** CSV 单元格转义 */
function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function examsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 学员视角：窗口列表 + 我的状态
  app.get('/exam-windows', async (request) => {
    const windows = await store.listExamWindows(request.tenantId);
    const items = await Promise.all(
      windows.map(async (w) => {
        const scenarios = await Promise.all(w.scenarioIds.map((id) => store.getScenario(id)));
        const scenarioNames = scenarios.map((s) => s?.name ?? null).filter((n) => n !== null);
        const state = await myWindowState(ctx, request.userId, w);
        return { ...w, scenarioNames, ...state };
      })
    );
    return { windows: items };
  });

  // 管理：创建考核窗口（初始 draft）
  app.post<{
    Body: {
      name: string;
      startsAt: string;
      endsAt: string;
      scenarioIds: string[];
      userIds: string[];
      retakeCooldownDays?: number;
      proctoring?: ExamWindow['proctoring'];
    };
  }>('/exam-windows', { preHandler: requireRoles('admin') }, async (request, reply) => {
    const { name, startsAt, endsAt, scenarioIds, userIds, retakeCooldownDays, proctoring } =
      request.body ?? {};
    if (!name || !startsAt || !endsAt || !scenarioIds?.length || !userIds?.length) {
      return reply.code(400).send({ error: 'name / startsAt / endsAt / scenarioIds / userIds 必填' });
    }
    if (proctoring) {
      const { maxAttemptsPerScenario, maxTabSwitches } = proctoring;
      for (const v of [maxAttemptsPerScenario, maxTabSwitches]) {
        if (v !== undefined && (!Number.isInteger(v) || v <= 0)) {
          return reply
            .code(400)
            .send({ error: 'proctoring.maxAttemptsPerScenario / maxTabSwitches 须为正整数' });
        }
      }
    }
    const window: ExamWindow = {
      id: randomUUID(),
      tenantId: request.tenantId,
      name,
      startsAt,
      endsAt,
      scenarioIds,
      userIds,
      status: 'draft',
      retakeCooldownDays: retakeCooldownDays ?? 7,
      ...(proctoring ? { proctoring } : {}),
    };
    await store.upsertExamWindow(window);
    return reply.code(201).send(window);
  });

  // 学员：跨窗口历史成绩（按签发时间倒序，附加窗口名）
  app.get('/my-cert-history', async (request) => {
    const certs = await store.listCertRecords({ userId: request.userId });
    const sorted = [...certs].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    return Promise.all(
      sorted.map(async (c) => {
        const window = await store.getExamWindow(c.examWindowId);
        return { ...c, examWindowName: window?.name ?? null };
      })
    );
  });

  // 管理：窗口状态流转
  app.post<{ Params: { id: string }; Body: { status: ExamWindowStatus } }>(
    '/exam-windows/:id/status',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const window = await store.getExamWindow(request.params.id);
      if (!window) return reply.code(404).send({ error: '考核窗口不存在' });
      const { status } = request.body ?? {};
      if (status !== 'open' && status !== 'closed' && status !== 'published') {
        return reply.code(400).send({ error: "status 必须为 'open' / 'closed' / 'published'" });
      }
      const updated: ExamWindow = { ...window, status };
      await store.upsertExamWindow(updated);
      return updated;
    }
  );

  // 管理：进度监控（只有进度，无对话明细）
  app.get<{ Params: { id: string } }>(
    '/exam-windows/:id/monitor',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const window = await store.getExamWindow(request.params.id);
      if (!window) return reply.code(404).send({ error: '考核窗口不存在' });

      const progress = await buildProgress(ctx, window);
      return { window, progress };
    }
  );

  // 管理：考核结果导出 CSV（BOM 头防 Excel 中文乱码）
  app.get<{ Params: { id: string } }>(
    '/exam-windows/:id/export',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const window = await store.getExamWindow(request.params.id);
      if (!window) return reply.code(404).send({ error: '考核窗口不存在' });

      const progress = await buildProgress(ctx, window);
      const statusLabels: Record<UserProgress['status'], string> = {
        completed: '已完成',
        in_progress: '进行中',
        not_started: '未开始',
      };
      const header = 'userId,姓名,完成场景数/总场景数,最好成绩,是否通过,证书时间,状态';
      const rows = progress.map((p) =>
        [
          csvCell(p.userId),
          csvCell(p.userName),
          csvCell(`${p.completedScenarios}/${p.totalScenarios}`),
          csvCell(p.bestScore),
          csvCell(p.passed ? '是' : '否'),
          csvCell(p.passedAt),
          csvCell(statusLabels[p.status]),
        ].join(',')
      );
      const csv = '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="exam-${window.id}.csv"`)
        .send(csv);
    }
  );
}
