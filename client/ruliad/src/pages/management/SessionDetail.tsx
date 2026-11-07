import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiError, fetchManagementSessionDetail, recordingAudioUrl } from '../../api';
import type { ManagementSessionDetail } from '../../types';

function fmtDate(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDuration(sec: number | null) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

function fmtSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function scoreColor(score: number | null) {
  if (score == null) return '#9CA3AF';
  return score >= 80 ? '#2FAE7B' : score >= 60 ? '#F5A623' : '#FF6B5B';
}

function fmtPct(v: number | undefined) {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

/** 成员单次练习详情（团队能力管理）：评分报告 + 逐轮录音回放 */
export default function ManagementSessionDetail() {
  const navigate = useNavigate();
  const { userId, sessionId } = useParams<{ userId: string; sessionId: string }>();
  const [data, setData] = useState<ManagementSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !sessionId) return;
    fetchManagementSessionDetail(userId, sessionId)
      .then(setData)
      .catch((e) => setError(apiError(e, '练习详情加载失败')))
      .finally(() => setLoading(false));
  }, [userId, sessionId]);

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
        <p className="small muted" style={{ marginBottom: 12 }}>{error ?? '会话不存在或不在你的管理范围内'}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/management/member/${userId}`)}>返回成员档案</button>
      </div>
    );
  }

  const { session, report, prevScore, recordings } = data;
  const skillScores = report?.skillScores ?? [];
  const items = report?.items ?? [];
  const violations = report?.violations ?? [];
  const stats = report?.ruleStats;
  const confidence = report?.confidenceIndex != null ? Math.round(report.confidenceIndex * 100) / 100 : null;

  return (
    <div>
      {/* 页头 */}
      <div className="card" style={{ padding: '16px 22px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <b style={{ fontSize: 15.5 }}>{session.scenarioName}</b>
            <div className="small muted">
              {fmtDate(session.at)} · {session.mode === 'exam' ? '考核' : '练习'} · 时长 {fmtDuration(session.durationSec)}
            </div>
          </div>
          <span className={`chip ${session.mode === 'exam' ? 'chip-coral' : 'chip-blue'}`}>
            {session.mode === 'exam' ? '考核' : '练习'}
          </span>
          {prevScore != null && report && (
            <span className="chip chip-gray">
              前次 {prevScore} 分{report.totalScore > prevScore ? ` ↑${report.totalScore - prevScore}` : report.totalScore < prevScore ? ` ↓${prevScore - report.totalScore}` : ' 持平'}
            </span>
          )}
          <button className="btn ghost sm" onClick={() => navigate(`/management/member/${userId}`)}>返回成员档案</button>
        </div>
      </div>

      {/* 评分总览 */}
      {report ? (
        <>
          <div className="stats" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <div className="card stat">
              <div className="lb">总分</div>
              <div className="vl" style={{ color: scoreColor(report.totalScore) }}>
                {report.totalScore} <small>分</small>
              </div>
              <div className="sub muted">
                {report.passed ? '达标' : '未达标'}
                {report.baseScore != null && report.baseScore !== report.totalScore && ` · 基础 ${report.baseScore}`}
              </div>
            </div>
            <div className="card stat">
              <div className="lb">信心指数</div>
              <div className="vl">{confidence ?? '—'}</div>
              <div className="sub muted">总分 = 基础分 × 信心指数</div>
            </div>
            <div className="card stat">
              <div className="lb">技能维度</div>
              <div className="vl">{skillScores.length} <small>项</small></div>
              <div className="sub muted">评分标准维度明细</div>
            </div>
            <div className="card stat">
              <div className="lb">规则违规</div>
              <div className="vl" style={{ color: violations.length > 0 ? '#FF6B5B' : '#2FAE7B' }}>
                {violations.length} <small>项</small>
              </div>
              <div className="sub muted">{report.fatalViolation ? '⚠️ 触发一票否决' : '无红线违规'}</div>
            </div>
          </div>

          {/* 教练总结 */}
          {report.summary && (
            <div className="card" style={{ padding: '16px 22px', marginBottom: 18 }}>
              <b style={{ fontSize: 15.5 }}>📝 教练总结</b>
              <p className="small" style={{ marginTop: 10, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{report.summary}</p>
            </div>
          )}

          {/* 改进目标 */}
          {report.improvementGoal && (
            <div className="card" style={{ padding: '14px 22px', marginBottom: 18, borderLeft: '3px solid #FF6B5B' }}>
              <b style={{ fontSize: 14.5 }}>🎯 优先改进：{report.improvementGoal.title}</b>
              <div className="small" style={{ marginTop: 8, lineHeight: 1.7 }}>
                <div>{report.improvementGoal.rationale}</div>
                {report.improvementGoal.suggestion && <div style={{ marginTop: 6 }}>建议：{report.improvementGoal.suggestion}</div>}
              </div>
            </div>
          )}

          {/* 技能维度得分 */}
          <div className="card" style={{ padding: '18px 22px', marginBottom: 18 }}>
            <b style={{ fontSize: 15.5 }}>📊 技能维度</b>
            {skillScores.length === 0 ? (
              <p className="small muted" style={{ marginTop: 10 }}>暂无技能维度得分</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                {skillScores.map((s) => {
                  const max = s.maxScore ?? 100;
                  const pct = Math.max(0, Math.min(100, (s.score / max) * 100));
                  return (
                    <div key={s.skillPointId}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <b style={{ fontSize: 14, flex: 1 }}>{s.skillPointName ?? s.skillPointId}</b>
                        <b style={{ fontSize: 15, color: scoreColor(s.score) }}>{s.score}<span className="small muted"> / {max}</span></b>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: '#F1F2F4', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: scoreColor(s.score) }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 评分项明细 */}
          <div className="card" style={{ padding: '18px 22px', marginBottom: 18 }}>
            <b style={{ fontSize: 15.5 }}>🧩 评分项明细</b>
            {items.length === 0 ? (
              <p className="small muted" style={{ marginTop: 10 }}>暂无明细</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                {items.map((it, i) => (
                  <div key={`${it.itemId}-${i}`} style={{ borderBottom: '1px solid #F1F2F4', paddingBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 14 }}>{it.itemName}</b>
                      {it.levelLabel && <span className="chip chip-blue">{it.levelLabel}</span>}
                      {it.isObservation && <span className="chip chip-gray">观察项</span>}
                      <div style={{ flex: 1 }} />
                      <b style={{ fontSize: 15, color: scoreColor(it.score) }}>{it.score} 分</b>
                    </div>
                    {it.rationale && (
                      <div className="small" style={{ marginTop: 6, lineHeight: 1.7, color: '#4B5563' }}>{it.rationale}</div>
                    )}
                    {it.quote && (
                      <blockquote className="small muted" style={{ margin: '8px 0 0', padding: '6px 12px', borderLeft: '2px solid #EBEBEF', fontStyle: 'italic' }}>
                        “{it.quote}”{it.quoteTurnSeq != null && <span>（第 {it.quoteTurnSeq} 轮）</span>}
                      </blockquote>
                    )}
                    {it.betterScript && (
                      <div className="small" style={{ marginTop: 6, padding: '6px 12px', background: '#E7F6F0', borderRadius: 8, color: '#1F7A5C' }}>
                        💡 话术示范：{it.betterScript}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 规则层统计 */}
          {stats && (
            <div className="card" style={{ padding: '18px 22px', marginBottom: 18 }}>
              <b style={{ fontSize: 15.5 }}>📏 规则层统计</b>
              <div className="stats" style={{ marginTop: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                <div className="stat"><div className="lb">打断次数</div><div className="vl sm">{stats.interruptions ?? 0}</div></div>
                <div className="stat"><div className="lb">学员占比</div><div className="vl sm">{fmtPct(stats.talkRatio)}</div></div>
                <div className="stat"><div className="lb">估算语速</div><div className="vl sm">{stats.avgSpeechRate != null ? `${Math.round(stats.avgSpeechRate)} 字/分` : '—'}</div></div>
                <div className="stat"><div className="lb">明显停顿</div><div className="vl sm">{stats.pauseCount ?? 0} 次</div></div>
              </div>
              {stats.fillerCounts && Object.keys(stats.fillerCounts).length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <span className="small muted">口头禅：</span>
                  {Object.entries(stats.fillerCounts).map(([word, count]) => (
                    <span key={word} className="chip chip-amber">{word} × {count}</span>
                  ))}
                </div>
              )}
              {stats.coverageMisses && stats.coverageMisses.length > 0 && (
                <div className="small" style={{ marginTop: 10 }}>
                  <span className="muted">未覆盖要点：</span>
                  {stats.coverageMisses.map((m) => (
                    <span key={m} className="chip chip-coral" style={{ marginRight: 6 }}>{m}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 违规 */}
          {violations.length > 0 && (
            <div className="card" style={{ padding: '18px 22px', marginBottom: 18 }}>
              <b style={{ fontSize: 15.5 }}>🚨 违规记录</b>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {violations.map((v, i) => (
                  <div key={`${v.ruleId}-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span className={`chip ${v.fatal ? 'chip-coral' : 'chip-amber'} ${v.kind}`}>{v.fatal ? '一票否决' : v.kind === 'redline' ? '红线' : v.kind === 'interruption' ? '打断' : v.kind === 'filler' ? '口头禅' : '覆盖'}</span>
                    <div className="small" style={{ flex: 1, lineHeight: 1.6 }}>{v.detail}{v.turnSeq != null && <span className="muted">（第 {v.turnSeq} 轮）</span>}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card" style={{ padding: '28px 24px', textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>📊</div>
          <p className="small muted">该场会话无评分报告（纯文字对练或评分尚未生成）</p>
        </div>
      )}

      {/* 录音回放 */}
      <div className="card" style={{ padding: '18px 22px' }}>
        <b style={{ fontSize: 15.5 }}>🎙️ 练习录音（{recordings.length} 轮）</b>
        {recordings.length === 0 ? (
          <p className="small muted" style={{ marginTop: 10 }}>该场会话没有留存录音（学员使用文字对练或无语音上行）</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {recordings.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span className="chip chip-blue" style={{ minWidth: 64, justifyContent: 'center' }}>第 {r.turnSeq} 轮</span>
                <span className="small muted">
                  {fmtDate(r.createdAt)} · 时长 {fmtDuration(r.durationSec)} · {fmtSize(r.fileSize)}
                </span>
                <audio controls preload="none" src={recordingAudioUrl(r.id)} style={{ height: 36, maxWidth: 320 }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
