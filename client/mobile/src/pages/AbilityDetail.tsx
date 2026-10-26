import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import StatusBar from '../components/StatusBar';

/** 统一色板 */
const C = {
  bg: '#17191F',
  panel: '#22252D',
  panel2: '#2A2D36',
  text: '#F7F7FA',
  sub: '#A4A7B3',
  accent: '#E85C62',
  success: '#5DC7A3',
  border: 'rgba(255,255,255,0.06)',
};

interface EvidenceItem {
  round: number;
  time: string;
  quote: string;
  role: 'customer' | 'me';
  tag: string;
  tagColor: string;
}

interface GuidanceItem {
  label: string;
  content: string;
}

interface AbilityDetailResponse {
  key: string;
  name: string;
  score: number;
  evidenceList: EvidenceItem[];
  aiRationale: string;
  guidance: GuidanceItem[];
}

export default function AbilityDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const state = location.state as { key: string; name: string; score: number } | null;

  // dimKey 优先从 URL param（scenarioId 路径段）取，fallback 到 state
  const dimKey = state?.key ?? scenarioId ?? 'need';
  const [data, setData] = useState<AbilityDetailResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    api
      .get<AbilityDetailResponse>(`/ability-detail/${dimKey}`)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => { cancelled = true; };
  }, [dimKey]);

  const name = data?.name ?? state?.name ?? '需求挖掘';
  const score = data?.score ?? state?.score ?? 0;
  const scoreColor = score >= 80 ? C.success : C.accent;

  // 加载中
  if (!data && !error) {
    return (
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
        <StatusBar dark />
        <div className="flex items-center px-4 py-2">
          <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
            <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
        </div>
        <p className="py-20 text-center text-sm" style={{ color: C.sub }}>加载中…</p>
      </div>
    );
  }

  // 错误
  if (error && !data) {
    return (
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
        <StatusBar dark />
        <div className="flex items-center px-4 py-2">
          <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
            <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
        </div>
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <p className="text-sm" style={{ color: C.sub }}>加载失败</p>
          <button className="rounded-lg px-5 py-2 text-sm font-medium" style={{ backgroundColor: C.accent, color: '#F7F7FA' }} onClick={() => { setError(false); window.location.reload(); }}>重新加载</button>
        </div>
      </div>
    );
  }

  const evidenceList = data?.evidenceList ?? [];
  const aiRationale = data?.aiRationale ?? '';
  const guidance = data?.guidance ?? [];

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="px-5 pt-2">
        <p className="text-xs" style={{ color: C.sub }}>专项能力评分证据 · 规则 v1</p>
        <h1 className="mt-1 text-xl font-bold" style={{ color: C.text }}>{name}</h1>
      </div>

      {/* 得分卡 */}
      <div className="mx-5 mt-4 rounded-2xl p-5" style={{ backgroundColor: 'rgba(232,92,98,0.08)' }}>
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium" style={{ color: scoreColor }}>{name}</span>
          <span className="text-4xl font-bold" style={{ color: scoreColor }}>{score}</span>
          <span className="text-sm" style={{ color: C.sub }}>/ 100</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: scoreColor }} />
        </div>
      </div>

      {/* 评分证据 - 对话片段 */}
      <div className="mx-5 mt-5">
        <p className="text-sm font-bold" style={{ color: C.text }}>评分证据 · 对话片段</p>
        <p className="mt-1 text-xs" style={{ color: C.sub }}>以下对话片段直接影响了该项评分</p>
        {evidenceList.length > 0 ? (
          <div className="mt-3 space-y-3">
            {evidenceList.map((ev, idx) => {
              const isMe = ev.role === 'me';
              return (
                <div
                  key={idx}
                  className="rounded-2xl px-4 py-3"
                  style={{
                    backgroundColor: isMe ? 'rgba(232,92,98,0.08)' : C.panel,
                    border: isMe ? '1px solid rgba(232,92,98,0.15)' : `1px solid ${C.border}`,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: C.sub }}>第 {ev.round} 轮 / {ev.time}</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: isMe ? 'rgba(232,92,98,0.12)' : 'rgba(255,255,255,0.06)', color: ev.tagColor }}
                    >
                      {ev.tag}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-medium" style={{ color: isMe ? C.accent : C.sub }}>
                    {isMe ? '我' : '客户'}：
                  </p>
                  <p className="mt-1 text-[14px] leading-relaxed" style={{ color: C.text }}>
                    「{ev.quote}」
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-center text-sm" style={{ color: C.sub }}>暂无评分证据数据</p>
        )}
      </div>

      {/* AI 评分解释 */}
      {aiRationale && (
        <div className="mx-5 mt-5 rounded-2xl p-5" style={{ backgroundColor: C.panel }}>
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4" style={{ color: C.accent }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <p className="text-sm font-bold" style={{ color: C.text }}>AI 评分解释</p>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: C.sub }}>{aiRationale}</p>
        </div>
      )}

      {/* 改进指导 */}
      <div className="mx-5 mt-4">
        <p className="text-sm font-bold" style={{ color: C.text }}>改进指导</p>
        {guidance.length > 0 ? (
          <div className="mt-3 space-y-3">
            {guidance.map((g, idx) => (
              <div key={idx} className="rounded-2xl p-4" style={{ backgroundColor: C.panel }}>
                <p className="text-xs font-bold" style={{ color: g.label === '做得好的' ? C.success : g.label === '可提升的' ? C.accent : C.sub }}>
                  {g.label === '做得好的' ? '✦ ' : g.label === '可提升的' ? '↗ ' : 'ℹ '}{g.label}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed" style={{ color: C.sub }}>{g.content}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-center text-sm" style={{ color: C.sub }}>暂无改进指导数据</p>
        )}
      </div>

      {/* 底部行動按钮 */}
      <div className="flex-1" />
      <div className="p-5">
        <button
          className="mx-auto block min-h-14 w-full max-w-[280px] rounded-2xl text-base font-bold transition active:scale-[0.98]"
          style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
          onClick={() => navigate('/practice')}
        >
          和 AI 继续复盘
        </button>
      </div>
      <div className="h-4" />
    </div>
  );
}
