// 高管视图：数据来自 GET /executive/summary（组织热力图 / 月度趋势 / 合规 / KPI 口径）。
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import type { EChartsOption } from 'echarts';
import api from '../api';
import Chart from '../components/Chart';

interface OrgHeatCell {
  orgId: string;
  orgName: string;
  skillPointId: string;
  skillPointName: string;
  passRate: number;
  avgScore: number;
}

interface TeamHeatCell {
  teamId: string;
  teamName: string;
  skillPointId: string;
  skillPointName: string;
  passRate: number;
  avgScore: number;
}

/** 趋势时间范围（月）；0 = 全部 */
type TrendRange = 3 | 6 | 0;

interface TrendPoint {
  month: string;
  treatment: number | null;
  control: number | null;
}

interface ExecutiveSummary {
  orgHeatmap: OrgHeatCell[];
  passTrend: { period: string; passRate: number; sampleSize: number }[];
  compliance: { redlineCount: number; fillerHeavyCount: number; sessionsWithViolations: number };
  poc: {
    treatment: { name: string | null; avgScore: number | null; sampleSize: number };
    control: { name: string | null; avgScore: number | null; sampleSize: number } | null;
  };
  certified: { passed: number; total: number };
  passRate: number | null;
  controlPassRate: number | null;
  complianceTotal: number;
  complianceDelta: number;
  complianceByOrg: { orgName: string; kind: string; count: number }[];
  trend: TrendPoint[];
}

// 热力图配色：深绿 / 浅绿 / 偏红橙 / 粉红
const HEAT_COLORS = {
  deepGreen: '#2e9e77',
  lightGreen: '#8fc7b8',
  orange: '#E85C62',
  pink: '#e08a97',
};

function heatStyle(v: number): { backgroundColor: string; color: string } {
  if (v >= 80) return { backgroundColor: HEAT_COLORS.deepGreen, color: '#ffffff' };
  if (v >= 65) return { backgroundColor: HEAT_COLORS.lightGreen, color: '#17191F' };
  if (v >= 40) return { backgroundColor: HEAT_COLORS.orange, color: '#17191F' };
  return { backgroundColor: HEAT_COLORS.pink, color: '#ffffff' };
}

export default function Executive() {
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [trendRange, setTrendRange] = useState<TrendRange>(0);
  // 组织下钻：非空时显示该组织内团队热力图
  const [drillOrg, setDrillOrg] = useState<{ orgId: string; orgName: string } | null>(null);
  const [teamCells, setTeamCells] = useState<TeamHeatCell[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get<ExecutiveSummary>('/executive/summary');
        setSummary(res.data);
      } catch (e) {
        setError(
          axios.isAxiosError(e) && e.response?.status === 403
            ? '当前账号无权查看高管看板（需要 executive 或 admin 角色）'
            : '加载失败，请确认后端服务已启动'
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 下钻取数：进入某个组织时拉取其团队热力图
  useEffect(() => {
    if (!drillOrg) {
      setTeamCells(null);
      return;
    }
    let cancelled = false;
    setDrillLoading(true);
    api
      .get<{ teamHeatmap: TeamHeatCell[] }>('/executive/org-teams', {
        params: { orgId: drillOrg.orgId },
      })
      .then((res) => {
        if (!cancelled) setTeamCells(res.data.teamHeatmap);
      })
      .catch(() => {
        if (!cancelled) setTeamCells([]);
      })
      .finally(() => {
        if (!cancelled) setDrillLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drillOrg]);

  // 指标卡：整体达标率 / 对照组 / 已认证 / 合规风险
  const kpiCards = useMemo(() => {
    if (!summary) return [];
    const treatmentPoints = summary.trend.filter((p) => p.treatment !== null);
    const first = treatmentPoints[0];
    const last = treatmentPoints[treatmentPoints.length - 1];
    const delta =
      first && last && treatmentPoints.length >= 2
        ? last.treatment! - first.treatment!
        : null;
    return [
      {
        label: '整体达标率',
        value: summary.passRate !== null ? `${summary.passRate}%` : '—',
        note:
          delta !== null && first
            ? `${delta >= 0 ? '+' : ''}${delta}pt vs ${first.month}`
            : '暂无趋势数据',
      },
      {
        label: '对照组达标率',
        value: summary.controlPassRate !== null ? `${summary.controlPassRate}%` : '—',
        note: 'POC 对照',
      },
      {
        label: '已认证人数',
        value: `${summary.certified.passed} / ${summary.certified.total}`,
        note:
          summary.certified.total > 0
            ? `${Math.round((summary.certified.passed / summary.certified.total) * 100)}%`
            : '—',
      },
      {
        label: '合规风险事件',
        value: String(summary.complianceTotal),
        note: `环比 ${summary.complianceDelta >= 0 ? '+' : ''}${summary.complianceDelta}`,
      },
    ];
  }, [summary]);

  // 热力图：行 = 组织，列 = 技能点（按返回顺序），值 = 达标率 %
  const heatmap = useMemo(() => {
    const cells = summary?.orgHeatmap ?? [];
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
  }, [summary]);

  // 下钻热力图：行 = 团队，列 = 技能点（与组织热力图同构）
  const teamHeatmap = useMemo(() => {
    const cells = teamCells ?? [];
    const columns: { id: string; name: string }[] = [];
    for (const c of cells) {
      if (!columns.some((col) => col.id === c.skillPointId)) {
        columns.push({ id: c.skillPointId, name: c.skillPointName });
      }
    }
    const rows: { teamId: string; teamName: string; values: (number | null)[] }[] = [];
    const byKey = new Map(cells.map((c) => [`${c.teamId}::${c.skillPointId}`, c]));
    for (const c of cells) {
      if (rows.some((r) => r.teamId === c.teamId)) continue;
      rows.push({
        teamId: c.teamId,
        teamName: c.teamName,
        values: columns.map((col) => {
          const cell = byKey.get(`${c.teamId}::${col.id}`);
          return cell ? Math.round(cell.passRate * 100) : null;
        }),
      });
    }
    return { columns, rows };
  }, [teamCells]);

  // 时间范围过滤后的月度趋势
  const rangedTrend = useMemo(() => {
    const trend = summary?.trend ?? [];
    return trendRange === 0 ? trend : trend.slice(-trendRange);
  }, [summary, trendRange]);

  // 月度达标率趋势：试点组 vs POC 对照组（按时间范围过滤）
  const trendOption = useMemo<EChartsOption>(() => {
    const trend = rangedTrend;
    return {
      tooltip: { trigger: 'axis' },
      legend: {
        bottom: 0,
        icon: 'roundRect',
        itemWidth: 18,
        itemHeight: 4,
        textStyle: { color: '#64748b', fontSize: 12 },
        data: ['试点组', '对照组'],
      },
      grid: { left: 40, right: 20, top: 20, bottom: 56 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: trend.map((p) => p.month),
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisLabel: { color: '#64748b' },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitLine: { lineStyle: { color: '#eef3f6' } },
        axisLabel: { color: '#94a3b8' },
      },
      series: [
        {
          name: '试点组',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          data: trend.map((p) => p.treatment),
          lineStyle: { color: '#0d5e63', width: 3 },
          itemStyle: { color: '#0d5e63' },
        },
        {
          name: '对照组',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          data: trend.map((p) => p.control),
          lineStyle: { color: '#9ca3af', width: 2, type: 'dashed' },
          itemStyle: { color: '#9ca3af' },
        },
      ],
    };
  }, [rangedTrend]);

  const complianceRisks = summary?.complianceByOrg ?? [];

  if (loading) {
    return <p className="py-20 text-center text-sm text-gray-400">加载中…</p>;
  }
  if (error) {
    return <p className="py-20 text-center text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* 页头 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#17191F]">销售能力经营看板 · 2026 Q3</h1>
          <p className="mt-1 text-sm text-gray-500">
            数据口径：认证考核结果 · 截图可直接进经营会
          </p>
        </div>
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white border border-gray-200 px-3.5 py-1.5 text-xs text-gray-500 shadow-sm">
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          只读视图
        </span>
      </div>

      {/* 指标卡 */}
      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <div key={card.label} className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-gray-500">{card.label}</p>
            <p className="mt-2 text-3xl font-bold text-[#0d5e63]">{card.value}</p>
            <p className="mt-1.5 text-xs text-gray-400">{card.note}</p>
          </div>
        ))}
      </div>

      {/* 组织 × 技能点 达标率热力图（点击组织名下钻到团队） */}
      <div className="mt-4 bg-white rounded-2xl shadow-sm p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#17191F]">
            {drillOrg ? `${drillOrg.orgName} · 团队 × 技能点 达标率热力图` : '组织 × 技能点 达标率热力图'}
          </h2>
          {drillOrg && (
            <button
              onClick={() => setDrillOrg(null)}
              className="text-xs font-medium text-[#0d5e63] hover:underline"
            >
              ← 返回组织视图
            </button>
          )}
        </div>
        {drillOrg ? (
          drillLoading ? (
            <p className="py-10 text-center text-sm text-gray-400">加载中…</p>
          ) : teamHeatmap.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">该组织暂无团队考核数据</p>
          ) : (
            <div className="mt-5 space-y-2">
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `96px repeat(${teamHeatmap.columns.length}, 1fr)` }}
              >
                <span className="text-xs text-gray-400 self-center">团队</span>
                {teamHeatmap.columns.map((s) => (
                  <span key={s.id} className="text-xs text-gray-500 text-center">
                    {s.name}
                  </span>
                ))}
              </div>
              {teamHeatmap.rows.map((row) => (
                <div
                  key={row.teamId}
                  className="grid gap-2 items-center"
                  style={{ gridTemplateColumns: `96px repeat(${teamHeatmap.columns.length}, 1fr)` }}
                >
                  <span className="text-xs text-[#17191F] font-medium">{row.teamName}</span>
                  {row.values.map((v, i) => (
                    <div
                      key={i}
                      className="h-12 rounded-lg flex items-center justify-center text-sm font-semibold"
                      style={
                        v === null
                          ? { backgroundColor: '#f1f5f9', color: '#cbd5e1' }
                          : heatStyle(v)
                      }
                    >
                      {v ?? '—'}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        ) : heatmap.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">暂无考核数据</p>
        ) : (
          <div className="mt-5 space-y-2">
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `72px repeat(${heatmap.columns.length}, 1fr)` }}
            >
              <span className="text-xs text-gray-400 self-center">组织</span>
              {heatmap.columns.map((s) => (
                <span key={s.id} className="text-xs text-gray-500 text-center">
                  {s.name}
                </span>
              ))}
            </div>
            {heatmap.rows.map((row) => (
              <div
                key={row.orgId}
                className="grid gap-2 items-center"
                style={{ gridTemplateColumns: `72px repeat(${heatmap.columns.length}, 1fr)` }}
              >
                <button
                  onClick={() => setDrillOrg({ orgId: row.orgId, orgName: row.orgName })}
                  className="text-left text-xs text-[#0d5e63] font-medium hover:underline"
                  title="下钻到团队"
                >
                  {row.orgName}
                </button>
                {row.values.map((v, i) => (
                  <div
                    key={i}
                    className="h-12 rounded-lg flex items-center justify-center text-sm font-semibold"
                    style={
                      v === null
                        ? { backgroundColor: '#f1f5f9', color: '#cbd5e1' }
                        : heatStyle(v)
                    }
                  >
                    {v ?? '—'}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <p className="mt-5 text-xs text-gray-400">
          {drillOrg ? '团队层级视图；按权限设计不下钻到个人练习明细。' : '点击组织名可下钻到团队层级；按权限设计不下钻到个人练习明细。'}
        </p>
      </div>

      {/* 趋势 + 合规风险 */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#17191F]">达标率趋势 vs 对照组</h2>
            <div className="flex gap-1 rounded-lg bg-[#eef3f6] p-0.5">
              {([3, 6, 0] as TrendRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setTrendRange(r)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    trendRange === r
                      ? 'bg-white font-bold text-[#17191F] shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {r === 0 ? '全部' : `近${r}月`}
                </button>
              ))}
            </div>
          </div>
          {(rangedTrend.length ?? 0) === 0 ? (
            <p className="py-20 text-center text-sm text-gray-400">暂无趋势数据</p>
          ) : (
            <Chart option={trendOption} height={280} className="mt-2" />
          )}
        </div>
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-[#17191F]">合规风险计数</h2>
          {complianceRisks.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">暂无合规风险事件</p>
          ) : (
            <div className="mt-4 space-y-3">
              {complianceRisks.map((r) => (
                <div
                  key={`${r.orgName}-${r.kind}`}
                  className="flex items-center justify-between rounded-xl bg-[#fdf0f2] px-4 py-3.5"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#17191F]">{r.orgName}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{r.kind}</p>
                  </div>
                  <span className="text-sm font-bold text-[#c14a63]">{r.count} 起</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-5 text-xs text-gray-400">
            均由确定性规则层在考核中检出，可定位到原话位置。
          </p>
        </div>
      </div>
    </div>
  );
}
