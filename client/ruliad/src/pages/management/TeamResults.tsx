import { Fragment, useEffect, useState } from 'react';
import { apiError, fetchManagementTeamResults } from '../../api';
import type { ManagementTeamResults } from '../../types';

function fmtDate(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function scoreColor(score: number | null) {
  if (score == null) return '#9CA3AF';
  return score >= 80 ? '#2FAE7B' : score >= 60 ? '#F5A623' : '#FF6B5B';
}

export default function ManagementTeamResults() {
  const [data, setData] = useState<ManagementTeamResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetchManagementTeamResults()
      .then(setData)
      .catch((e) => setError(apiError(e, '团队成果加载失败')))
      .finally(() => setLoading(false));
  }, []);

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
        <p className="small muted" style={{ marginBottom: 12 }}>{error ?? '加载失败'}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );
  }

  const { summary, members } = data;

  return (
    <div>
      {/* 汇总 */}
      <div className="stats" style={{ marginBottom: 18 }}>
        <div className="card stat">
          <div className="lb">团队成员</div>
          <div className="vl">{summary.memberCount} <small>人</small></div>
        </div>
        <div className="card stat">
          <div className="lb">考核人次</div>
          <div className="vl">{summary.examAttempts} <small>次</small></div>
        </div>
        <div className="card stat">
          <div className="lb">已认证</div>
          <div className="vl" style={{ color: '#2FAE7B' }}>{summary.certifiedCount} <small>人</small></div>
        </div>
        <div className="card stat">
          <div className="lb">认证率</div>
          <div className="vl">{summary.certRate ?? '—'}<small>{summary.certRate != null ? ' %' : ''}</small></div>
        </div>
        <div className="card stat">
          <div className="lb">平均最近分</div>
          <div className="vl">{summary.avgScore ?? '—'}<small>{summary.avgScore != null ? ' 分' : ''}</small></div>
        </div>
      </div>

      {/* 成员明细 */}
      <div className="card" style={{ padding: '8px 18px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 12.5, color: '#6B7280' }}>
              <th style={{ padding: '12px 10px', fontWeight: 600 }}>成员</th>
              <th style={{ padding: '12px 10px', fontWeight: 600 }}>团队</th>
              <th style={{ padding: '12px 10px', fontWeight: 600 }}>考核次数</th>
              <th style={{ padding: '12px 10px', fontWeight: 600 }}>通过次数</th>
              <th style={{ padding: '12px 10px', fontWeight: 600 }}>最高分</th>
              <th style={{ padding: '12px 10px', fontWeight: 600 }}>最近分</th>
              <th style={{ padding: '12px 10px', fontWeight: 600 }}>平均分</th>
              <th style={{ padding: '12px 10px', fontWeight: 600 }}>认证</th>
              <th style={{ padding: '12px 10px', fontWeight: 600 }} />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <Fragment key={m.userId}>
                <tr style={{ borderTop: '1px solid #EBEBEF' }}>
                  <td style={{ padding: '14px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="avatar av4" style={{ width: 32, height: 32, fontSize: 13, flex: 'none' }}>{m.name[0] ?? '—'}</div>
                      <b style={{ fontSize: 14 }}>{m.name}</b>
                    </div>
                  </td>
                  <td style={{ padding: '14px 10px', fontSize: 13.5, color: '#6B7280' }}>{m.teamName ?? '未分组'}</td>
                  <td style={{ padding: '14px 10px', fontSize: 14 }}>{m.examCount}</td>
                  <td style={{ padding: '14px 10px', fontSize: 14 }}>{m.passCount}</td>
                  <td style={{ padding: '14px 10px', fontWeight: 700, color: scoreColor(m.bestScore) }}>{m.bestScore ?? '—'}</td>
                  <td style={{ padding: '14px 10px', fontWeight: 700, color: scoreColor(m.latestScore) }}>{m.latestScore ?? '—'}</td>
                  <td style={{ padding: '14px 10px', fontSize: 14 }}>{m.avgScore ?? '—'}</td>
                  <td style={{ padding: '14px 10px' }}>
                    {m.certified ? <span className="chip chip-green">已认证</span> : <span className="chip chip-gray">未认证</span>}
                  </td>
                  <td style={{ padding: '14px 10px' }}>
                    {m.certs.length > 0 && (
                      <button className="btn ghost sm" onClick={() => setExpanded(expanded === m.userId ? null : m.userId)}>
                        {expanded === m.userId ? '收起' : `证书 ${m.certs.length}`}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === m.userId && (
                  <tr style={{ background: '#F7F7FA' }}>
                    <td colSpan={9} style={{ padding: '4px 18px 16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {m.certs.map((c) => (
                          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
                            <span>{c.passed ? '🏅' : '📄'}</span>
                            <b>{c.examWindowName ?? '考核'}</b>
                            {c.level && <span className="chip chip-blue">{c.level}</span>}
                            <span className="small muted">{fmtDate(c.issuedAt)}</span>
                            <b style={{ color: scoreColor(c.totalScore), marginLeft: 'auto' }}>{c.totalScore} 分</b>
                            <span className={c.passed ? 'chip chip-green' : 'chip chip-gray'}>{c.passed ? '通过' : '未通过'}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {members.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center' }} className="small muted">暂无成员数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
