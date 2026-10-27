import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiError, createSession, fetchReview } from '../api';
import type { ReviewData, ScoreItem } from '../types';

function barClass(score: number) {
  if (score >= 80) return 'g';
  if (score >= 60) return 'a';
  return 'c';
}

function scoreColor(score: number) {
  return score >= 80 ? '#2FAE7B' : score >= 60 ? '#F5A623' : '#FF6B5B';
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const SPEAKER_LABEL: Record<string, string> = { trainee: '我', persona: '客户', coach: '教练' };

export default function Review() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    fetchReview(sessionId)
      .then(setData)
      .catch((e) => setError(apiError(e, '报告加载失败')))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const ringCircumference = 2 * Math.PI * 54;

  const handleRetrain = async () => {
    if (!data?.scenario || creating) return;
    setCreating(true);
    try {
      const res = await createSession(data.scenario.id, 'practice');
      navigate(`/practice/${res.session.id}?mode=text`);
    } catch (e) {
      alert(apiError(e, '创建练习失败，请稍后重试'));
    } finally {
      setCreating(false);
    }
  };

  const radarDims = useMemo(() => (data?.report?.items ?? []).slice(0, 6), [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="md:!pb-0">
        <div className="mtopbar">
          <span className="back cursor-pointer" onClick={() => navigate(-1)}>←</span>
          练习报告
          <span className="right" />
        </div>
        <main className="page-review">
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <p style={{ marginBottom: '16px' }}>{error ?? '报告不存在'}</p>
            <button className="btn btn-primary" onClick={() => navigate('/home')}>返回首页</button>
          </div>
        </main>
      </div>
    );
  }

  const { session, report, scenario, persona, prevScore } = data;

  // 内容不足 / 未生成报告
  if (data.skipped || !report) {
    return (
      <div className="md:!pb-0">
        <div className="mtopbar">
          <span className="back cursor-pointer" onClick={() => navigate(-1)}>←</span>
          练习报告
          <span className="right" />
        </div>
        <main className="page-review">
          <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📭</div>
            <h3 style={{ marginBottom: '8px' }}>本次练习内容不足，未生成报告</h3>
            <p className="small muted" style={{ marginBottom: '20px' }}>
              多进行几轮对话后再结束练习，即可获得完整评分报告
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn btn-ghost" onClick={() => navigate('/home')}>返回首页</button>
              {scenario && (
                <button className="btn btn-primary" disabled={creating} onClick={handleRetrain}>
                  {creating ? '创建中…' : '再练一次'}
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const score = report.totalScore;
  const scoreDiff = prevScore != null ? score - prevScore : null;
  const fillerTotal = Object.values(report.ruleStats.fillerCounts ?? {}).reduce((a, b) => a + b, 0);
  const talkRatio = report.ruleStats.talkRatio ?? 0;
  const listenRatio = talkRatio > 0 ? Math.round((1 - talkRatio) * 100) : 0;
  const speechRate = Math.round(report.ruleStats.avgSpeechRate ?? 0);
  const pauseCount = report.ruleStats.pauseCount ?? 0;

  const metrics = [
    {
      label: '填充词',
      value: fillerTotal > 0 ? String(fillerTotal) : '—',
      unit: '次',
      feedback: fillerTotal > 0 ? (fillerTotal > 5 ? '偏多，注意控制 ⚠' : '控制良好 ✓') : '暂无数据',
      ok: fillerTotal > 0 ? fillerTotal <= 5 : true,
    },
    {
      label: '语速',
      value: speechRate > 0 ? String(speechRate) : '—',
      unit: 'WPM',
      feedback: speechRate > 0 ? (speechRate > 180 ? '偏快，注意停顿 ⚠' : speechRate < 110 ? '偏慢 ⚠' : '语速适中 ✓') : '暂无数据',
      ok: speechRate > 0 ? speechRate >= 110 && speechRate <= 180 : true,
    },
    {
      label: '倾听占比',
      value: listenRatio > 0 ? String(listenRatio) : '—',
      unit: '%',
      feedback: listenRatio > 0 ? (listenRatio >= 40 ? '倾听充分 ✓' : '多给对方表达空间 ⚠') : '暂无数据',
      ok: listenRatio > 0 ? listenRatio >= 40 : true,
    },
    {
      label: '停顿',
      value: pauseCount > 0 ? String(pauseCount) : '—',
      unit: '次',
      feedback: pauseCount > 0 ? (pauseCount > 8 ? '停顿偏多 ⚠' : '节奏自然 ✓') : '暂无数据',
      ok: pauseCount > 0 ? pauseCount <= 8 : true,
    },
  ];

  const durationMin = session.endedAt
    ? Math.max(1, Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60000))
    : null;
  const weakest = report.items.length > 0
    ? [...report.items].sort((a, b) => a.score - b.score)[0]
    : null;

  const metaParts = [
    persona?.name,
    scenario?.name,
    session.mode === 'exam' ? '📋 考核模式' : '🎯 练习模式',
    fmtDateTime(session.startedAt),
    durationMin != null ? `用时 ${durationMin} 分钟` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="md:!pb-0">
      {/* 手机顶部栏 */}
      <div className="mtopbar">
        <span className="back cursor-pointer" onClick={() => navigate(-1)}>←</span>
        练习报告
        <span className="right">报告已生成</span>
      </div>

      <main className="page-review">
        {/* ===== 总分头部 ===== */}
        <div className="card head-card">
          <div className="ring shrink-0">
            <svg width="130" height="130" viewBox="0 0 130 130">
              <defs>
                <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#FF6B5B" />
                  <stop offset="100%" stopColor="#F5A623" />
                </linearGradient>
              </defs>
              <circle cx="65" cy="65" r="54" fill="none" stroke="#EBEBEF" strokeWidth="10" />
              <circle cx="65" cy="65" r="54" fill="none" stroke="url(#scoreGrad)" strokeWidth="10"
                strokeLinecap="round" strokeDasharray={`${(score / 100) * ringCircumference} ${ringCircumference}`} />
            </svg>
            <div className="val"><b>{score}</b><span>本次得分</span></div>
          </div>
          <div className="grow">
            <div className="score-line">
              <span style={{ fontSize: '13px', color: '#6B7280' }}>本次练习</span>
              <b>{score} 分</b>
              {scoreDiff != null && (
                <span className="up" style={scoreDiff < 0 ? { color: '#FF6B5B' } : undefined}>
                  {scoreDiff >= 0 ? '↑' : '↓'} 比上次 {scoreDiff >= 0 ? '+' : ''}{scoreDiff}
                </span>
              )}
            </div>
            <p className="verdict">
              {report.passed ? '本次练习已通过' : '本次练习未通过'}
              {scenario ? `（及格线 ${scenario.passScore} 分）` : ''}。
            </p>
            <div className="small muted">{metaParts}</div>
          </div>
          {scenario && (
            <button className="btn btn-primary" disabled={creating} onClick={handleRetrain}>
              {creating ? '创建中…' : '再练一次'}
            </button>
          )}
        </div>

        {/* ===== 过程阶段拆解 ===== */}
        {report.items.length > 0 && (
          <>
            <div className="sec-t"><span>📈</span> 过程阶段拆解</div>
            <div className="card stage sec">
              {report.items.map((item) => (
                <StageRow
                  key={item.itemId}
                  item={item}
                  expanded={expandedId === item.itemId}
                  onToggle={() => setExpandedId(expandedId === item.itemId ? null : item.itemId)}
                />
              ))}
            </div>
          </>
        )}

        {/* ===== 状态维度 ===== */}
        <div className="sec-t"><span>🎙</span> 状态维度</div>
        <div className="metrics sec">
          {metrics.map((m) => (
            <div key={m.label} className="card metric">
              <div className="small muted">{m.label}</div>
              <div className="mv">
                {m.value}
                {m.value !== '—' && m.unit && <small>{m.unit}</small>}
              </div>
              <div className="small" style={{ color: m.value === '—' ? '#6B7280' : m.ok ? '#2FAE7B' : '#F5A623' }}>{m.feedback}</div>
            </div>
          ))}
        </div>

        {/* ===== 表现维度 ===== */}
        {radarDims.length > 0 && (
          <>
            <div className="sec-t"><span>🕸</span> 表现维度</div>
            <div className="card radar-wrap sec">
              {radarDims.length >= 3 && <ReviewRadar items={radarDims} />}
              <div className="dim-list">
                {report.items.map((d) => (
                  <div key={d.itemId} className="dim">
                    <b style={d.score < 60 ? { color: '#FF6B5B' } : undefined}>{d.score}</b>
                    <span>{d.itemName}</span>
                    <span className="act">{d.rationale ?? ''}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ===== 教练总结 ===== */}
        {report.summary && (
          <>
            <div className="sec-t"><span>🧑‍🏫</span> 教练总结</div>
            <div className="card sec" style={{ padding: '20px 24px' }}>
              <p style={{ fontSize: '14px', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{report.summary}</p>
            </div>
          </>
        )}

        {/* ===== 下一步 ===== */}
        <div className="sec-t"><span>🚀</span> 下一步</div>
        <div className="card" style={{ padding: '20px 24px' }}>
          {weakest && weakest.score < 60 && (
            <p style={{ fontSize: '14px', marginBottom: '4px' }}>
              薄弱维度 <b style={{ color: '#FF6B5B' }}>{weakest.itemName} {weakest.score} 分</b>
              {weakest.betterScript ? '，可参照上方建议话术针对性练习。' : '，建议针对性训练。'}
            </p>
          )}
          <div className="next-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setShowTranscript((v) => !v)}>
              {showTranscript ? '收起回放' : '查看完整回放'}
            </button>
            {scenario && (
              <button className="btn btn-ghost btn-sm" disabled={creating} onClick={handleRetrain}>
                {creating ? '创建中…' : '再练一次'}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => alert('分享功能暂未开放')}>分享报告</button>
          </div>
        </div>

        {/* ===== 完整回放 ===== */}
        {showTranscript && (
          <div className="card sec" style={{ padding: '20px 24px' }}>
            {session.transcript.length === 0 ? (
              <p className="small muted">暂无对话记录</p>
            ) : (
              session.transcript.map((t) => (
                <div key={t.seq} className={t.speaker === 'trainee' ? 'msg msg-me' : 'msg'}>
                  <div>
                    <div className="bubble">{t.text}</div>
                    <div className="meta">
                      {SPEAKER_LABEL[t.speaker] ?? t.speaker}
                      {t.isHint ? ' · 提示' : ''} · {fmtDateTime(t.at)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function StageRow({ item, expanded, onToggle }: { item: ScoreItem; expanded: boolean; onToggle: () => void }) {
  const hasEvidence = !!(item.quote || item.betterScript || item.rationale);
  return (
    <div className="stage-row">
      <b style={{ fontSize: '13.5px', fontWeight: 500 }}>{item.itemName}</b>
      <div className="bar"><i className={barClass(item.score)} style={{ width: `${item.score}%` }} /></div>
      <b style={{ color: scoreColor(item.score), fontSize: '13px', fontWeight: 700 }}>{item.score}</b>
      <div className="stage-note">
        {item.rationale ?? ''}
        {hasEvidence && (
          <a style={{ color: '#FF6B5B', fontWeight: 600, cursor: 'pointer' }} onClick={onToggle}>
            {expanded ? '收起证据 ↑' : '查看证据 ↗'}
          </a>
        )}
      </div>
      {expanded && (
        <div style={{ gridColumn: '1 / -1', fontSize: '13px', lineHeight: 1.7, background: '#F7F7FA', borderRadius: '10px', padding: '12px 14px' }}>
          {item.quote && (
            <p style={{ marginBottom: '8px' }}>
              <b className="small muted">话术证据</b>
              <br />「{item.quote}」
            </p>
          )}
          {item.rationale && (
            <p style={{ marginBottom: '8px' }}>
              <b className="small muted">评分解析</b>
              <br />{item.rationale}
            </p>
          )}
          {item.betterScript && (
            <p>
              <b className="small muted">建议话术</b>
              <br />{item.betterScript}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewRadar({ items }: { items: ScoreItem[] }) {
  const size = 220;
  const center = size / 2;
  const maxRadius = 80;
  const angleStep = (2 * Math.PI) / items.length;
  const pointAt = (i: number, ratio: number) => {
    const angle = angleStep * i - Math.PI / 2;
    const r = maxRadius * ratio;
    return `${(center + r * Math.cos(angle)).toFixed(1)},${(center + r * Math.sin(angle)).toFixed(1)}`;
  };

  return (
    <svg width="300" height="220" viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: '100%' }}>
      {[1, 0.66, 0.33].map((ratio) => (
        <polygon key={ratio} fill="none" stroke="#EBEBEF"
          points={items.map((_, i) => pointAt(i, ratio)).join(' ')} />
      ))}
      {items.map((_, i) => {
        const angle = angleStep * i - Math.PI / 2;
        return (
          <line key={i} x1={center} y1={center}
            x2={center + maxRadius * Math.cos(angle)}
            y2={center + maxRadius * Math.sin(angle)}
            stroke="#EBEBEF" />
        );
      })}
      <polygon
        fill="rgba(255,107,91,.25)" stroke="#FF6B5B" strokeWidth="2"
        points={items.map((s, i) => pointAt(i, Math.max(0.05, s.score / 100))).join(' ')} />
      {items.map((s, i) => {
        const angle = angleStep * i - Math.PI / 2;
        const labelR = maxRadius + 18;
        const weak = s.score < 60;
        return (
          <text key={i}
            x={center + labelR * Math.cos(angle)}
            y={center + labelR * Math.sin(angle)}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="11"
            fill={weak ? '#FF6B5B' : '#6B7280'}
            fontWeight={weak ? '700' : '400'}
          >
            {s.itemName} {s.score}
          </text>
        );
      })}
    </svg>
  );
}
