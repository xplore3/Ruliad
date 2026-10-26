// 数据中心：数据来自 GET /admin/analytics（组织热力图 + 合规风险），汇报包导出沿用 /admin/report-export。
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import api from '../api';
import { AdminSectionTabs } from '../components/Layout';
import { exportChampionReport } from '../report';

interface OrgHeatCell {
  orgId: string;
  orgName: string;
  skillPointId: string;
  skillPointName: string;
  passRate: number;
  avgScore: number;
}

interface Analytics {
  funnel: { stage: 'available' | 'in_progress' | 'passed' | 'failed'; count: number }[];
  compliance: { redlineCount: number; fillerHeavyCount: number; sessionsWithViolations: number };
  complianceByOrg: { orgName: string; kind: string; count: number }[];
  orgHeatmap: OrgHeatCell[];
  examCompletion: {
    windowId: string;
    name: string;
    assigned: number;
    completed: number;
    published: boolean;
  }[];
}

function cellClass(value: number): string {
  if (value >= 80) return 'bg-[#2e9e77] text-white';
  if (value >= 66) return 'bg-[#8fc7b8] text-slate-800';
  if (value >= 40) return 'bg-[#f0c973] text-slate-800';
  return 'bg-[#e08a97] text-white';
}

export default function DataCenter() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get<Analytics>('/admin/analytics');
        setData(res.data);
      } catch (e) {
        setError(
          axios.isAxiosError(e) && e.response?.status === 403
            ? '当前账号无权查看数据中心（需要 admin 或 platform 角色）'
            : '加载失败，请确认后端服务已启动'
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 热力图：行 = 组织，列 = 技能点（按返回顺序），值 = 达标率 %
  const heatmap = useMemo(() => {
    const cells = data?.orgHeatmap ?? [];
    const columns: { id: string; name: string }[] = [];
    for (const c of cells) {
      if (!columns.some((col) => col.id === c.skillPointId)) {
        columns.push({ id: c.skillPointId, name: c.skillPointName });
      }
    }
    const rows: { orgId: string; orgName: string; values: (number | null)[] }[] = [];
    const byKey = new Map(cells.map((c) => [`${c.orgId}::${c.skillPointId}`, c]));
    for (const c of cells) {
      if (rows.some((r) => r.orgId === c.orgId)) continue;
      rows.push({
        orgId: c.orgId,
        orgName: c.orgName,
        values: columns.map((col) => {
          const cell = byKey.get(`${c.orgId}::${col.id}`);
          return cell ? Math.round(cell.passRate * 100) : null;
        }),
      });
    }
    return { columns, rows };
  }, [data]);

  const riskEvents = data?.complianceByOrg ?? [];

  // 汇报包导出：必须走 axios 带 Authorization 头，window.open 直连会被后端 401
  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportChampionReport();
    } catch {
      window.alert('汇报包生成失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  // 考核完成漏斗：按 用户×窗口 统计（available → in_progress → passed/failed）
  const FUNNEL_LABELS: Record<string, string> = {
    available: '可参加',
    in_progress: '进行中',
    passed: '已通过',
    failed: '未通过',
  };
  const funnel = data?.funnel ?? [];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <div>
      <AdminSectionTabs />

      {/* 标题区 */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">管理后台</h1>
          <p className="mt-2 text-sm text-slate-500">培训管理员（冠军）· 华东制药事业部</p>
        </div>
        <button
          onClick={exportReport}
          disabled={exporting}
          className="flex items-center gap-2 rounded-xl bg-[#0d5e63] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#0b5156] disabled:opacity-60"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
          </svg>
          导出冠军汇报包（PPT）
        </button>
      </div>

      {exporting && <p className="mb-4 text-sm text-slate-500">正在生成汇报包…</p>}

      {loading && <p className="py-20 text-center text-sm text-slate-400">加载中…</p>}
      {!loading && error && <p className="py-20 text-center text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* 组织 × 技能点 达标率热力图 */}
          <div className="rounded-2xl bg-white p-6 shadow-sm lg:col-span-2">
            <h2 className="mb-6 text-base font-bold text-slate-900">组织 × 技能点 达标率热力图</h2>
            {heatmap.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">暂无考核数据</p>
            ) : (
              <div
                className="grid items-center gap-2"
                style={{ gridTemplateColumns: `72px repeat(${heatmap.columns.length}, 1fr)` }}
              >
                <span className="text-xs text-slate-400">组织</span>
                {heatmap.columns.map((skill) => (
                  <span key={skill.id} className="text-center text-xs text-slate-500">
                    {skill.name}
                  </span>
                ))}
                {heatmap.rows.map((row) => (
                  <div key={row.orgId} className="contents">
                    <span className="text-sm font-medium text-slate-700">{row.orgName}</span>
                    {row.values.map((value, i) => (
                      <div
                        key={`${row.orgId}-${heatmap.columns[i].id}`}
                        className={`flex h-12 items-center justify-center rounded-xl text-sm font-semibold ${
                          value === null ? 'bg-slate-100 text-slate-300' : cellClass(value)
                        }`}
                      >
                        {value ?? '—'}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 右侧栏 */}
          <div className="space-y-6">
            {/* 考核完成漏斗 */}
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-bold text-slate-900">考核完成漏斗</h2>
              {funnel.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">暂无考核数据</p>
              ) : (
                <div className="space-y-2.5">
                  {funnel.map((stage) => (
                    <div key={stage.stage} className="flex items-center gap-3">
                      <span className="w-14 shrink-0 text-xs text-slate-500">
                        {FUNNEL_LABELS[stage.stage] ?? stage.stage}
                      </span>
                      <div className="h-7 flex-1 overflow-hidden rounded-lg bg-slate-100">
                        <div
                          className={`flex h-full items-center justify-end rounded-lg pr-2 text-xs font-semibold text-white transition-all ${
                            stage.stage === 'passed'
                              ? 'bg-[#2e9e77]'
                              : stage.stage === 'failed'
                                ? 'bg-[#e08a97]'
                                : 'bg-[#0d5e63]'
                          }`}
                          style={{ width: `${Math.max(10, (stage.count / funnelMax) * 100)}%` }}
                        >
                          {stage.count}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 合规风险事件 */}
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-900">
                <svg className="h-5 w-5 text-[#e08a97]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01" />
                </svg>
                合规风险事件
              </h2>
              {riskEvents.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">暂无合规风险事件</p>
              ) : (
                <div className="space-y-3">
                  {riskEvents.map((event) => (
                    <div
                      key={`${event.orgName}-${event.kind}`}
                      className="flex items-center justify-between rounded-xl bg-[#fdf0f2] px-4 py-3.5"
                    >
                      <span className="text-sm text-slate-700">
                        {event.orgName} · {event.kind}
                      </span>
                      <span className="text-sm font-bold text-[#d95f70]">{event.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 汇报包导出 */}
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900">
                <svg className="h-5 w-5 text-[#f59e0b]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                汇报包导出
              </h2>
              <p className="mb-5 text-sm leading-relaxed text-slate-500">
                一键生成阶段成果 PPT：达标率趋势、对照组对比、代表性复盘片段。
              </p>
              <button
                onClick={exportReport}
                disabled={exporting}
                className="w-full rounded-xl bg-[#0d5e63] py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0b5156] disabled:opacity-60"
              >
                {exporting ? '正在生成…' : '生成本季汇报包'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
