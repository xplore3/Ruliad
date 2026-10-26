import type { FastifyInstance } from 'fastify';
import type { RouteContext } from '../ctx.js';
import { buildCompliance, buildComplianceByOrg, buildOrgHeatmap } from './executive.js';

interface AnalyticsData {
  funnel: Array<{ stage: 'available' | 'in_progress' | 'passed' | 'failed'; count: number }>;
  compliance: { redlineCount: number; fillerHeavyCount: number; sessionsWithViolations: number };
  complianceByOrg: Array<{ orgName: string; kind: string; count: number }>;
  orgHeatmap: Array<{
    orgId: string;
    orgName: string;
    skillPointId: string;
    skillPointName: string;
    passRate: number;
    avgScore: number;
  }>;
  examCompletion: Array<{ windowId: string; name: string; assigned: number; completed: number; published: boolean }>;
}

/** 数据中心聚合：漏斗 + 合规 + 组织热力图 + 窗口完成度 */
async function buildAnalytics(ctx: RouteContext, tenantId: string): Promise<AnalyticsData> {
  const { store } = ctx;
  const windows = await store.listExamWindows(tenantId);

  // 漏斗：按 用户×窗口 统计
  let inProgress = 0;
  let passed = 0;
  let failed = 0;
  let assigned = 0;
  const examCompletion: AnalyticsData['examCompletion'] = [];
  for (const w of windows) {
    let completedUsers = 0;
    for (const userId of w.userIds) {
      assigned += 1;
      const sessions = await store.listSessions({ userId, examWindowId: w.id });
      const certs = await store.listCertRecords({ userId, examWindowId: w.id });
      const latest = [...certs].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
      if (certs.some((c) => c.passed)) passed += 1;
      else if (latest && !latest.passed) failed += 1;
      else if (sessions.length > 0) inProgress += 1;
      if (sessions.some((s) => s.status === 'completed')) completedUsers += 1;
    }
    examCompletion.push({
      windowId: w.id,
      name: w.name,
      assigned: w.userIds.length,
      completed: completedUsers,
      published: w.status === 'published',
    });
  }

  return {
    funnel: [
      { stage: 'available', count: assigned },
      { stage: 'in_progress', count: inProgress },
      { stage: 'passed', count: passed },
      { stage: 'failed', count: failed },
    ],
    compliance: await buildCompliance(ctx, tenantId),
    complianceByOrg: await buildComplianceByOrg(ctx, tenantId),
    orgHeatmap: await buildOrgHeatmap(ctx, tenantId),
    examCompletion,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** 自包含汇报页：内联 CSS、16:9 打印友好，新窗口打开即可打印 */
function renderReportHtml(data: AnalyticsData, tenantId: string): string {
  const generatedAt = new Date().toISOString();
  const stageLabel: Record<string, string> = {
    available: '已分配',
    in_progress: '进行中',
    passed: '已通过',
    failed: '未通过',
  };
  const funnelRows = data.funnel
    .map((f) => `<tr><td>${stageLabel[f.stage]}</td><td>${f.count}</td></tr>`)
    .join('');
  const heatmapRows = data.orgHeatmap
    .map(
      (h) =>
        `<tr><td>${esc(h.orgName)}</td><td>${esc(h.skillPointName)}</td><td>${pct(h.passRate)}</td><td>${h.avgScore}</td></tr>`
    )
    .join('');
  const completionRows = data.examCompletion
    .map(
      (c) =>
        `<tr><td>${esc(c.name)}</td><td>${c.assigned}</td><td>${c.completed}</td><td>${c.published ? '已发布' : '未发布'}</td></tr>`
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Grasp · 你的专属陪练员与指导参谋 · 数据汇报</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color: #1a1a2e; background: #fff; }
  .slide { width: 100%; max-width: 1280px; aspect-ratio: 16 / 9; margin: 0 auto; padding: 48px 64px; page-break-after: always; }
  h1 { font-size: 32px; margin-bottom: 8px; }
  h2 { font-size: 20px; margin: 24px 0 12px; color: #16213e; }
  .meta { color: #666; font-size: 14px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  th, td { border: 1px solid #d0d0dd; padding: 8px 12px; text-align: left; }
  th { background: #f0f2f8; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .kpi { display: inline-block; margin-right: 40px; }
  .kpi .num { font-size: 36px; font-weight: 700; }
  .kpi .label { color: #666; font-size: 14px; }
  @media print { .slide { max-width: none; } }
</style>
</head>
<body>
<section class="slide">
  <h1>Grasp · 你的专属陪练员与指导参谋 · 数据汇报</h1>
  <p class="meta">租户：${esc(tenantId)} ｜ 生成时间：${generatedAt}</p>
  <h2>考核漏斗</h2>
  <table><thead><tr><th>阶段</th><th>人数</th></tr></thead><tbody>${funnelRows}</tbody></table>
  <h2>考核窗口完成度</h2>
  <table><thead><tr><th>窗口</th><th>已分配</th><th>已完成</th><th>结果发布</th></tr></thead><tbody>${completionRows}</tbody></table>
</section>
<section class="slide">
  <h2>组织 × 技能热力图（仅考核数据）</h2>
  <table><thead><tr><th>组织</th><th>技能点</th><th>通过率</th><th>平均分</th></tr></thead><tbody>${heatmapRows}</tbody></table>
</section>
<section class="slide">
  <h2>合规概况</h2>
  <p>
    <span class="kpi"><span class="num">${data.compliance.redlineCount}</span><br><span class="label">红线触发次数</span></span>
    <span class="kpi"><span class="num">${data.compliance.fillerHeavyCount}</span><br><span class="label">口头禅高频会话</span></span>
    <span class="kpi"><span class="num">${data.compliance.sessionsWithViolations}</span><br><span class="label">存在违规的会话</span></span>
  </p>
</section>
</body>
</html>`;
}

export async function analyticsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  // 数据中心聚合 JSON
  app.get('/admin/analytics', async (request) => buildAnalytics(ctx, request.tenantId));

  // 汇报页导出：自包含 HTML，前端新窗口打开打印
  app.get('/admin/report-export', async (request, reply) => {
    const data = await buildAnalytics(ctx, request.tenantId);
    return reply.type('text/html; charset=utf-8').send(renderReportHtml(data, request.tenantId));
  });
}
