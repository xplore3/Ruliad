import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiError, fetchManagementTeamAbility } from '../../api';
import type { ManagementTeamAbility } from '../../types';

function scoreColor(score: number | null) {
  if (score == null) return '#9CA3AF';
  return score >= 80 ? '#2FAE7B' : score >= 60 ? '#F5A623' : '#FF6B5B';
}

function scoreBg(score: number | null) {
  if (score == null) return '#F1F2F4';
  return score >= 80 ? '#E7F6F0' : score >= 60 ? '#FDF3E1' : '#FFF0EE';
}

export default function ManagementTeamAbility() {
  const navigate = useNavigate();
  const [data, setData] = useState<ManagementTeamAbility | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchManagementTeamAbility()
      .then(setData)
      .catch((e) => setError(apiError(e, '团队能力加载失败')))
      .finally(() => setLoading(false));
  }, []);

  /** 热力图：行=技能点，列=团队 */
  const { teams, skillRows } = useMemo(() => {
    if (!data) return { teams: [] as string[], skillRows: [] as { skillPointId: string; name: string; cells: Map<string, { avgScore: number; passRate: number; sampleSize: number }> }[] };
    const teamNameSet = new Set<string>();
    for (const cell of data.heatmap) teamNameSet.add(cell.teamName ?? '未分组');
    const teams = [...teamNameSet];
    const rows = data.skillPoints.map((sp) => {
      const cells = new Map<string, { avgScore: number; passRate: number; sampleSize: number }>();
      for (const cell of data.heatmap) {
        if (cell.skillPointId === sp.id) {
          cells.set(cell.teamName ?? '未分组', {
            avgScore: cell.avgScore,
            passRate: cell.passRate,
            sampleSize: cell.sampleSize,
          });
        }
      }
      return { skillPointId: sp.id, name: sp.name, cells };
    });
    return { teams, skillRows: rows };
  }, [data]);

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

  return (
    <div>
      {/* 团队薄弱技能 */}
      <div className="card" style={{ padding: '18px 22px', marginBottom: 18 }}>
        <b style={{ fontSize: 15.5 }}>🧊 团队薄弱技能</b>
        {data.weakSkills.length === 0 ? (
          <p className="small muted" style={{ marginTop: 10 }}>暂无薄弱技能数据，完成考核后自动生成</p>
        ) : (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            {data.weakSkills.map((w) => (
              <div key={w.skillPointId} style={{ flex: '1 1 200px', background: '#FFF7F6', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b style={{ fontSize: 14 }}>{w.skillPointName}</b>
                  <b style={{ fontSize: 15, color: '#FF6B5B' }}>{w.avgScore} 分</b>
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>{w.memberCount} 名成员样本</div>
                <div style={{ height: 4, background: '#FFE0DB', borderRadius: 2, marginTop: 8 }}>
                  <div style={{ height: '100%', width: `${Math.min(100, w.avgScore)}%`, background: '#FF6B5B', borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 团队 × 技能热力图 */}
      <div className="card" style={{ padding: '18px 22px', marginBottom: 18, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <b style={{ fontSize: 15.5 }}>🔥 团队能力热力图</b>
          <span className="small muted">基于基线考核 · 得分均值</span>
        </div>
        {skillRows.length === 0 || teams.length === 0 ? (
          <p className="small muted">暂无考核数据，认证考核后自动生成</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 4, minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 12.5, color: '#6B7280', fontWeight: 600, padding: '4px 8px' }}>技能点</th>
                {teams.map((t) => (
                  <th key={t} style={{ fontSize: 12.5, color: '#6B7280', fontWeight: 600, padding: '4px 8px', whiteSpace: 'nowrap' }}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skillRows.map((row) => (
                <tr key={row.skillPointId}>
                  <td style={{ fontSize: 13.5, fontWeight: 600, padding: '4px 8px', whiteSpace: 'nowrap' }}>{row.name}</td>
                  {teams.map((team) => {
                    const cell = row.cells.get(team);
                    return (
                      <td key={team} style={{ padding: 4 }}>
                        <div
                          style={{
                            background: scoreBg(cell?.avgScore ?? null),
                            color: scoreColor(cell?.avgScore ?? null),
                            borderRadius: 8,
                            padding: '10px 12px',
                            fontSize: 13.5,
                            fontWeight: 700,
                            textAlign: 'center',
                            minWidth: 68,
                          }}
                          title={cell ? `通过率 ${Math.round(cell.passRate * 100)}% · 样本 ${cell.sampleSize}` : '暂无数据'}
                        >
                          {cell ? cell.avgScore : '—'}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 需关注 */}
      {data.attention.length > 0 && (
        <div className="card" style={{ padding: '18px 22px', marginBottom: 18 }}>
          <b style={{ fontSize: 15.5 }}>⚠️ 需关注成员</b>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {data.attention.map((a) => (
              <div key={a.userId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="avatar av4" style={{ width: 30, height: 30, fontSize: 12, flex: 'none' }}>{a.userName[0] ?? '—'}</div>
                <b style={{ fontSize: 14 }}>{a.userName}</b>
                <span className="chip chip-coral">{a.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 成员能力明细 */}
      <div className="card" style={{ padding: '8px 18px' }}>
        <div style={{ padding: '12px 8px' }}>
          <b style={{ fontSize: 15.5 }}>👥 成员能力明细</b>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {data.members.map((m) => (
            <div
              key={m.userId}
              role="button"
              tabIndex={0}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 8px',
                borderTop: '1px solid #EBEBEF', cursor: 'pointer',
              }}
              onClick={() => navigate(`/management/member/${m.userId}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/management/member/${m.userId}`); }}
            >
              <div className="avatar av4" style={{ width: 38, height: 38, fontSize: 14, flex: 'none' }}>{m.name[0] ?? '—'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 14.5 }}>{m.name}</b>
                  <span className="chip chip-gray">{m.teamName ?? '未分组'}</span>
                  {m.attention && (
                    <span className="chip chip-coral">
                      {m.attention === 'consecutive_fail' ? '连续未达标' : '7 天未练习'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {m.skillDetails.slice(0, 5).map((s) => (
                    <span key={s.skillPointId} className="chip chip-gray" style={{ fontSize: 11.5 }}>
                      {s.name} {s.latestScore != null ? s.latestScore : '—'}
                    </span>
                  ))}
                  {m.skillDetails.length > 5 && (
                    <span className="small muted">+{m.skillDetails.length - 5}</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: scoreColor(m.latestTotalScore) }}>
                  {m.latestTotalScore ?? '—'}
                </div>
                <div className="small muted">平均 Lv.{m.avgLevel ?? 0}</div>
              </div>
            </div>
          ))}
          {data.members.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center' }} className="small muted">暂无成员</div>
          )}
        </div>
      </div>
    </div>
  );
}
