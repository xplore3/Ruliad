import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiError, fetchGrowth, fetchMySessions, fetchScenarios } from '../api';
import type { MySessionRecord } from '../api';
import type { GrowthData, Scenario, UserSkillState } from '../types';

// ===== 工具函数 =====

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** 技能得分：优先取 history 最新分数，否则按 currentLevel/maxLevel 折算 */
function skillScore(skill: UserSkillState): number {
  if (skill.history.length > 0) {
    const sorted = [...skill.history].sort((a, b) => a.at.localeCompare(b.at));
    return Math.round(sorted[sorted.length - 1].score);
  }
  const max = skill.maxLevel || 5;
  return Math.round((skill.currentLevel / max) * 100);
}

function sortedHistory(skill: UserSkillState) {
  return [...skill.history].sort((a, b) => a.at.localeCompare(b.at));
}

function trendStatus(hist: { score: number }[]): string {
  if (hist.length < 2) return '数据不足';
  const diff = hist[hist.length - 1].score - hist[hist.length - 2].score;
  if (diff > 0) return '稳步上升';
  if (diff < 0) return '有所下滑';
  return '持平';
}

/** 连续天数（以今天或昨天结尾）与最长连续纪录 */
function streaks(dateKeys: Set<string>): { current: number; longest: number } {
  let current = 0;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  if (!dateKeys.has(dayKey(t))) t.setDate(t.getDate() - 1);
  while (dateKeys.has(dayKey(t))) {
    current++;
    t.setDate(t.getDate() - 1);
  }
  const sorted = [...dateKeys]
    .map((k) => {
      const [y, m, d] = k.split('-').map(Number);
      return new Date(y, m, d).getTime();
    })
    .sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev = -1;
  for (const ts of sorted) {
    run = prev >= 0 && ts - prev === 86400000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = ts;
  }
  return { current, longest };
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<GrowthData | null>(null);
  const [mySessions, setMySessions] = useState<MySessionRecord[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');

  useEffect(() => {
    Promise.all([
      fetchGrowth(),
      fetchMySessions().catch(() => ({ records: [] as MySessionRecord[] })),
      fetchScenarios().catch(() => ({ scenarios: [] as Scenario[] })),
    ])
      .then(([growth, mine, sc]) => {
        setData(growth);
        setMySessions(mine.records);
        setScenarios(sc.scenarios);
      })
      .catch((e) => setError(apiError(e, '看板数据加载失败')))
      .finally(() => setLoading(false));
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const days = Number(period);
    const cutoff = new Date(now.getTime() - days * 86400000);
    const prevCutoff = new Date(now.getTime() - days * 2 * 86400000);

    const inPeriod = data.sessions.filter((s) => new Date(s.at) >= cutoff);
    const prevPeriod = data.sessions.filter((s) => {
      const t = new Date(s.at);
      return t >= prevCutoff && t < cutoff;
    });
    const avg = inPeriod.length > 0
      ? Math.round(inPeriod.reduce((sum, s) => sum + s.totalScore, 0) / inPeriod.length)
      : null;
    const prevAvg = prevPeriod.length > 0
      ? Math.round(prevPeriod.reduce((sum, s) => sum + s.totalScore, 0) / prevPeriod.length)
      : null;
    const avgDiff = avg != null && prevAvg != null ? avg - prevAvg : null;

    const weekStart = startOfWeek(now);
    const weekCount = data.sessions.filter((s) => new Date(s.at) >= weekStart).length;

    const totalSec = mySessions.reduce((sum, r) => sum + (r.durationSec ?? 0), 0);
    const dateKeys = new Set(data.sessions.map((s) => dayKey(new Date(s.at))));
    const { current, longest } = streaks(dateKeys);

    const totalSessions = data.sessions.length;
    const hasNight = data.sessions.some((s) => {
      const h = new Date(s.at).getHours();
      return h >= 23 || h < 5;
    });
    const bestScore = data.sessions.reduce((m, s) => Math.max(m, s.totalScore), 0);

    const badges = [
      { icon: '🎯', name: '首次练习', unlocked: totalSessions >= 1 },
      { icon: '🔥', name: '连续 3 天', unlocked: longest >= 3 },
      { icon: '📅', name: '连续 7 天', unlocked: longest >= 7 },
      { icon: '📞', name: '累计 10 场', unlocked: totalSessions >= 10 },
      { icon: '🏅', name: '累计 30 场', unlocked: totalSessions >= 30 },
      { icon: '🌙', name: '深夜练习', unlocked: hasNight },
      { icon: '🛡️', name: '单场上 80 分', unlocked: bestScore >= 80 },
      { icon: '👑', name: '满分王者', unlocked: bestScore >= 100 },
    ];

    return { avg, avgDiff, weekCount, totalSec, current, longest, badges, totalSessions };
  }, [data, mySessions, period]);

  if (loading) {
    return (
      <div className="wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 260, paddingTop: 10 }}>
        <div className="spinner" />
      </div>
    );
  }

  if (error || !data || !derived) {
    return (
      <main className="wrap" style={{ paddingTop: 10 }}>
        <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <p style={{ marginBottom: '16px' }}>{error ?? '看板数据加载失败'}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </main>
    );
  }

  // 按分数升序取最弱两项用于专项训练
  const weakest = [...data.skills]
    .sort((a, b) => skillScore(a) - skillScore(b))
    .slice(0, 2);

  const scenariosFor = (skill: UserSkillState) =>
    scenarios.filter((s) => s.skillPointNames?.includes(skill.name)).slice(0, 2);

  const hours = derived.totalSec / 3600;
  const durationValue = hours >= 1 ? (Math.round(hours * 10) / 10).toString() : String(Math.round(derived.totalSec / 60));
  const durationUnit = hours >= 1 ? '小时' : '分钟';

  return (
    <main className="wrap" style={{ paddingTop: 10 }}>
      {/* 页头：保留 7/30/90 切换 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 className="bar-title">能力看板</h2>
        <div className="seg">
          {(['7', '30', '90'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={period === p ? 'on' : ''}
            >
              {p}天
            </button>
          ))}
        </div>
      </div>

      {/* 1. 总览统计 */}
      <div className="stats">
        <div className="card stat">
          <div className="lb">综合能力</div>
          <div className="vl" style={{ color: '#FF6B5B' }}>
            {derived.avg != null ? <>{derived.avg} <small>分</small></> : '—'}
          </div>
          {derived.avgDiff != null ? (
            <div className="sub" style={{ color: derived.avgDiff >= 0 ? '#2FAE7B' : '#FF6B5B' }}>
              {derived.avgDiff >= 0 ? '↑' : '↓'} 较上周期 {derived.avgDiff >= 0 ? '+' : ''}{derived.avgDiff}
            </div>
          ) : (
            <div className="sub muted">近 {period} 天</div>
          )}
        </div>
        <div className="card stat">
          <div className="lb">本周练习</div>
          <div className="vl">{derived.weekCount} <small>次</small></div>
          <div className="sub muted">累计 {derived.totalSessions} 场</div>
        </div>
        <div className="card stat">
          <div className="lb">累计时长</div>
          <div className="vl">{durationValue} <small>{durationUnit}</small></div>
          <div className="sub muted">共 {mySessions.length} 场</div>
        </div>
        <div className="card stat">
          <div className="lb">连续练习</div>
          <div className="vl">{derived.current} <small>天</small>{derived.current > 0 ? ' 🔥' : ''}</div>
          <div className="sub muted">最长纪录 {derived.longest} 天</div>
        </div>
      </div>

      <hr className="sec-divider" />

      {/* 2. 多维能力分析 */}
      <div className="sec-head" style={{ marginTop: 28 }}>
        <h2 className="bar-title">多维能力分析</h2>
        <span className="more">近 {period} 天 · 全部模式</span>
      </div>
      <div className="card radar-grid sec">
        {data.skills.length === 0 ? (
          <p className="small muted" style={{ padding: '24px 0' }}>还没有能力数据，完成一次练习后这里会展示你的能力雷达</p>
        ) : (
          <>
            <RadarChart skills={data.skills} />
            <div>
              {data.skills.slice(0, 6).map((skill) => {
                const score = skillScore(skill);
                const isWeak = score < 60;
                const hist = sortedHistory(skill);
                return (
                  <div key={skill.skillPointId} className="dim-row">
                    <span className="nm" style={isWeak ? { color: '#FF6B5B' } : undefined}>{skill.name}</span>
                    <span className="sc" style={isWeak ? { color: '#FF6B5B' } : undefined}>{score}</span>
                    <MiniTrend scores={hist.slice(-6).map((h) => h.score)} />
                    <span className="st" style={isWeak ? { color: '#FF6B5B' } : undefined}>{trendStatus(hist)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 3. 专项能力训练 */}
      <div className="sec-head" style={{ marginTop: 28 }}>
        <h2 className="bar-title">专项能力训练</h2>
        <span className="more">针对最弱维度推荐场景</span>
      </div>
      <div className="card sec">
        {weakest.length === 0 ? (
          <p className="small muted">完成一次练习后，这里会针对你的薄弱维度推荐训练场景</p>
        ) : (
          weakest.map((skill) => {
            const score = skillScore(skill);
            const isCoral = score < 60;
            const recs = scenariosFor(skill);
            return (
              <div key={skill.skillPointId} className="train-item">
                <div className="left">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <b>{skill.name}</b>
                    <span className={`chip ${isCoral ? 'chip-coral' : 'chip-amber'}`}>{score} 分 · {isCoral ? '待提升' : '可突破'}</span>
                  </div>
                </div>
                <div className="mini-cards" style={{ flex: 2, minWidth: '280px' }}>
                  {recs.length === 0 ? (
                    <p className="small muted">暂无匹配该技能的训练场景</p>
                  ) : (
                    recs.map((sc, idx) => (
                      <div key={sc.id} className="mini">
                        <span className={`chip ${idx % 2 === 0 ? 'blue' : 'coral'}`} style={{ alignSelf: 'flex-start' }}>
                          难度 {sc.difficulty}
                        </span>
                        <b style={{ fontSize: '13.5px' }}>{sc.name}</b>
                        <button className="btn primary sm" style={{ alignSelf: 'flex-start', marginTop: '4px' }}
                          onClick={() => navigate(`/scenario/${sc.id}`)}>去训练</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <hr className="sec-divider" />

      {/* 4. 练习热力 */}
      <div className="sec-head" style={{ marginTop: 28 }}>
        <h2 className="bar-title">练习热力</h2>
        <span className="more">近 12 周</span>
      </div>
      <div className="card heat sec">
        <Heatmap sessions={data.sessions} />
        <div className="legend">
          少
          <i style={{ background: '#F1F1F4' }} />
          <i style={{ background: '#FFDDD7' }} />
          <i style={{ background: '#FFB3A8' }} />
          <i style={{ background: '#FF8A7B' }} />
          <i style={{ background: '#FF6B5B' }} />
          多
        </div>
      </div>

      <hr className="sec-divider" />

      {/* 5. 成长里程碑 */}
      <div className="sec-head" style={{ marginTop: 28 }}>
        <h2 className="bar-title">成长里程碑</h2>
        <span className="more">已解锁 {derived.badges.filter((b) => b.unlocked).length} / {derived.badges.length}</span>
      </div>
      <div className="card sec" style={{ padding: '22px 24px' }}>
        <div className="badges">
          {derived.badges.map((badge) => (
            <div key={badge.name} className={`badge ${badge.unlocked ? '' : 'lock'}`}>
              <div className="b">{badge.icon}</div>
              <span>{badge.name}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

// ===== 子组件 =====

function RadarChart({ skills }: { skills: GrowthData['skills'] }) {
  const size = 220;
  const center = size / 2;
  const maxRadius = 80;

  if (skills.length === 0) return null;

  const points = skills.slice(0, 6);
  const angleStep = (2 * Math.PI) / points.length;
  const ratioOf = (s: UserSkillState) => Math.max(0.05, Math.min(1, skillScore(s) / 100));

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="300" height="220" viewBox={`0 0 ${size} ${size}`}>
        {/* 网格 */}
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <polygon
            key={ratio}
            fill="none"
            stroke="#EBEBEF"
            strokeWidth="1"
            points={points.map((_, i) => {
              const angle = angleStep * i - Math.PI / 2;
              const r = maxRadius * ratio;
              return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
            }).join(' ')}
          />
        ))}
        {/* 轴线 */}
        {points.map((_, i) => {
          const angle = angleStep * i - Math.PI / 2;
          return (
            <line key={i} x1={center} y1={center}
              x2={center + maxRadius * Math.cos(angle)}
              y2={center + maxRadius * Math.sin(angle)}
              stroke="#EBEBEF" strokeWidth="1" />
          );
        })}
        {/* 数据区域 */}
        <polygon
          fill="rgba(255,107,91,.25)"
          stroke="#FF6B5B"
          strokeWidth="2"
          points={points.map((s, i) => {
            const angle = angleStep * i - Math.PI / 2;
            const r = maxRadius * ratioOf(s);
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
          }).join(' ')}
        />
        {/* 数据点 */}
        {points.map((s, i) => {
          const angle = angleStep * i - Math.PI / 2;
          const r = maxRadius * ratioOf(s);
          return (
            <circle key={i}
              cx={center + r * Math.cos(angle)}
              cy={center + r * Math.sin(angle)}
              r="4" fill="#FF6B5B" />
          );
        })}
        {/* 标签 */}
        {points.map((s, i) => {
          const angle = angleStep * i - Math.PI / 2;
          const labelR = maxRadius + 24;
          const isWeak = skillScore(s) < 60;
          return (
            <text key={i}
              x={center + labelR * Math.cos(angle)}
              y={center + labelR * Math.sin(angle)}
              textAnchor="middle" dominantBaseline="middle"
              fontSize="10"
              fill={isWeak ? '#FF6B5B' : '#6B7280'}
              fontWeight={isWeak ? '700' : '400'}
            >
              {s.name}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function MiniTrend({ scores }: { scores: number[] }) {
  const w = 60;
  const h = 24;
  let pointsAttr: string;
  let color = '#9CA3AF';
  if (scores.length >= 2) {
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min || 1;
    const step = w / (scores.length - 1);
    pointsAttr = scores
      .map((s, i) => `${(i * step).toFixed(1)},${(h - 3 - ((s - min) / range) * (h - 6)).toFixed(1)}`)
      .join(' ');
    color = scores[scores.length - 1] >= scores[0] ? '#2FAE7B' : '#FF6B5B';
  } else {
    pointsAttr = `0,${h / 2} ${w},${h / 2}`;
  }
  return (
    <svg width={w} height={h} style={{ flexShrink: 0 }}>
      <polyline points={pointsAttr} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function Heatmap({ sessions }: { sessions: GrowthData['sessions'] }) {
  const cells = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      const k = dayKey(new Date(s.at));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const arr: { level: number; label: string }[] = [];
    for (let i = 83; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const n = counts.get(dayKey(d)) ?? 0;
      const level = n >= 4 ? 4 : n;
      arr.push({
        level,
        label: `${d.getMonth() + 1}月${d.getDate()}日 · ${n} 场`,
      });
    }
    return arr;
  }, [sessions]);

  return (
    <div className="heat-grid">
      {cells.map((cell, i) => (
        <i
          key={i}
          className={cell.level > 0 ? `l${cell.level}` : ''}
          title={cell.label}
        />
      ))}
    </div>
  );
}
