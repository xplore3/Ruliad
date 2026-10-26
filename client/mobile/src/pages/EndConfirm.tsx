﻿import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import StatusBar from '../components/StatusBar';
import type { CreateSessionResponse } from '../types';

/** 统一色板 */
const C = {
  bg: '#17191F',
  panel: '#22252D',
  panel2: '#2A2D36',
  text: '#F7F7FA',
  sub: '#A4A7B3',
  accent: '#E85C62',
  success: '#5DC7A3',
};

export default function EndConfirm() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    api.get<CreateSessionResponse>(`/sessions/${sessionId}`).then((res) => setSession(res.data)).catch(() => {});
  }, [sessionId]);

  const confirmEnd = async () => {
    if (ending || !sessionId) return;
    setEnding(true);
    const startedAt = Date.now();
    console.log(`[EndConfirm] POST /sessions/${sessionId}/end 开始（后端逐项 LLM 评分，可能较慢）`);
    try {
      const res = await api.post<{ skippedReport?: boolean }>(`/sessions/${sessionId}/end`);
      console.log(
        `[EndConfirm] POST /end 成功 耗时=${Date.now() - startedAt}ms skippedReport=${!!res.data.skippedReport}`
      );
      if (res.data.skippedReport) {
        navigate('/practice', { replace: true });
        return;
      }
      navigate(`/session/${sessionId}/report`);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      console.error(
        `[EndConfirm] POST /end 失败 耗时=${Date.now() - startedAt}ms status=${e.response?.status}`,
        e.response?.data ?? e.message ?? err
      );
      window.alert('结束失败，请重试');
      setEnding(false);
    }
  };

  const turns = session?.session.transcript ?? [];
  const confirmedTurns = turns.filter((t) => t.speaker === 'trainee' || t.speaker === 'persona').length;
  const startedAt = session?.session.startedAt ? new Date(session.session.startedAt) : null;
  const durationMin = startedAt ? Math.max(1, Math.floor((Date.now() - startedAt.getTime()) / 60000)) : 0;
  const durationSec = startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) % 60 : 0;

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col px-6 pt-4">
        <h1 className="text-xl font-bold" style={{ color: C.text }}>本次练习</h1>

        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ backgroundColor: C.panel }}>
            <span className="text-sm" style={{ color: C.sub }}>陪练员</span>
            <span className="text-sm font-medium" style={{ color: C.text }}>{session?.persona?.name ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ backgroundColor: C.panel }}>
            <span className="text-sm" style={{ color: C.sub }}>模式</span>
            <span className="text-sm font-medium" style={{ color: C.text }}>
              {location.pathname.includes('/voice/') ? '语音对话' : location.pathname.includes('/call/') ? '语音通话' : '文字对话'}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ backgroundColor: C.panel }}>
            <span className="text-sm" style={{ color: C.sub }}>练习时长</span>
            <span className="text-sm font-medium" style={{ color: C.text }}>{String(durationMin).padStart(2, '0')}:{String(durationSec).padStart(2, '0')}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ backgroundColor: C.panel }}>
            <span className="text-sm" style={{ color: C.sub }}>已确认轮次</span>
            <span className="text-sm font-medium" style={{ color: C.text }}>{confirmedTurns} 轮</span>
          </div>
        </div>

        <div className="mt-8 rounded-xl p-4" style={{ backgroundColor: C.panel }}>
          <p className="text-sm font-bold" style={{ color: C.text }}>结束并分析？</p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: C.sub }}>
            已确认的对话会保留。分析将给出证据、解释和下次训练建议。
          </p>
        </div>
      </div>

      <div className="space-y-3 p-6">
        <button
          className="mx-auto block min-h-13 w-full max-w-[260px] rounded-2xl text-base font-bold transition active:scale-[0.98] disabled:opacity-50"
          style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
          onClick={confirmEnd}
          disabled={ending}
        >
          {ending ? '正在结束…' : '结束并生成报告'}
        </button>
        <button
          className="mx-auto block min-h-13 w-full max-w-[260px] rounded-2xl text-base font-medium transition active:scale-[0.98]"
          style={{ border: `1px solid ${C.panel2}`, color: C.text, backgroundColor: C.panel }}
          onClick={() => navigate(-1)}
        >
          返回继续对练
        </button>
      </div>
    </div>
  );
}
