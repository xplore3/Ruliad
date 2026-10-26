import { useEffect, useState } from 'react';
import api from '../api';
import type { GrowthResponse } from '../types';

// 成长档案页：布局按 docs/UI-achieve.png，数据来自 GET /growth

/** 技能雷达：蛛网图，顶点=各技能，半径比例=当前档位 / 5 */
function SkillRadar({ skills }: { skills: { name: string; value: number }[] }) {
  const W = 320;
  const H = 260;
  const CX = W / 2;
  const CY = H / 2 + 6;
  const R = 82;
  const n = skills.length;
  const angleAt = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const vertex = (i: number, ratio: number) => ({
    x: CX + Math.cos(angleAt(i)) * R * ratio,
    y: CY + Math.sin(angleAt(i)) * R * ratio,
  });
  const valuePoints = skills
    .map((s, i) => {
      const p = vertex(i, s.value);
      return `${p.x},${p.y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-72">
      {[1, 2, 3, 4, 5].map((level) => (
        <polygon
          key={level}
          points={skills
            .map((_, i) => {
              const p = vertex(i, level / 5);
              return `${p.x},${p.y}`;
            })
            .join(' ')}
          fill="none"
          stroke="#e3e9ec"
          strokeWidth="1"
        />
      ))}
      {skills.map((_, i) => {
        const p = vertex(i, 1);
        return (
          <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#e3e9ec" strokeWidth="1" />
        );
      })}
      <polygon points={valuePoints} fill="rgba(13,94,99,0.16)" stroke="#0d5e63" strokeWidth="1.5" />
      {skills.map((s, i) => {
        const label = vertex(i, 1.26);
        return (
          <text
            key={s.name}
            x={label.x}
            y={label.y + 3}
            fontSize="11"
            fill="#4b5c68"
            textAnchor="middle"
          >
            {s.name}
          </text>
        );
      })}
    </svg>
  );
}

/** 进步曲线（考核加权分）：琥珀色折线 */
function ProgressCurve({ points }: { points: { label: string; score: number }[] }) {
  const W = 320;
  const H = 170;
  const PAD_L = 30;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 22;
  const scores = points.map((p) => p.score);
  const Y_MIN = Math.max(0, Math.floor((Math.min(...scores) - 5) / 10) * 10);
  const Y_MAX = Math.min(100, Math.ceil((Math.max(...scores) + 5) / 10) * 10);
  const span = Math.max(1, Y_MAX - Y_MIN);
  const xAt = (i: number) =>
    PAD_L + (i * (W - PAD_L - PAD_R)) / Math.max(1, points.length - 1);
  const yAt = (v: number) =>
    PAD_T + (1 - (v - Y_MIN) / span) * (H - PAD_T - PAD_B);
  const ticks = Array.from({ length: 5 }, (_, i) => Y_MIN + (i * span) / 4);
  const polyline = points.map((p, i) => `${xAt(i)},${yAt(p.score)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* 坐标轴 */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#c8d2d8" strokeWidth="1" />
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#c8d2d8" strokeWidth="1" />
      {ticks.map((v) => (
        <text key={v} x={PAD_L - 6} y={yAt(v) + 3} fontSize="9" fill="#8a99a3" textAnchor="end">
          {Math.round(v)}
        </text>
      ))}
      <polyline
        points={polyline}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <g key={p.label}>
          <circle cx={xAt(i)} cy={yAt(p.score)} r="3.5" fill="#ffffff" stroke="#f59e0b" strokeWidth="2" />
          <text x={xAt(i)} y={H - 8} fontSize="9" fill="#8a99a3" textAnchor="middle">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** 口头禅追踪：深青色柱状图 */
function FillerBars({ points }: { points: { label: string; count: number }[] }) {
  const W = 320;
  const H = 170;
  const PAD_L = 30;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 22;
  const maxCount = Math.max(...points.map((p) => p.count), 1);
  const Y_MAX = Math.ceil(maxCount / 4) * 4;
  const chartW = W - PAD_L - PAD_R;
  const slot = chartW / points.length;
  const barW = slot * 0.62;
  const yAt = (v: number) => PAD_T + (1 - v / Y_MAX) * (H - PAD_T - PAD_B);
  const ticks = Array.from({ length: 5 }, (_, i) => (i * Y_MAX) / 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#c8d2d8" strokeWidth="1" />
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#c8d2d8" strokeWidth="1" />
      {ticks.map((v) => (
        <text key={v} x={PAD_L - 6} y={yAt(v) + 3} fontSize="9" fill="#8a99a3" textAnchor="end">
          {Math.round(v)}
        </text>
      ))}
      {points.map((f, i) => {
        const x = PAD_L + i * slot + (slot - barW) / 2;
        const y = yAt(f.count);
        return (
          <g key={f.label}>
            <rect x={x} y={y} width={barW} height={Math.max(0, H - PAD_B - y)} rx="5" fill="#0d5e63" />
            <text
              x={PAD_L + i * slot + slot / 2}
              y={H - 8}
              fontSize="9"
              fill="#8a99a3"
              textAnchor="middle"
            >
              {f.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-gray-400">{text}</p>;
}

export default function Growth() {
  const [data, setData] = useState<GrowthResponse | null>(null);
  const [error, setError] = useState(false);

  const load = () => {
    setError(false);
    api
      .get<GrowthResponse>('/growth')
      .then((res) => setData(res.data))
      .catch(() => setError(true));
  };

  useEffect(load, []);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm text-gray-500">成长档案加载失败，请稍后重试</p>
        <button
          className="rounded-lg bg-[#0d5e63] px-5 py-2 text-sm font-medium text-white"
          onClick={load}
        >
          重新加载
        </button>
      </div>
    );
  }

  if (!data) {
    return <p className="p-10 text-center text-sm text-gray-400">正在加载成长档案…</p>;
  }

  const radarSkills = data.skills
    .slice(0, 6)
    .map((s) => ({ name: s.name, value: Math.min(1, s.currentLevel / 5) }));
  const progressPoints = data.sessions.map((s, i) => ({
    label: `W${i + 1}`,
    score: s.totalScore,
  }));
  const fillerPoints = data.fillerTrend.map((f, i) => ({
    label: `W${i + 1}`,
    count: Object.values(f.fillers).reduce((sum, n) => sum + n, 0),
  }));
  // 全程最高频口头禅，用于标题展示
  const fillerTotals = new Map<string, number>();
  for (const f of data.fillerTrend) {
    for (const [word, n] of Object.entries(f.fillers)) {
      fillerTotals.set(word, (fillerTotals.get(word) ?? 0) + n);
    }
  }
  const topFiller = [...fillerTotals.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const fillerFirst = fillerPoints[0]?.count;
  const fillerLast = fillerPoints[fillerPoints.length - 1]?.count;

  return (
    <div className="space-y-4 p-4 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0 lg:p-0">
      <h1 className="text-2xl font-bold text-[#17191F] lg:col-span-2">成长档案</h1>

      {/* 技能雷达 */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-base font-bold text-[#17191F]">技能雷达</h2>
        {radarSkills.length >= 3 ? (
          <SkillRadar skills={radarSkills} />
        ) : (
          <EmptyHint text="完成更多场景的练习后生成技能雷达" />
        )}
      </section>

      {/* 进步曲线 */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-bold text-[#17191F]">进步曲线（考核加权分）</h2>
        {progressPoints.length > 0 ? (
          <ProgressCurve points={progressPoints} />
        ) : (
          <EmptyHint text="还没有已评分的练习记录" />
        )}
      </section>

      {/* 已获认证 */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-bold text-[#17191F]">已获认证</h2>
        {data.certs.length === 0 ? (
          <EmptyHint text="通过考核后认证会出现在这里" />
        ) : (
          <ul className="space-y-3">
            {data.certs.map((cert) => (
              <li
                key={cert.id}
                className="flex items-center justify-between rounded-xl bg-[#e9f2f2] px-4 py-3"
              >
                <span className="flex items-center gap-2.5">
                  <svg
                    className="h-5 w-5 text-[#2e9e77]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    viewBox="0 0 24 24"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 12.5l2.5 2.5 4.5-5" />
                  </svg>
                  <span className="text-sm font-medium text-[#17191F]">
                    {cert.examWindowName ?? '认证考核'} · {cert.totalScore} 分
                  </span>
                </span>
                <span className="text-xs text-gray-400">{cert.issuedAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 口头禅追踪 */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-[#17191F]">
          口头禅追踪{topFiller ? `：「${topFiller[0]}」使用频次` : ''}
        </h2>
        {fillerPoints.length > 0 ? (
          <>
            <p className="mb-3 mt-1 text-sm text-gray-400">
              {fillerPoints.length > 1
                ? `${fillerPoints.length} 场从 ${fillerFirst} 次${(fillerLast ?? 0) <= (fillerFirst ?? 0) ? '降到' : '到'} ${fillerLast} 次`
                : `本次共 ${fillerFirst} 次`}
            </p>
            <FillerBars points={fillerPoints} />
          </>
        ) : (
          <EmptyHint text="还没有口头禅统计，去练一场吧" />
        )}
      </section>
    </div>
  );
}
