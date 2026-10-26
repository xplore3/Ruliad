import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getStoredUser } from '../api';
import StatusBar from '../components/StatusBar';
import type { GrowthResponse, GrowthSkill, GrowthSession } from '../types';

/* ── 默认维度（后端无数据时兜底展示） ── */
const FALLBACK_DIMENSIONS = [
  { key: 'need', name: '需求挖掘', score: 0 },
  { key: 'value', name: '价值表达', score: 0 },
  { key: 'objection', name: '异议处理', score: 0 },
  { key: 'closing', name: '推进成交', score: 0 },
  { key: 'empathy', name: '倾听共情', score: 0 },
  { key: 'clarity', name: '表达清晰', score: 0 },
];

/* 维度名称映射（将后端 skillPoint name 映射到统一维度） */
function mapSkillToDimension(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('需求') || lower.includes('挖掘')) return 'need';
  if (lower.includes('价值') || lower.includes('表达')) return 'value';
  if (lower.includes('异议') || lower.includes('处理')) return 'objection';
  if (lower.includes('成交') || lower.includes('推进') || lower.includes('close')) return 'closing';
  if (lower.includes('共情') || lower.includes('倾听')) return 'empathy';
  if (lower.includes('清晰') || lower.includes('表达')) return 'clarity';
  return lower;
}

export default function MyAbilities() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const [data, setData] = useState<GrowthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'radar' | 'trend' | 'filler'>('radar');

  useEffect(() => {
    api.get<GrowthResponse>('/growth')
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /* ── 计算维度得分 ── */
  const dimensions = useMemo(() => {
    if (!data || data.skills.length === 0) return FALLBACK_DIMENSIONS;
    const dimMap = new Map<string, { sum: number; count: number; name: string }>();
    const dimNames: Record<string, string> = {
      need: '需求挖掘',
      value: '价值表达',
      objection: '异议处理',
      closing: '推进成交',
      empathy: '倾听共情',
      clarity: '表达清晰',
    };
    for (const s of data.skills) {
      const dimKey = mapSkillToDimension(s.name);
      const score = s.currentLevel * 20;
      if (!dimMap.has(dimKey)) {
        dimMap.set(dimKey, { sum: 0, count: 0, name: dimNames[dimKey] ?? s.name });
      }
      const entry = dimMap.get(dimKey)!;
      entry.sum += score;
      entry.count += 1;
    }
    return FALLBACK_DIMENSIONS.map((d) => {
      const entry = dimMap.get(d.key);
      if (entry && entry.count > 0) {
        return { ...d, name: entry.name, score: Math.round(entry.sum / entry.count) };
      }
      return d;
    });
  }, [data]);

  const totalScore = useMemo(() => {
    const valid = dimensions.filter((d) => d.score > 0);
    if (valid.length === 0) return 0;
    return Math.round(valid.reduce((sum, d) => sum + d.score, 0) / valid.length);
  }, [dimensions]);

  const sessions = data?.sessions ?? [];
  const fillerTrend = data?.fillerTrend ?? [];

  const fillerSummary = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const f of fillerTrend) {
      for (const [word, count] of Object.entries(f.fillers)) {
        totals[word] = (totals[word] ?? 0) + count;
      }
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [fillerTrend]);

  const sessionStats = useMemo(() => {
    if (sessions.length === 0) return null;
    const total = sessions.length;
    const passed = sessions.filter((s) => s.passed).length;
    const avgScore = Math.round(sessions.reduce((sum, s) => sum + s.totalScore, 0) / total);
    const recent = sessions.slice(-5);
    return { total, passed, avgScore, recent };
  }, [sessions]);

  const scoreColor = (score: number) =>
    score >= 80 ? '#5DC7A3' : score >= 60 ? '#E85C62' : '#E85C62';

  const scoreLabel = (score: number) =>
    score >= 80 ? '优秀' : score >= 60 ? '待提升' : '需重点练习';

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: '#17191F' }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: '#A4A7B3' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="px-5 pt-2">
        <h1 className="text-xl font-bold" style={{ color: '#F7F7FA' }}>我的多维能力</h1>
        <p className="mt-1 text-xs" style={{ color: '#A4A7B3' }}>{user?.name ?? '我'} · 全陪练员技能画像</p>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm" style={{ color: '#A4A7B3' }}>加载中…</p>
        </div>
      ) : (
        <>
          {/* 综合能力卡 */}
          <div className="mx-5 mt-5 rounded-2xl p-5" style={{ backgroundColor: '#22252D' }}>
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <RadarChart dimensions={dimensions} />
              </div>
              <div className="flex-1">
                <div className="flex items-end gap-1">
                  <span className="text-5xl font-bold" style={{ color: '#F7F7FA' }}>{totalScore || '—'}</span>
                  <span className="pb-1 text-sm" style={{ color: '#A4A7B3' }}>综合能力</span>
                </div>
                <p className="mt-1 text-xs" style={{ color: '#A4A7B3' }}>
                  {sessionStats ? `已练 ${sessionStats.total} 次 · 通过 ${sessionStats.passed} 次` : '暂无训练记录'}
                </p>
                {sessionStats && (
                  <p className="mt-0.5 text-xs" style={{ color: '#A4A7B3' }}>平均得分 {sessionStats.avgScore}</p>
                )}
              </div>
            </div>
          </div>

          {/* Tab 切换 */}
          <div className="mx-5 mt-4 flex gap-2">
            {[
              { key: 'radar' as const, label: '维度详情', icon: '📊' },
              { key: 'trend' as const, label: '训练趋势', icon: '📈' },
              { key: 'filler' as const, label: '口头禅', icon: '💬' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition"
                style={tab === t.key ? { backgroundColor: '#E85C62', color: '#17191F' } : { backgroundColor: '#22252D', color: '#A4A7B3' }}
              >
                <span>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── 维度详情 ── */}
          {tab === 'radar' && (
            <div className="mx-5 mt-4 space-y-3">
              {dimensions.map((dim) => (
                <div key={dim.key} className="rounded-2xl p-4" style={{ backgroundColor: '#22252D' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-bold" style={{ color: '#F7F7FA' }}>{dim.name}</span>
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-bold"
                        style={{
                          backgroundColor: dim.score > 0 ? `${scoreColor(dim.score)}20` : 'rgba(255,255,255,0.06)',
                          color: dim.score > 0 ? scoreColor(dim.score) : '#A4A7B3',
                        }}
                      >
                        {dim.score > 0 ? scoreLabel(dim.score) : '未练习'}
                      </span>
                      <span className="text-lg font-bold" style={{ color: dim.score > 0 ? scoreColor(dim.score) : '#A4A7B3' }}>
                        {dim.score > 0 ? dim.score : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${dim.score}%`, backgroundColor: dim.score > 0 ? scoreColor(dim.score) : 'rgba(255,255,255,0.1)' }}
                    />
                  </div>
                </div>
              ))}

              {data && data.skills.length > 0 && (
                <div className="mt-2">
                  <h2 className="px-1 text-sm font-bold" style={{ color: '#F7F7FA' }}>技能点明细</h2>
                  <div className="mt-2 space-y-2">
                    {data.skills.map((s) => (
                      <SkillDetail key={s.skillPointId} skill={s} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 训练趋势 ── */}
          {tab === 'trend' && (
            <div className="mx-5 mt-4 space-y-3">
              {sessionStats ? (
                <>
                  <div className="rounded-2xl p-4" style={{ backgroundColor: '#22252D' }}>
                    <h2 className="text-sm font-bold" style={{ color: '#F7F7FA' }}>得分趋势</h2>
                    <TrendChart sessions={sessionStats.recent} />
                  </div>
                  <div className="rounded-2xl p-4" style={{ backgroundColor: '#22252D' }}>
                    <h2 className="text-sm font-bold" style={{ color: '#F7F7FA' }}>最近训练</h2>
                    <div className="mt-3 space-y-2">
                      {sessionStats.recent.map((s, i) => (
                        <div key={s.sessionId} className="flex items-center gap-3">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: '#A4A7B3' }}>
                            {sessionStats.recent.length - i}
                          </span>
                          <div className="flex-1">
                            <p className="text-xs font-bold" style={{ color: '#F7F7FA' }}>{s.scenarioName ?? '对练'}</p>
                            <p className="text-xs" style={{ color: '#A4A7B3' }}>{formatDate(s.at)} · {s.mode === 'exam' ? '考核' : '练习'}</p>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-bold" style={{ color: scoreColor(s.totalScore) }}>{s.totalScore}</span>
                            <span className="ml-1.5 text-xs" style={{ color: s.passed ? '#5DC7A3' : '#A4A7B3' }}>
                              {s.passed ? '✓' : '✗'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl p-10" style={{ backgroundColor: '#22252D' }}>
                  <span className="text-4xl">📊</span>
                  <p className="mt-3 text-sm" style={{ color: '#A4A7B3' }}>暂无训练数据</p>
                  <button
                    onClick={() => navigate('/practice')}
                    className="mt-4 rounded-xl px-6 py-2.5 text-sm font-bold"
                    style={{ backgroundColor: '#E85C62', color: '#17191F' }}
                  >
                    去练习
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── 口头禅分析 ── */}
          {tab === 'filler' && (
            <div className="mx-5 mt-4 space-y-3">
              {fillerSummary.length > 0 ? (
                <>
                  <div className="rounded-2xl p-4" style={{ backgroundColor: '#22252D' }}>
                    <h2 className="text-sm font-bold" style={{ color: '#F7F7FA' }}>高频口头禅</h2>
                    <p className="mt-1 text-xs" style={{ color: '#A4A7B3' }}>跨所有对练会话的累计统计</p>
                    <div className="mt-3 space-y-3">
                      {fillerSummary.map(([word, count]) => {
                        const maxCount = fillerSummary[0][1];
                        const ratio = maxCount > 0 ? count / maxCount : 0;
                        return (
                          <div key={word}>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-bold" style={{ color: '#F7F7FA' }}>"{word}"</span>
                              <span className="text-xs" style={{ color: '#A4A7B3' }}>{count} 次</span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${ratio * 100}%`, backgroundColor: '#E85C62' }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(232,92,98,0.08)' }}>
                    <p className="text-sm font-bold" style={{ color: '#E85C62' }}>💡 改善建议</p>
                    <p className="mt-2 text-xs leading-relaxed" style={{ color: '#A4A7B3' }}>
                      口头禅会在对练中降低专业感。建议在下次练习时刻意注意高频词汇，用停顿代替填充词，提升表达的精炼度。
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl p-10" style={{ backgroundColor: '#22252D' }}>
                  <span className="text-4xl">💬</span>
                  <p className="mt-3 text-sm" style={{ color: '#A4A7B3' }}>暂无口头禅分析数据</p>
                  <p className="mt-1 text-xs" style={{ color: '#A4A7B3', opacity: 0.6 }}>完成对练后自动生成</p>
                </div>
              )}
            </div>
          )}

          {/* 已获认证 */}
          {data && data.certs.length > 0 && (
            <div className="mx-5 mt-4">
              <h2 className="text-sm font-bold" style={{ color: '#F7F7FA' }}>已获认证</h2>
              <div className="mt-2 space-y-2">
                {data.certs.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-2xl p-4" style={{ backgroundColor: '#22252D' }}>
                    <span className="text-2xl">🏆</span>
                    <div className="flex-1">
                      <p className="text-sm font-bold" style={{ color: '#F7F7FA' }}>{c.examWindowName ?? '考核认证'}</p>
                      <p className="text-xs" style={{ color: '#A4A7B3' }}>{formatDate(c.issuedAt)}</p>
                    </div>
                    <span className="text-lg font-bold" style={{ color: '#5DC7A3' }}>{c.totalScore}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1" />
          <div className="h-6" />
        </>
      )}
    </div>
  );
}

/* ────── 雷达图 ────── */
function RadarChart({ dimensions }: { dimensions: { name: string; score: number }[] }) {
  const W = 160;
  const H = 160;
  const CX = W / 2;
  const CY = H / 2;
  const R = 55;
  const n = dimensions.length;
  const angleAt = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const vertex = (i: number, ratio: number) => ({
    x: CX + Math.cos(angleAt(i)) * R * ratio,
    y: CY + Math.sin(angleAt(i)) * R * ratio,
  });

  const valuePoints = dimensions
    .map((d, i) => { const p = vertex(i, Math.max(d.score, 5) / 100); return `${p.x},${p.y}`; })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-40">
      {[1, 2, 3, 4, 5].map((level) => (
        <polygon
          key={level}
          points={dimensions.map((_, i) => { const p = vertex(i, level / 5); return `${p.x},${p.y}`; }).join(' ')}
          fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1"
        />
      ))}
      {dimensions.map((_, i) => {
        const p = vertex(i, 1);
        return <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />;
      })}
      <polygon points={valuePoints} fill="rgba(232,92,98,0.2)" stroke="#E85C62" strokeWidth="1.5" />
      {dimensions.map((d, i) => {
        const label = vertex(i, 1.35);
        return <text key={d.name} x={label.x} y={label.y + 3} fontSize="8" fill="#A4A7B3" textAnchor="middle">{d.name.slice(0, 2)}</text>;
      })}
    </svg>
  );
}

/* ────── 趋势折线图 ────── */
function TrendChart({ sessions }: { sessions: GrowthSession[] }) {
  const W = 280;
  const H = 120;
  const PAD = 30;
  if (sessions.length === 0) return <p className="mt-3 text-xs" style={{ color: '#A4A7B3' }}>暂无趋势数据</p>;

  const scores = sessions.map((s) => s.totalScore);
  const maxScore = Math.max(...scores, 100);
  const minScore = Math.min(...scores, 0);
  const range = maxScore - minScore || 1;

  const xStep = sessions.length > 1 ? (W - PAD * 2) / (sessions.length - 1) : 0;
  const points = sessions.map((s, i) => ({
    x: PAD + i * xStep,
    y: H - PAD - ((s.totalScore - minScore) / range) * (H - PAD * 2),
    score: s.totalScore,
    passed: s.passed,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x} ${H - PAD} L ${points[0].x} ${H - PAD} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full">
      <text x="5" y={PAD} fontSize="9" fill="#A4A7B3">{maxScore}</text>
      <text x="5" y={H - PAD + 3} fontSize="9" fill="#A4A7B3">{minScore}</text>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <line x1={PAD} y1={PAD} x2={W - PAD} y2={PAD} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3,3" />
      <path d={areaD} fill="rgba(232,92,98,0.1)" />
      <path d={pathD} fill="none" stroke="#E85C62" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill={p.passed ? '#5DC7A3' : '#E85C62'} stroke="#22252D" strokeWidth="1.5" />
          <text x={p.x} y={p.y - 8} fontSize="9" fill="#F7F7FA" textAnchor="middle">{p.score}</text>
        </g>
      ))}
    </svg>
  );
}

/* ────── 技能明细行 ────── */
function SkillDetail({ skill }: { skill: GrowthSkill }) {
  const score = skill.currentLevel * 20;
  const color = score >= 80 ? '#5DC7A3' : score >= 60 ? '#E85C62' : '#E85C62';
  const latest = skill.history[skill.history.length - 1];

  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold" style={{ color: '#F7F7FA' }}>{skill.name}</span>
        <span className="text-sm font-bold" style={{ color }}>{score}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
        </div>
        <span className="text-xs" style={{ color: '#A4A7B3' }}>Lv.{skill.currentLevel}</span>
      </div>
      {latest && (
        <p className="mt-1.5 text-xs" style={{ color: '#A4A7B3' }}>
          最近：{formatDate(latest.at)} · {latest.score} 分 · {latest.mode === 'exam' ? '考核' : '练习'}
        </p>
      )}
    </div>
  );
}

/* ────── 工具 ────── */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return iso;
  }
}
