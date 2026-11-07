import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiError, fetchGrowth, fetchMySessions } from '../api';
import type { MySessionRecord } from '../api';
import type { GrowthData, UserSkillState } from '../types';

/** 技能档位阈值：Lv.N 需要得分 ≥ N*20（Lv.5 满分） */
const LEVEL_COUNT = 5;
const levelThreshold = (level: number) => level * 20;

function skillScore(skill: UserSkillState): number {
  if (skill.history.length === 0) return 0;
  const sorted = [...skill.history].sort((a, b) => a.at.localeCompare(b.at));
  return Math.round(sorted[sorted.length - 1].score);
}

function levelOf(score: number): number {
  return Math.min(LEVEL_COUNT, Math.max(0, Math.floor(score / 20)));
}

function trendOf(history: { at: string; score: number }[]): { label: string; dir: 'up' | 'down' | 'flat' } {
  if (history.length < 2) return { label: '数据不足', dir: 'flat' };
  const sorted = [...history].sort((a, b) => a.at.localeCompare(b.at));
  const diff = sorted[sorted.length - 1].score - sorted[sorted.length - 2].score;
  if (diff > 0) return { label: `+${diff}`, dir: 'up' };
  if (diff < 0) return { label: `${diff}`, dir: 'down' };
  return { label: '持平', dir: 'flat' };
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function Ability() {
  const navigate = useNavigate();
  const [data, setData] = useState<GrowthData | null>(null);
  const [records, setRecords] = useState<MySessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchGrowth(),
      fetchMySessions().catch(() => ({ records: [] as MySessionRecord[] })),
    ])
      .then(([g, r]) => {
        setData(g);
        setRecords(r.records);
      })
      .catch((e) => setError(apiError(e, '能力数据加载失败')))
      .finally(() => setLoading(false));
  }, []);

  const skills = useMemo(() => {
    if (!data) return [];
    return [...data.skills]
      .map((s) => ({
        ...s,
        score: skillScore(s),
        level: Math.min(LEVEL_COUNT, Math.max(s.currentLevel ?? levelOf(skillScore(s)), 0)),
        trend: trendOf(s.history),
      }))
      .sort((a, b) => b.score - a.score);
  }, [data]);

  const overall = useMemo(() => {
    if (skills.length === 0) return null;
    const avg = Math.round(skills.reduce((sum, s) => sum + s.score, 0) / skills.length);
    const maxLevel = Math.max(...skills.map((s) => s.level));
    return { avg, maxLevel };
  }, [skills]);

  const completed = useMemo(
    () => records.filter((r) => r.status === 'completed' && r.totalScore != null),
    [records]
  );

  const weakest = useMemo(() => [...skills].sort((a, b) => a.score - b.score).slice(0, 2), [skills]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="wrap" style={{ paddingTop: 10 }}>
      {/* 页头 */}
      <div className="sec-head">
        <h2 className="bar-title">能力进阶图</h2>
        <span className="more">练习越多 · 档位越高</span>
      </div>

      {error && (
        <div className="card" style={{ padding: '24px', textAlign: 'center', marginBottom: 18 }}>
          <p className="small muted" style={{ marginBottom: 12 }}>{error}</p>
          <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      )}

      {!error && skills.length === 0 && (
        <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📈</div>
          <h3 style={{ marginBottom: 8 }}>还没有能力数据</h3>
          <p className="small muted" style={{ marginBottom: 18 }}>
            完成一次练习后，这里会生成你的能力进阶图
          </p>
          <Link to="/home" className="btn btn-primary">去练习</Link>
        </div>
      )}

      {!error && skills.length > 0 && (
        <>
          {/* 总览 */}
          <div className="stats" style={{ marginBottom: 28 }}>
            <div className="card stat">
              <div className="lb">综合得分</div>
              <div className="vl" style={{ color: '#FF6B5B' }}>
                {overall?.avg ?? '—'} <small>分</small>
              </div>
              <div className="sub muted">全部技能均值</div>
            </div>
            <div className="card stat">
              <div className="lb">已练技能</div>
              <div className="vl">{skills.length} <small>项</small></div>
              <div className="sub muted">最高 Lv.{overall?.maxLevel ?? 0}</div>
            </div>
            <div className="card stat">
              <div className="lb">累计练习</div>
              <div className="vl">{completed.length} <small>场</small></div>
              <div className="sub muted">已出报告</div>
            </div>
            <div className="card stat">
              <div className="lb">认证</div>
              <div className="vl">{data?.certs.length ?? 0} <small>张</small></div>
              <div className="sub muted">通过考核获得</div>
            </div>
          </div>

          {/* 进阶地图 */}
          <div className="sec-head">
            <h2 className="bar-title">进阶地图</h2>
            <span className="more">档位 Lv.0 - Lv.5</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
            {skills.map((skill) => {
              const nextLevel = Math.min(LEVEL_COUNT, skill.level + 1);
              const nextThreshold = levelThreshold(nextLevel);
              const gap = skill.level >= LEVEL_COUNT ? 0 : Math.max(0, nextThreshold - skill.score);
              return (
                <div key={skill.skillPointId} className="card" style={{ padding: '18px 22px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <b style={{ fontSize: 16 }}>{skill.name}</b>
                        <span className={`chip ${skill.score >= 80 ? 'chip-green' : skill.score >= 60 ? 'chip-amber' : 'chip-coral'}`}>
                          Lv.{skill.level}
                        </span>
                      </div>
                      <div className="small muted" style={{ marginTop: 4 }}>
                        {skill.history.length} 次练习记录
                        {skill.trend.dir !== 'flat' && (
                          <span style={{ color: skill.trend.dir === 'up' ? '#2FAE7B' : '#FF6B5B', marginLeft: 8 }}>
                            {skill.trend.dir === 'up' ? '↑' : '↓'} {skill.trend.label}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: skill.score >= 80 ? '#2FAE7B' : skill.score >= 60 ? '#F5A623' : '#FF6B5B' }}>
                        {skill.score}
                        <span style={{ fontSize: 12, fontWeight: 400, color: '#6B7280', marginLeft: 4 }}>分</span>
                      </div>
                      <div className="small muted">
                        {skill.level >= LEVEL_COUNT ? '已达最高档位' : `距 Lv.${nextLevel} 还差 ${gap} 分`}
                      </div>
                    </div>
                  </div>

                  {/* 档位轨道 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
                    {Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1).map((lv) => {
                      const reached = lv <= skill.level;
                      const isCurrent = lv === skill.level;
                      const isNext = lv === skill.level + 1;
                      return (
                        <div key={lv} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div
                            style={{
                              width: 26, height: 26, borderRadius: '50%', flex: 'none',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 700, fontSize: 12,
                              border: reached ? 'none' : '1.5px solid #EBEBEF',
                              background: reached ? '#FF6B5B' : '#F7F7FA',
                              color: reached ? '#fff' : '#9CA3AF',
                              boxShadow: isCurrent ? '0 0 0 4px rgba(255,107,91,.18)' : 'none',
                            }}
                            title={`Lv.${lv} 需 ${levelThreshold(lv)} 分`}
                          >
                            {lv}
                          </div>
                          {lv < LEVEL_COUNT && (
                            <div style={{ flex: 1, height: 2, background: lv < skill.level ? '#FF6B5B' : '#EBEBEF', borderRadius: 2 }} />
                          )}
                          {isNext && <span className="small" style={{ color: '#FF6B5B', whiteSpace: 'nowrap' }}>下一档</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* 得分趋势 */}
                  {skill.history.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <Sparkline points={skill.history.map((h) => h.score).slice(-10)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 进阶建议 */}
          {weakest.length > 0 && (
            <>
              <div className="sec-head">
                <h2 className="bar-title">进阶建议</h2>
                <span className="more">优先补齐薄弱技能</span>
              </div>
              <div className="card" style={{ padding: '16px 22px', marginBottom: 28 }}>
                {weakest.map((skill) => (
                  <div key={skill.skillPointId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                    <span style={{ fontSize: 22 }}>🎯</span>
                    <div style={{ flex: 1 }}>
                      <b style={{ fontSize: 14.5 }}>{skill.name}</b>
                      <div className="small muted">当前 Lv.{skill.level} · {skill.score} 分，再得 {Math.max(0, levelThreshold(Math.min(LEVEL_COUNT, skill.level + 1)) - skill.score)} 分可升级</div>
                    </div>
                    <Link to="/home" className="btn btn-soft btn-sm">去训练</Link>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 最近练习 */}
          <div className="sec-head">
            <h2 className="bar-title">最近练习</h2>
            <Link to="/practice-records" className="more" style={{ color: '#FF6B5B' }}>全部记录 ›</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 28 }}>
            {records.slice(0, 6).map((r) => (
              <div
                key={r.sessionId}
                className="card"
                style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                onClick={() => r.status === 'completed' && r.totalScore != null && navigate(`/review/${r.sessionId}`)}
              >
                <div className={`avatar ${r.mode === 'exam' ? 'av3' : 'av1'}`} style={{ width: 38, height: 38, fontSize: 16, flex: 'none' }}>
                  {r.mode === 'exam' ? '📋' : '🎯'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 14.5 }}>{r.scenarioName ?? '练习场景'}</b>
                  <div className="small muted">{fmtDate(r.at)} · {r.mode === 'exam' ? '考核' : '练习'}</div>
                </div>
                {r.totalScore != null ? (
                  <b style={{ fontSize: 18, color: r.totalScore >= 80 ? '#2FAE7B' : r.totalScore >= 60 ? '#F5A623' : '#FF6B5B' }}>
                    {r.totalScore}
                  </b>
                ) : (
                  <span className="small muted">未完成</span>
                )}
              </div>
            ))}
            {records.length === 0 && (
              <div className="card" style={{ padding: '24px', textAlign: 'center' }}>
                <p className="small muted">暂无练习记录</p>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}

/** 得分趋势迷你图 */
function Sparkline({ points }: { points: number[] }) {
  const w = 260;
  const h = 36;
  if (points.length === 0) return null;
  if (points.length === 1) {
    return (
      <div style={{ width: w, height: h, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="small muted">单次 {points[0]} 分</span>
      </div>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => `${(i * step).toFixed(1)},${(h - 4 - ((p - min) / range) * (h - 8)).toFixed(1)}`);
  const rising = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: '100%' }}>
      <polyline points={coords.join(' ')} fill="none" stroke={rising ? '#2FAE7B' : '#FF6B5B'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c, i) => {
        const [cx, cy] = c.split(',');
        return <circle key={i} cx={cx} cy={cy} r={i === coords.length - 1 ? 3.5 : 2} fill={rising ? '#2FAE7B' : '#FF6B5B'} />;
      })}
    </svg>
  );
}
