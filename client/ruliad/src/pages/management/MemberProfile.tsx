import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiError, fetchManagementMemberProfile } from '../../api';
import type { ManagementMemberProfile } from '../../types';

function fmtDate(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDuration(sec: number | null) {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

function scoreColor(score: number | null) {
  if (score == null) return '#9CA3AF';
  return score >= 80 ? '#2FAE7B' : score >= 60 ? '#F5A623' : '#FF6B5B';
}

export default function ManagementMemberProfile() {
  const navigate = useNavigate();
  const { userId } = useParams<{ userId: string }>();
  const [data, setData] = useState<ManagementMemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    fetchManagementMemberProfile(userId)
      .then(setData)
      .catch((e) => setError(apiError(e, '成员档案加载失败')))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ padding: 28, textAlign: 'center' }}>
        <p className="small muted" style={{ marginBottom: 12 }}>{error ?? '成员不存在或不在你的管理范围内'}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/management/team-ability')}>返回团队能力</button>
      </div>
    );
  }

  return (
    <div>
      {/* 成员头部 */}
      <div className="card" style={{ padding: '16px 22px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="avatar av4" style={{ width: 46, height: 46, fontSize: 18, flex: 'none' }}>{data.name[0] ?? '—'}</div>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 16 }}>{data.name}</b>
          <div className="small muted">{data.timeline.length} 场已完成会话 · {data.skillDetails.length} 项技能</div>
        </div>
        <button className="btn ghost sm" onClick={() => navigate('/management/team-ability')}>返回</button>
      </div>

      {/* 技能详情 */}
      <div className="card" style={{ padding: '18px 22px', marginBottom: 18 }}>
        <div className="bar-title"><b style={{ fontSize: 15.5 }}>技能档位</b></div>
        {data.skillDetails.length === 0 ? (
          <p className="small muted" style={{ marginTop: 10 }}>暂无技能数据</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {data.skillDetails.map((s) => {
              const latest = [...s.history].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
              return (
                <div key={s.skillPointId}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <b style={{ fontSize: 14, flex: 1 }}>{s.name}</b>
                    {s.level != null && <span className="chip chip-blue">Lv.{s.level}</span>}
                    <b style={{ fontSize: 15, color: scoreColor(latest?.score ?? null) }}>
                      {latest?.score ?? '—'} 分
                    </b>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[...s.history]
                      .sort((a, b) => a.at.localeCompare(b.at))
                      .slice(-8)
                      .map((h) => (
                        <span
                          key={`${h.sessionId}-${h.at}`}
                          className="chip chip-gray"
                          style={{ fontSize: 11.5, color: scoreColor(h.score) }}
                          title={`${fmtDate(h.at)} · ${h.mode === 'exam' ? '考核' : '练习'}`}
                        >
                          {h.score}
                        </span>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 会话时间线 */}
      <div className="card" style={{ padding: '18px 22px' }}>
        <div className="bar-title"><b style={{ fontSize: 15.5 }}>会话时间线</b></div>
        {data.timeline.length === 0 ? (
          <p className="small muted" style={{ marginTop: 10 }}>暂无已完成会话</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {data.timeline.map((t) => (
              <div key={t.sessionId} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 0' }}>
                <span style={{ fontSize: 16 }}>{t.mode === 'exam' ? '📋' : '🎯'}</span>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <b style={{ fontSize: 13.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.scenarioName}
                  </b>
                  <span className="small muted">
                    {fmtDate(t.at)} · {t.mode === 'exam' ? '考核' : '练习'}
                    {t.recTurns != null && t.recTurns > 0 && (
                      <span style={{ marginLeft: 8, color: '#4B7BEC' }}>🎙️ {t.recTurns} 轮{fmtDuration(t.recDurationSec)}</span>
                    )}
                  </span>
                </div>
                <b style={{ fontSize: 15, color: scoreColor(t.totalScore) }}>{t.totalScore ?? '—'}</b>
                {t.passed != null && (
                  <span className={`chip ${t.passed ? 'chip-green' : 'chip-coral'}`}>{t.passed ? '通过' : '未通过'}</span>
                )}
                <button
                  className="btn ghost sm"
                  onClick={() => navigate(`/management/member/${data.userId}/session/${t.sessionId}`)}
                >
                  详情与录音
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
