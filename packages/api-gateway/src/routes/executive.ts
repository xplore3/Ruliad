import type { FastifyInstance } from 'fastify';
import type { ScoreReport, Session } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';
import { examReportsForUsers } from './supervisor.js';

const FILLER_HEAVY_THRESHOLD = 5;

interface SessionReport {
  session: Session;
  report: ScoreReport;
}

/** 全租户所有已完成会话及其评分报告 */
async function allSessionReports(ctx: RouteContext, tenantId: string): Promise<SessionReport[]> {
  const { store } = ctx;
  const sessions = await store.listSessions({ tenantId });
  const out: SessionReport[] = [];
  for (const s of sessions) {
    if (s.status !== 'completed') continue;
    const report = await store.getScoreReportBySession(s.id);
    if (report) out.push({ session: s, report });
  }
  return out;
}

/**
 * 合规统计：红线 / 口头禅大户 / 有违规的会话数（数据中心与高管视图共用）。
 * 口径：仅考核（exam）会话 —— 合规风险计数均由确定性规则层在考核中检出。
 */
export async function buildCompliance(ctx: RouteContext, tenantId: string) {
  const pairs = (await allSessionReports(ctx, tenantId)).filter((p) => p.session.mode === 'exam');
  let redlineCount = 0;
  let fillerHeavyCount = 0;
  let sessionsWithViolations = 0;
  for (const { report } of pairs) {
    redlineCount += report.violations.filter((v) => v.kind === 'redline').length;
    const fillerTotal = Object.values(report.ruleStats.fillerCounts).reduce((a, b) => a + b, 0);
    if (fillerTotal >= FILLER_HEAVY_THRESHOLD) fillerHeavyCount += 1;
    if (report.violations.length > 0) sessionsWithViolations += 1;
  }
  return { redlineCount, fillerHeavyCount, sessionsWithViolations };
}

/** 合规风险计数：组织 × 违规类型（exam 会话的红线违规，按会话学员所属组织归集） */
export async function buildComplianceByOrg(ctx: RouteContext, tenantId: string) {
  const { store } = ctx;
  const pairs = (await allSessionReports(ctx, tenantId)).filter((p) => p.session.mode === 'exam');
  const userById = new Map((await store.listUsers(tenantId)).map((u) => [u.id, u]));
  const orgById = new Map((await store.listOrganizations(tenantId)).map((o) => [o.id, o]));

  const counts = new Map<string, { orgName: string; kind: string; count: number }>();
  for (const { session, report } of pairs) {
    const redlines = report.violations.filter((v) => v.kind === 'redline');
    if (redlines.length === 0) continue;
    const org = orgById.get(userById.get(session.userId)?.orgId ?? '');
    const orgName = org?.name ?? '未知组织';
    for (const v of redlines) {
      const key = `${orgName}::${v.detail}`;
      const entry = counts.get(key) ?? { orgName, kind: v.detail, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * 月度达标率趋势（试点组 vs POC 对照组）。
 * 口径：examWindowId 形如 trend-<treatment|control>-<yyyy-MM> 的基线测评会话
 * （seed-history 按设计稿 3–8 月曲线灌入），按报告 createdAt 月份聚合通过率 %。
 */
export async function buildMonthlyTrend(ctx: RouteContext, tenantId: string) {
  const pairs = await allSessionReports(ctx, tenantId);
  const byMonth = new Map<string, { treatment: ScoreReport[]; control: ScoreReport[] }>();
  for (const { session, report } of pairs) {
    const match = session.examWindowId?.match(/^trend-(treatment|control)-(\d{4})-(\d{2})$/);
    if (!match) continue;
    const group = match[1] as 'treatment' | 'control';
    const monthKey = `${match[2]}-${match[3]}`;
    const entry = byMonth.get(monthKey) ?? { treatment: [], control: [] };
    entry[group].push(report);
    byMonth.set(monthKey, entry);
  }
  const pct = (reports: ScoreReport[]) =>
    reports.length === 0
      ? null
      : Math.round((reports.filter((r) => r.passed).length / reports.length) * 100);
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, entry]) => ({
      month: `${Number(monthKey.slice(5))}月`,
      treatment: pct(entry.treatment),
      control: pct(entry.control),
    }));
}

/** 组织 × 技能点热力图（仅基线考核报告：不挂考核窗口的 exam 会话） */
export async function buildOrgHeatmap(ctx: RouteContext, tenantId: string) {
  const { store } = ctx;
  const orgs = await store.listOrganizations(tenantId);
  const users = await store.listUsers(tenantId, 'trainee');
  const skillPoints = await store.listSkillPoints(tenantId);
  const orgHeatmap: Array<{
    orgId: string;
    orgName: string;
    skillPointId: string;
    skillPointName: string;
    passRate: number;
    avgScore: number;
  }> = [];
  for (const org of orgs) {
    const memberIds = users.filter((u) => u.orgId === org.id).map((u) => u.id);
    const reports = (await examReportsForUsers(ctx, memberIds, { baselineOnly: true })).map(
      (r) => r.report
    );
    for (const sp of skillPoints) {
      const withSkill = reports.filter((r) => r.skillScores.some((s) => s.skillPointId === sp.id));
      if (withSkill.length === 0) continue;
      orgHeatmap.push({
        orgId: org.id,
        orgName: org.name,
        skillPointId: sp.id,
        skillPointName: sp.name,
        passRate: withSkill.filter((r) => r.passed).length / withSkill.length,
        avgScore: Math.round(
          withSkill.reduce(
            (sum, r) => sum + (r.skillScores.find((s) => s.skillPointId === sp.id)?.score ?? 0),
            0
          ) / withSkill.length
        ),
      });
    }
  }
  return orgHeatmap;
}

/** 组织下钻：团队 × 技能点热力图（口径与 buildOrgHeatmap 一致，行换成团队） */
export async function buildTeamHeatmap(ctx: RouteContext, tenantId: string, orgId: string) {
  const { store } = ctx;
  const teams = await store.listTeams(orgId);
  const users = await store.listUsers(tenantId, 'trainee');
  const skillPoints = await store.listSkillPoints(tenantId);
  const teamHeatmap: Array<{
    teamId: string;
    teamName: string;
    skillPointId: string;
    skillPointName: string;
    passRate: number;
    avgScore: number;
  }> = [];
  for (const team of teams) {
    const memberIds = users.filter((u) => u.teamId === team.id).map((u) => u.id);
    const reports = (await examReportsForUsers(ctx, memberIds, { baselineOnly: true })).map(
      (r) => r.report
    );
    for (const sp of skillPoints) {
      const withSkill = reports.filter((r) => r.skillScores.some((s) => s.skillPointId === sp.id));
      if (withSkill.length === 0) continue;
      teamHeatmap.push({
        teamId: team.id,
        teamName: team.name,
        skillPointId: sp.id,
        skillPointName: sp.name,
        passRate: withSkill.filter((r) => r.passed).length / withSkill.length,
        avgScore: Math.round(
          withSkill.reduce(
            (sum, r) => sum + (r.skillScores.find((s) => s.skillPointId === sp.id)?.score ?? 0),
            0
          ) / withSkill.length
        ),
      });
    }
  }
  return teamHeatmap;
}

/** 合规红线环比：最近两个有数据月份的红线计数差 */
function complianceDeltaCalc(pairs: SessionReport[]): number {
  const redlineByMonth = new Map<string, number>();
  for (const { session, report } of pairs) {
    if (session.mode !== 'exam') continue;
    const n = report.violations.filter((v) => v.kind === 'redline').length;
    if (n === 0) continue;
    const month = report.createdAt.slice(0, 7);
    redlineByMonth.set(month, (redlineByMonth.get(month) ?? 0) + n);
  }
  const months = [...redlineByMonth.keys()].sort();
  if (months.length < 2) return 0;
  const last = redlineByMonth.get(months[months.length - 1]) ?? 0;
  const prev = redlineByMonth.get(months[months.length - 2]) ?? 0;
  return last - prev;
}

/** ISO 周标签，如 2026-W30 */
function isoWeek(dateStr: string): string {
  const d = new Date(dateStr);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function executiveRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 高管视图：组织热力图 + 周通过率趋势 + 月度试点/对照趋势 + 合规 + POC 对照
  app.get('/executive/summary', async (request) => {
    const tenantId = request.tenantId;
    const users = await store.listUsers(tenantId, 'trainee');
    const allExamReports = await examReportsForUsers(ctx, users.map((u) => u.id));

    const orgHeatmap = await buildOrgHeatmap(ctx, tenantId);

    // 按 ISO 周聚合通过率
    const byWeek = new Map<string, ScoreReport[]>();
    for (const { report } of allExamReports) {
      const week = isoWeek(report.createdAt);
      byWeek.set(week, [...(byWeek.get(week) ?? []), report]);
    }
    const passTrend = [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, reports]) => ({
        period,
        passRate: reports.filter((r) => r.passed).length / reports.length,
        sampleSize: reports.length,
      }));

    const compliance = await buildCompliance(ctx, tenantId);
    const complianceByOrg = await buildComplianceByOrg(ctx, tenantId);
    const trend = await buildMonthlyTrend(ctx, tenantId);
    const latestMonth = trend[trend.length - 1];

    // POC：用两个团队近似 实验组/对照组
    const orgs = await store.listOrganizations(tenantId);
    const teams = (await Promise.all(orgs.map((o) => store.listTeams(o.id)))).flat();
    const groupStats = async (teamId: string) => {
      const memberIds = users.filter((u) => u.teamId === teamId).map((u) => u.id);
      const reports = (await examReportsForUsers(ctx, memberIds)).map((r) => r.report);
      return {
        avgScore:
          reports.length > 0
            ? Math.round(reports.reduce((s, r) => s + r.totalScore, 0) / reports.length)
            : null,
        sampleSize: reports.length,
      };
    };
    const treatmentTeam = teams[0];
    const controlTeam = teams[1];
    const poc = {
      treatment: treatmentTeam
        ? { name: treatmentTeam.name, ...(await groupStats(treatmentTeam.id)) }
        : { name: null, avgScore: null, sampleSize: 0 },
      control: controlTeam ? { name: controlTeam.name, ...(await groupStats(controlTeam.id)) } : null,
    };

    // 已认证人数：有通过记录的学员去重（含 seed-history 演示考核历史）
    const certs = await store.listCertRecords({ tenantId });
    const certifiedPassedUsers = new Set(
      certs.filter((c) => c.passed).map((c) => c.userId)
    ).size;

    return {
      orgHeatmap,
      passTrend,
      compliance,
      poc,
      // 已认证：有通过认证记录的去重学员数 / 全租户学员数
      certified: { passed: certifiedPassedUsers, total: users.length },
      passRate: latestMonth?.treatment ?? null,
      controlPassRate: latestMonth?.control ?? null,
      complianceTotal: compliance.redlineCount,
      complianceDelta: complianceDeltaCalc(await allSessionReports(ctx, tenantId)),
      complianceByOrg,
      trend,
    };
  });

  // 组织下钻：某组织内团队 × 技能点热力图
  app.get<{ Querystring: { orgId?: string } }>('/executive/org-teams', async (request, reply) => {
    const orgId = request.query.orgId;
    if (!orgId) return reply.code(400).send({ error: 'orgId 必填' });
    return { teamHeatmap: await buildTeamHeatmap(ctx, request.tenantId, orgId) };
  });
}
