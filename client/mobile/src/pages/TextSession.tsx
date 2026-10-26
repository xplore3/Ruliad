﻿﻿﻿import { useEffect, useReducer, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { trackAction, usePageTrack } from '../track';
import { speakServerPersona, stopSpeaking, ttsSupported } from '../tts';
import { Avatar } from '../components/Avatar';
import type { CreateSessionResponse, HintResponse, Persona, TranscriptTurn, TurnResponse } from '../types';

interface SessionState {
  turns: TranscriptTurn[];
  remainingSeconds: number;
  hintsRemaining: number;
  sending: boolean;
}

type SessionAction =
  | { type: 'tick' }
  | { type: 'load'; turns: TranscriptTurn[]; remainingSeconds: number; hintsRemaining: number }
  | { type: 'sendStart' }
  | { type: 'sendDone'; traineeTurn: TranscriptTurn; personaTurn: TranscriptTurn; remainingSeconds: number }
  | { type: 'sendError' }
  | { type: 'hint'; hintTurn: TranscriptTurn; hintsRemaining: number };

function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'tick':
      return state.remainingSeconds > 0
        ? { ...state, remainingSeconds: state.remainingSeconds - 1 }
        : state;
    case 'load':
      return { ...state, turns: action.turns, remainingSeconds: action.remainingSeconds, hintsRemaining: action.hintsRemaining };
    case 'sendStart':
      return { ...state, sending: true };
    case 'sendDone':
      return { ...state, sending: false, turns: [...state.turns, action.traineeTurn, action.personaTurn], remainingSeconds: action.remainingSeconds };
    case 'sendError':
      return { ...state, sending: false };
    case 'hint':
      return { ...state, turns: [...state.turns, action.hintTurn], hintsRemaining: action.hintsRemaining };
  }
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function TextSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams<{ sessionId: string }>();
  const initData = location.state as CreateSessionResponse | null;
  const [session, setSession] = useState(initData?.session ?? null);
  const [persona, setPersona] = useState<Persona | null>(initData?.persona ?? null);
  const [loadError, setLoadError] = useState(false);

  const [state, dispatch] = useReducer(reducer, {
    turns: initData?.session.transcript ?? [],
    remainingSeconds: initData?.remainingSeconds ?? 372,
    hintsRemaining: initData ? 3 - initData.session.hintsUsed : 3,
    sending: false,
  });
  const [input, setInput] = useState('');
  const [ending] = useState(false);
  const [voiceOn, setVoiceOn] = useState(ttsSupported());
  const bottomRef = useRef<HTMLDivElement>(null);
  const voiceOnRef = useRef(voiceOn);

  usePageTrack('/session/text/:id');

  useEffect(() => { voiceOnRef.current = voiceOn; if (!voiceOn) stopSpeaking(); }, [voiceOn]);
  useEffect(() => () => { stopSpeaking(); }, []);

  useEffect(() => {
    if (initData && voiceOn) {
      const opening = [...(initData.session.transcript ?? [])].reverse().find((t) => t.speaker === 'persona');
      if (opening) void speakServerPersona(initData.session.id, opening.text, opening.emotion?.arousal);
    }
  }, []);

  useEffect(() => {
    if (initData || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<CreateSessionResponse>(`/sessions/${sessionId}`);
        if (cancelled) return;
        if (res.data.session.status !== 'active') {
          navigate(`/session/${sessionId}/review`);
          return;
        }
        setSession(res.data.session);
        setPersona(res.data.persona ?? null);
        dispatch({ type: 'load', turns: res.data.session.transcript, remainingSeconds: res.data.remainingSeconds, hintsRemaining: 3 - res.data.session.hintsUsed });
      } catch { if (!cancelled) setLoadError(true); }
    })();
    return () => { cancelled = true; };
  }, [initData, sessionId, navigate]);

  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.turns.length, state.sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || state.sending || ending || !session) return;
    setInput('');
    dispatch({ type: 'sendStart' });
    try {
      const res = await api.post<TurnResponse>(`/sessions/${session.id}/turns`, { text });
      dispatch({ type: 'sendDone', traineeTurn: res.data.traineeTurn, personaTurn: res.data.personaTurn, remainingSeconds: res.data.remainingSeconds });
      if (voiceOn) void speakServerPersona(session.id, res.data.personaTurn.text, res.data.personaTurn.emotion?.arousal);
    } catch {
      dispatch({ type: 'sendError' });
      window.alert('发送失败，请重试');
    }
  };

  const requestHint = async () => {
    if (state.hintsRemaining <= 0 || state.sending || !session) return;
    trackAction('hint_click', { sessionId: session.id });
    try {
      const res = await api.post<HintResponse>(`/sessions/${session.id}/hint`);
      dispatch({ type: 'hint', hintTurn: res.data.hintTurn, hintsRemaining: res.data.hintsRemaining });
    } catch {
      window.alert('提示次数已用完');
    }
  };

  const endSession = () => {
    if (ending || !session) return;
    navigate(`/session/${session.id}/end`);
  };

  if (!session) {
    return (
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 bg-[#17191F] px-6">
        {loadError ? (
          <>
            <p className="text-sm">会话加载失败</p>
            <button className="rounded-xl px-6 py-2.5 text-sm font-bold" style={{ backgroundColor: '#E85C62', color: '#F7F7FA' }} onClick={() => navigate('/practice')}>
              返回对练列表
            </button>
          </>
        ) : <p className="text-sm">正在恢复对练…</p>}
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#17191F]">
      {/* 顶部 */}
      <div className="flex items-center justify-between px-4 pt-4">
        <button className="flex h-9 w-9 items-center justify-center" onClick={endSession} aria-label="结束">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium`} style={{ backgroundColor: state.remainingSeconds < 120 ? 'rgba(232,92,98,0.15)' : '#2A2D36', color: state.remainingSeconds < 120 ? '#E85C62' : '#F7F7FA' }}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          剩余 {formatTime(state.remainingSeconds)}
        </div>
        <div className="flex items-center gap-2">
          {ttsSupported() && (
            <button onClick={() => setVoiceOn(!voiceOn)} className={`flex h-9 w-9 items-center justify-center rounded-full ${voiceOn ? '' : 'text-slate-600'}`}>
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H3v6h3l5 4V5z" />
                {voiceOn ? <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M22 9l-6 6M16 9l6 6" />}
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 陪练员卡 */}
      <header className="px-5 pt-4">
        <div className="flex items-center gap-3">
          <Avatar name={persona?.name ?? '客户'} avatar={persona?.avatar} size="md" rounded="full" />
          <div>
            <p className="text-base font-bold leading-tight">{persona?.name ?? '客户'}</p>
            {persona?.occupation && <p className="mt-0.5 text-xs">{persona.occupation}</p>}
          </div>
        </div>
        <p className="mt-2 text-xs">今天 {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · 演示对话</p>
      </header>

      {/* 对话区 */}
      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-6 no-scrollbar">
        {state.turns.map((turn) => {
          if (turn.speaker === 'coach' || turn.isHint) {
            return (
              <div key={turn.seq} className="flex justify-center">
                <div className="max-w-[85%] rounded-2xl border border-orange-500/40 0/10 px-4 py-2 text-sm">
                  <span className="mb-1 block text-xs font-medium">教练提示</span>
                  {turn.text}
                </div>
              </div>
            );
          }
          const isTrainee = turn.speaker === 'trainee';
          return (
            <div key={turn.seq} className={`flex ${isTrainee ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed" style={{ backgroundColor: isTrainee ? '#E85C62' : '#22252D', color: isTrainee ? '#F7F7FA' : '#F7F7FA' }}>
                {turn.text}
              </div>
            </div>
          );
        })}
        {state.sending && <p className="pt-2 text-center text-xs">客户正在说话…</p>}
        <div ref={bottomRef} />
      </main>

      {/* 底部 */}
      <footer className="border-t border-white/5 px-5 pb-6 pt-4 safe-bottom">
        <div className="flex items-center justify-between">
          <button
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm ${state.hintsRemaining > 0 ? 'bg-[#2a3d4f] ' : 'bg-[#2a3d4f]/50 text-slate-600'}`}
            onClick={requestHint}
            disabled={state.hintsRemaining <= 0 || state.sending}
          >
            💡 提示（{state.hintsRemaining}/3）
          </button>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <textarea
            className="max-h-32 min-h-[44px] min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border border-[#33505f] bg-[#22394a] px-4 py-2.5 text-sm placeholder-slate-500 focus:border-orange-500 focus:outline-none leading-relaxed"
            placeholder="输入你的回应…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
          />
          <button
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-50"
            style={{ backgroundColor: '#E85C62', color: '#F7F7FA' }}
            onClick={send}
            disabled={state.sending || !input.trim()}
          >
            {state.sending ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#F7F7FA' }} />
            ) : (
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z" /></svg>
            )}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-slate-600">按 Enter 换行，Ctrl+Enter 发送</p>
        <button className="mt-3 mx-auto block w-full max-w-[260px] rounded-xl border border-[#33505f] py-3 text-sm font-medium transition active:scale-[0.99]" onClick={endSession}>
          结束 → 生成报告
        </button>
      </footer>
    </div>
  );
}
