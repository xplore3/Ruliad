// 资产中心：数据来自 GET /admin/data-assets（概览 / 客户认知库 / 年度趋势）。
// 「打法资产库」「标准演化史」两个页签后端暂无对应数据，保留空态。
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import type { EChartsOption } from 'echarts';
import api from '../api';
import Chart from '../components/Chart';

type TabKey = 'overview' | 'tactics' | 'customer' | 'standard' | 'annual';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '资产总览' },
  { key: 'tactics', label: '打法资产库' },
  { key: 'customer', label: '客户认知库' },
  { key: 'standard', label: '标准演化史' },
  { key: 'annual', label: '年度资产报告' },
];

interface OverviewStat {
  key: string;
  label: string;
  value: number;
  delta?: string;
  desc: string;
}

interface TopAsset {
  skillPointId: string;
  name: string;
  author: string | null;
  citations: number;
  achievementRate: number | null;
  note: string | null;
  badge: string;
}

interface Persona {
  id: string;
  name: string;
  archetype: string;
  recordings: number;
  recordingsKind: string;
  lastCalibrated: string | null;
  practiceCount: number;
  stale: boolean;
  calibrationStatus: string | null;
}

interface Objection {
  quote: string;
  answer: string;
  frequency: number | null;
}

interface TrendPoint {
  month: string;
  treatment: number | null;
  control: number | null;
}

interface DataAssetsResponse {
  overview: {
    stats: OverviewStat[];
    topAssets: TopAsset[];
    health: { label: string; count: number }[];
  };
  customerInsights: {
    personas: Persona[];
    objections: Objection[];
  };
  annual: { trend: TrendPoint[] };
}

const TEAL = '#0d5e63';

const badgeStyles: Record<string, string> = {
  已验证: 'bg-[#e2f1ea] text-[#2e9e77]',
  观察中: 'bg-[#faf0d7] text-[#b8860b]',
  待复审: 'bg-[#fbe3e8] text-[#d05f73]',
};

const healthCountClasses = ['text-[#d05f73]', 'text-[#d9a13b]', 'text-[#17191F]'];

function MedalIcon() {
  return (
    <svg className="h-4 w-4 text-orange-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="9" r="5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13.5 7.5 20l4.5-2.5L16.5 20 15 13.5" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="h-4 w-4 text-orange-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg className="h-4 w-4 text-[#17191F]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4 text-orange-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

function assetMeta(a: TopAsset): string {
  const parts = [`署名 ${a.author ?? '—'}`, `引用 ${a.citations} 次`];
  if (a.achievementRate !== null) parts.push(`最优档达成率 ${a.achievementRate}%`);
  else if (a.note) parts.push(a.note);
  return parts.join(' · ');
}

function OverviewView({ overview }: { overview: DataAssetsResponse['overview'] }) {
  return (
    <div className="space-y-4">
      {/* 概览统计卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {overview.stats.map((s) => (
          <div key={s.key} className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">{s.label}</p>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-[#17191F]">{s.value}</span>
              {s.delta && (
                <span className="text-xs font-medium text-[#2e9e77]">{s.delta}</span>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">{s.desc}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 本季最有价值资产 Top5 */}
        <div className="rounded-2xl bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <MedalIcon />
            <h2 className="text-sm font-bold text-[#17191F]">本季最有价值资产 Top5（引用次数 × 验证效果）</h2>
          </div>
          {overview.topAssets.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">暂无资产数据</p>
          ) : (
            <div className="space-y-3">
              {overview.topAssets.map((a, i) => (
                <div key={a.skillPointId} className="flex items-center gap-4 rounded-xl border border-gray-100 px-4 py-3.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#17191F] text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#17191F]">{a.name}</p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">{assetMeta(a)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${badgeStyles[a.badge] ?? badgeStyles['观察中']}`}>
                    {a.badge}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 资产健康度 */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <WarningIcon />
            <h2 className="text-sm font-bold text-[#17191F]">资产健康度</h2>
          </div>
          <div className="space-y-3">
            {overview.health.map((h, i) => (
              <div key={h.label} className="flex items-center justify-between rounded-xl bg-[#eef3f5] px-4 py-3">
                <span className="text-sm text-[#17191F]">{h.label}</span>
                <span className={`text-sm font-bold ${healthCountClasses[i] ?? 'text-[#17191F]'}`}>
                  {h.count} 条
                </span>
              </div>
            ))}
          </div>
          <button className="mt-4 w-full rounded-xl bg-[#0d5e63] py-3 text-sm font-semibold text-white">
            发起加急萃取（离职交接工单）
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomerView({ customerInsights }: { customerInsights: DataAssetsResponse['customerInsights'] }) {
  const { personas, objections } = customerInsights;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* 客户角色 */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <PersonIcon />
          <h2 className="text-sm font-bold text-[#17191F]">客户角色（按细分人群）</h2>
        </div>
        {personas.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">暂无客户角色</p>
        ) : (
          <div className="space-y-3">
            {personas.map((p) => (
              <div key={p.id} className="rounded-xl border border-gray-100 px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-[#17191F]">{p.name}</p>
                  {p.stale && (
                    <span className="rounded-full bg-[#faf0d7] px-2 py-0.5 text-xs font-medium text-[#b8860b]">
                      认知可能过期
                    </span>
                  )}
                  {!p.stale && p.calibrationStatus && (
                    <span className="rounded-full bg-[#e2f1ea] px-2 py-0.5 text-xs font-medium text-[#2e9e77]">
                      {p.calibrationStatus}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {p.archetype} · 构建来源 {p.recordings} 段{p.recordingsKind} · 最后校准{' '}
                  {p.lastCalibrated ?? '—'} · 练习 {p.practiceCount} 次
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 高频异议库 */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-[#17191F]">高频异议库</h2>
        {objections.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">暂无高频异议</p>
        ) : (
          <div className="space-y-3">
            {objections.map((o) => (
              <div key={o.quote} className="rounded-xl bg-[#e9f0f2] px-4 py-3.5">
                <p className="text-sm font-bold text-[#17191F]">{o.quote}</p>
                <p className="mt-1 text-xs text-gray-500">{o.answer}</p>
                {o.frequency !== null && (
                  <p className="mt-0.5 text-xs text-gray-500">实战出现 {o.frequency}%</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnnualView({ trend }: { trend: TrendPoint[] }) {
  const annualOption = useMemo<EChartsOption>(
    () => ({
      grid: { left: 44, right: 24, top: 24, bottom: 32 },
      xAxis: {
        type: 'category',
        data: trend.map((p) => p.month),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisLabel: { color: '#64748b' },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 20,
        splitLine: { show: false },
        axisLabel: { color: '#64748b' },
      },
      series: [
        {
          type: 'line',
          data: trend.map((p) => p.treatment),
          symbol: 'circle',
          symbolSize: 9,
          itemStyle: { color: '#ffffff', borderColor: TEAL, borderWidth: 2.5 },
          lineStyle: { color: TEAL, width: 3 },
        },
        {
          type: 'line',
          data: trend.map((p) => p.control),
          symbol: 'diamond',
          symbolSize: 7,
          itemStyle: { color: '#94a3b8' },
          lineStyle: { color: '#94a3b8', type: 'dashed', width: 1.5 },
        },
      ],
    }),
    [trend]
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* 全年能力图谱与资产增量 */}
      <div className="rounded-2xl bg-white p-5 shadow-sm lg:col-span-2">
        <h2 className="mb-2 text-sm font-bold text-[#17191F]">全年能力图谱与资产增量</h2>
        {trend.length === 0 ? (
          <p className="py-20 text-center text-sm text-gray-400">暂无趋势数据</p>
        ) : (
          <Chart option={annualOption} height={300} />
        )}
        <p className="mt-2 text-xs text-gray-500">
          代表性萃取故事 3 则 +「资产在关键时刻起作用」案例 4 则将随报告导出。
        </p>
      </div>

      {/* 一键生成 */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <DownloadIcon />
          <h2 className="text-sm font-bold text-[#17191F]">一键生成</h2>
        </div>
        <p className="text-sm text-gray-500">续约谈判前两周自动提醒客户成功经理生成本报告。</p>
        <button className="mt-4 w-full rounded-xl bg-[#0d5e63] py-3 text-sm font-semibold text-white">
          导出 PDF
        </button>
        <button className="mt-3 w-full rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-[#17191F]">
          导出 PPT
        </button>
      </div>
    </div>
  );
}

export default function DataAssets() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [data, setData] = useState<DataAssetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get<DataAssetsResponse>('/admin/data-assets');
        setData(res.data);
      } catch (e) {
        setError(
          axios.isAxiosError(e) && e.response?.status === 403
            ? '当前账号无权查看资产中心（需要 admin 或 platform 角色）'
            : '加载失败，请确认后端服务已启动'
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      {/* 页面标题 */}
      <h1 className="text-2xl font-bold text-[#17191F]">资产中心</h1>
      <p className="mt-1.5 text-sm text-gray-500">
        资产出场永远带三样：署名（谁的）· 出处（哪来的）· 数据（多少人用、效果如何）
      </p>

      {/* 子页签 */}
      <div className="mt-5 inline-flex items-center gap-1 rounded-full bg-[#e3edef] p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              tab === t.key
                ? 'bg-white font-semibold text-[#17191F] shadow-sm'
                : 'text-gray-500 hover:text-[#17191F]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {loading && (
          <div className="rounded-2xl bg-white p-12 text-center text-sm text-gray-400 shadow-sm">
            加载中…
          </div>
        )}
        {!loading && error && (
          <div className="rounded-2xl bg-white p-12 text-center text-sm text-red-600 shadow-sm">
            {error}
          </div>
        )}
        {!loading && !error && data && (
          <>
            {tab === 'overview' && <OverviewView overview={data.overview} />}
            {tab === 'customer' && <CustomerView customerInsights={data.customerInsights} />}
            {tab === 'annual' && <AnnualView trend={data.annual.trend} />}
            {(tab === 'tactics' || tab === 'standard') && (
              <div className="rounded-2xl bg-white p-12 text-center text-sm text-gray-400 shadow-sm">
                暂无数据
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
