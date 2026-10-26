﻿﻿﻿﻿﻿import { useEffect, useReducer, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api, { getToken } from '../api';
import { usePageTrack } from '../track';
import { speakServerPersona, stopSpeaking, ttsSupported } from '../tts';
import { VoiceRecorder, blobToPcm16 } from '../voice/recorder';
import { VoiceStreamClient, buildVoiceWsUrl } from '../voice/stream';
import { Avatar } from '../components/Avatar';
import type { CreateSessionResponse, Persona, TranscriptTurn, VoiceTurnResponse } from '../types';

type VoiceStatus = 'idle' | 'recording' | 'waiting' | 'playing';

interface SessionState {
  turns: TranscriptTurn[];
  remainingSeconds: number;
  hintsRemaining: number;
  sending: boolean;
}

type VoiceTurnInput = Omit<TranscriptTurn, 'seq' | 'at' | 'speaker' | 'text'> & {
  speaker: TranscriptTurn['speaker'];
  text: string;
  seq?: number;
  at?: string;
};

type SessionAction =
  | { type: 'tick' }
  | { type: 'load'; turns: TranscriptTurn[]; remainingSeconds: number; hintsRemaining: number }
  | { type: 'sendStart' }
  | { type: 'appendTurns'; turns: VoiceTurnInput[]; remainingSeconds?: number }
  | { type: 'sendError' };

function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'tick':
      return state.remainingSeconds > 0 ? { ...state, remainingSeconds: state.remainingSeconds - 1 } : state;
    case 'load':
      return { ...state, turns: action.turns, remainingSeconds: action.remainingSeconds, hintsRemaining: action.hintsRemaining };
    case 'sendStart':
      return { ...state, sending: true };
    case 'appendTurns': {
      let nextSeq = state.turns.reduce((m, t) => Math.max(m, t.seq), 0);
      const turns: TranscriptTurn[] = action.turns.filter((t) => t.text).map((t) => ({ ...t, seq: t.seq ?? ++nextSeq, at: t.at ?? new Date().toISOString() }));
      return { ...state, sending: false, turns: [...state.turns, ...turns], remainingSeconds: action.remainingSeconds ?? state.remainingSeconds };
    }
    case 'sendError':
      return { ...state, sending: false };
  }
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function VoiceSession() {
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
  const [ending] = useState(false);
  const [voiceOn] = useState(ttsSupported());
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [partialText, setPartialText] = useState('');
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [transcribedText, setTranscribedText] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const streamRef = useRef<VoiceStreamClient | null>(null);
  const streamConnectingRef = useRef<Promise<VoiceStreamClient> | null>(null);
  const wsDeadRef = useRef(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const httpAudioRef = useRef<HTMLAudioElement | null>(null);
  const voicePathRef = useRef<'ws' | 'http' | null>(null);
  const pressActiveRef = useRef<boolean | { value: boolean; timer: ReturnType<typeof setInterval> }>(false);
  const pressStartAtRef = useRef(0);
  const tapModeRef = useRef(false);
  const cancelModeRef = useRef(false);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const recordingDurationRef = useRef(0);
  const [, forceUpdate] = useState(0);
  const roundRef = useRef({ userAppended: false, audioPlayed: false, replyText: '' });
  const voiceOnRef = useRef(voiceOn);

  usePageTrack('/session/voice/:id');

  useEffect(() => { voiceOnRef.current = voiceOn; if (!voiceOn) stopSpeaking(); }, [voiceOn]);
  useEffect(() => () => {
    streamRef.current?.close();
    recorderRef.current?.cancel();
    httpAudioRef.current?.pause();
    stopSpeaking();
  }, []);

  // BFCache（往返缓存）：后退返回时页面被冻结快照，组件不会卸载（上面的清理不执行），
  // 且浏览器会强关 WebSocket（Console 报 "WebSocket connection failed: Page entered Back-Forward Cache"）。
  // 进入时主动释放语音资源；恢复时复位可能卡死的录音/识别状态，并允许重新建连。
  useEffect(() => {
    const onPagehide = (e: PageTransitionEvent) => {
      if (!e.persisted) return; // 正常路由离开走组件卸载清理
      console.warn('[VoiceSession] 页面进入 BFCache：主动关闭语音资源');
      streamRef.current?.close();
      streamRef.current = null;
      streamConnectingRef.current = null;
      recorderRef.current?.cancel();
      recorderRef.current = null;
      stopSpeaking();
    };
    const onPageshow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      console.warn('[VoiceSession] 页面从 BFCache 恢复：WebSocket 已失效，复位语音状态');
      dispatch({ type: 'sendError' });
      pressActiveRef.current = false;
      tapModeRef.current = false;
      voicePathRef.current = null;
      httpAudioRef.current?.pause();
      httpAudioRef.current = null;
      wsDeadRef.current = false; // 允许重新建连
      setVoiceStatus('idle');
      setPartialText('');
      setStreamingReply(null);
    };
    window.addEventListener('pagehide', onPagehide);
    window.addEventListener('pageshow', onPageshow);
    return () => {
      window.removeEventListener('pagehide', onPagehide);
      window.removeEventListener('pageshow', onPageshow);
    };
  }, []);

  useEffect(() => {
    if (initData || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<CreateSessionResponse>(`/sessions/${sessionId}`);
        if (cancelled) return;
        if (res.data.session.status !== 'active') { navigate(`/session/${sessionId}/review`); return; }
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [state.turns.length, state.sending, streamingReply]);

  const getVoiceStream = (sid: string): Promise<VoiceStreamClient> => {
    if (streamRef.current?.connected) return Promise.resolve(streamRef.current);
    if (!streamConnectingRef.current) {
      const client = new VoiceStreamClient({
        onPartial: (t) => setPartialText(t),
        onFinal: (t) => { setPartialText(''); roundRef.current.userAppended = true; dispatch({ type: 'appendTurns', turns: [{ speaker: 'trainee', text: t }] }); setTranscribedText(t); setShowTranscript(true); },
        onReplyText: (t) => { roundRef.current.replyText = t; setStreamingReply(t); },
        onTurnComplete: (turn, emotion) => {
          setStreamingReply(null);
          const replyText = turn?.personaTurn?.text ?? roundRef.current.replyText;
          const turns: VoiceTurnInput[] = [];
          if (!roundRef.current.userAppended && turn?.traineeTurn) turns.push(turn.traineeTurn);
          turns.push(turn?.personaTurn ?? { speaker: 'persona', text: replyText });
          dispatch({ type: 'appendTurns', turns, remainingSeconds: turn?.remainingSeconds });
          setVoiceStatus((s) => (s === 'waiting' ? 'idle' : s));
          if (!roundRef.current.audioPlayed && voiceOnRef.current && replyText && session?.id) void speakServerPersona(session.id, replyText, emotion?.arousal ?? turn?.personaTurn?.emotion?.arousal);
        },
        onPlayingChange: (playing) => { if (playing) roundRef.current.audioPlayed = true; setVoiceStatus((s) => playing ? 'playing' : s === 'playing' ? 'idle' : s); },
        onError: (msg) => { dispatch({ type: 'sendError' }); setStreamingReply(null); setPartialText(''); setVoiceStatus('idle'); window.alert(msg || '语音服务异常'); },
        onClose: () => { dispatch({ type: 'sendError' }); wsDeadRef.current = true; streamRef.current = null; streamConnectingRef.current = null; setStreamingReply(null); setPartialText(''); setVoiceStatus('idle'); client.close(); },
      });
      const p = client.connect(buildVoiceWsUrl(sid, getToken())).then(() => { streamRef.current = client; return client; }).catch((err: unknown) => { streamConnectingRef.current = null; throw err; });
      streamConnectingRef.current = p;
    }
    return streamConnectingRef.current;
  };

  const startVoicePress = () => {
    if (state.sending || ending || !session) return;
    if (voiceStatus === 'recording') { void finishVoicePress(); return; }
    if (voiceStatus !== 'idle') return;
    cancelModeRef.current = false;
    tapModeRef.current = false;
    pressStartAtRef.current = Date.now();
    recordingDurationRef.current = 0;
    // 启动计时器更新录音时长
    const timer = setInterval(() => {
      const c = pressActiveRef.current;
      if (typeof c === 'object' && c.value) {
        recordingDurationRef.current = Date.now() - pressStartAtRef.current;
        forceUpdate((n) => n + 1);
      }
    }, 200);
    pressActiveRef.current = { value: true, timer };
    void beginRecording();
  };

  const endVoicePress = () => {
    if (!pressActiveRef.current) return;
    const timer = typeof pressActiveRef.current === 'object' ? pressActiveRef.current.timer : undefined;
    if (timer) clearInterval(timer);
    pressActiveRef.current = false;
    const heldMs = Date.now() - pressStartAtRef.current;
    if (heldMs < 400 && !cancelModeRef.current) { tapModeRef.current = true; return; }
    if (voiceStatus === 'recording' && !cancelModeRef.current) void finishVoicePress();
    else if (cancelModeRef.current && voiceStatus === 'recording') {
      // 取消录音
      recorderRef.current?.cancel();
      recorderRef.current = null;
      streamRef.current?.cancelTalking?.();
      voicePathRef.current = null;
      setVoiceStatus('idle');
      setPartialText('');
    }
    cancelModeRef.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pressActiveRef.current || !micButtonRef.current) return;
    const rect = micButtonRef.current.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    // 手指上移超过按钮中心 60px 进入取消模式
    const shouldCancel = e.clientY < centerY - 60;
    if (shouldCancel !== cancelModeRef.current) {
      cancelModeRef.current = shouldCancel;
      forceUpdate((n) => n + 1);
    }
  };

  const beginRecording = async () => {
    if (!session) return;
    roundRef.current = { userAppended: false, audioPlayed: false, replyText: '' };
    setStreamingReply(null);
    setPartialText('');
    setTranscribedText('');
    setShowTranscript(false);
    if (!wsDeadRef.current) {
      try {
        const client = await getVoiceStream(session.id);
        await client.startTalking();
        voicePathRef.current = 'ws';
        setVoiceStatus('recording');
        if (!pressActiveRef.current && !tapModeRef.current) void finishVoicePress();
        return;
      } catch {
        wsDeadRef.current = true;
        streamRef.current = null;
        streamConnectingRef.current = null;
      }
    }
    if (VoiceRecorder.supported()) {
      try {
        const recorder = new VoiceRecorder();
        recorderRef.current = recorder;
        await recorder.start();
        voicePathRef.current = 'http';
        setVoiceStatus('recording');
        if (!pressActiveRef.current && !tapModeRef.current) void finishVoicePress();
        return;
      } catch { recorderRef.current = null; }
    }
    window.alert('当前环境无法使用语音，已切换到文字对练');
    navigate(`/session/text/${session.id}`, { replace: true });
  };

  const finishVoicePress = async () => {
    tapModeRef.current = false;
    const path = voicePathRef.current;
    voicePathRef.current = null;
    if (!session || !path) { setVoiceStatus('idle'); return; }
    setVoiceStatus('waiting');
    dispatch({ type: 'sendStart' });
    if (path === 'ws') { streamRef.current?.finishTalking(); return; }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) { dispatch({ type: 'sendError' }); setVoiceStatus('idle'); return; }
    try {
      const blob = await recorder.stop();
      const pcm = await blobToPcm16(blob);
      const res = await api.post<VoiceTurnResponse>(`/sessions/${session.id}/voice-turn`, pcm, { headers: { 'Content-Type': 'audio/pcm' } });
      const d = res.data;
      const replyText = d.turn?.personaTurn?.text ?? d.replyText ?? '';
      const arousal = d.turn?.personaTurn?.emotion?.arousal ?? d.emotion?.arousal;
      dispatch({ type: 'appendTurns', turns: [d.turn?.traineeTurn ?? { speaker: 'trainee', text: d.userText ?? '' }, d.turn?.personaTurn ?? { speaker: 'persona', text: replyText }], remainingSeconds: d.turn?.remainingSeconds });
      if (d.audioBase64) {
        const el = new Audio(`data:audio/${d.audioFormat ?? 'wav'};base64,${d.audioBase64}`);
        httpAudioRef.current = el;
        setVoiceStatus('playing');
        const done = (ok: boolean) => { httpAudioRef.current = null; setVoiceStatus((s) => s === 'playing' ? 'idle' : s); if (!ok && voiceOnRef.current && replyText && session?.id) void speakServerPersona(session.id, replyText, arousal); };
        el.onended = () => done(true);
        el.onerror = () => done(false);
        void el.play().catch(() => done(false));
} else {
setVoiceStatus('idle');
if (voiceOnRef.current && replyText && session?.id) void speakServerPersona(session.id, replyText, arousal);
}
    } catch { dispatch({ type: 'sendError' }); setVoiceStatus('idle'); window.alert('语音发送失败，请重试'); }
  };

  const interruptPlayback = () => {
    streamRef.current?.interrupt();
    if (httpAudioRef.current) { httpAudioRef.current.pause(); httpAudioRef.current = null; }
    stopSpeaking();
    setVoiceStatus((s) => s === 'playing' ? 'idle' : s);
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
            <button className="rounded-xl px-6 py-2.5 text-sm font-bold" style={{ backgroundColor: '#E85C62', color: '#F7F7FA' }} onClick={() => navigate('/practice')}>返回</button>
          </>
        ) : <p className="text-sm">正在恢复…</p>}
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#17191F]">
      <div className="flex items-center justify-between px-4 pt-4">
        <button className="flex h-9 w-9 items-center justify-center" onClick={endSession}>
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <div className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium" style={{ backgroundColor: state.remainingSeconds < 120 ? 'rgba(232,92,98,0.15)' : '#2A2D36', color: state.remainingSeconds < 120 ? '#E85C62' : '#F7F7FA' }}>
          剩余 {formatTime(state.remainingSeconds)}
        </div>
        <div className="w-9" />
      </div>

      <header className="px-5 pt-4">
        <div className="flex items-center gap-3">
          <Avatar name={persona?.name ?? '客户'} avatar={persona?.avatar} size="md" rounded="full" />
          <div>
            <p className="text-base font-bold leading-tight">{persona?.name ?? '客户'} · 语音对话</p>
            {persona?.occupation && <p className="mt-0.5 text-xs">{persona.occupation}</p>}
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-6 no-scrollbar">
        {state.turns.map((turn) => {
          if (turn.speaker === 'coach' || turn.isHint) {
            return <div key={turn.seq} className="flex justify-center"><div className="max-w-[85%] rounded-2xl border border-orange-500/40 0/10 px-4 py-2 text-sm"><span className="mb-1 block text-xs font-medium">教练提示</span>{turn.text}</div></div>;
          }
          const isTrainee = turn.speaker === 'trainee';
          return (
            <div key={turn.seq} className={`flex ${isTrainee ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed" style={{ backgroundColor: isTrainee ? '#E85C62' : '#22252D', color: '#F7F7FA' }}>{turn.text}</div>
            </div>
          );
        })}
        {streamingReply && (
          <div className="flex justify-start"><div className="max-w-[80%] rounded-2xl bg-[#2a4152] px-4 py-3 text-[15px] leading-relaxed">{streamingReply}</div></div>
        )}
        {state.sending && !streamingReply && <p className="pt-2 text-center text-xs">{voiceStatus === 'idle' ? '客户正在说话…' : '识别中…'}</p>}
        <div ref={bottomRef} />
      </main>

      {/* 转写预览 */}
      {showTranscript && transcribedText && (
        <div className="mx-4 mb-3 rounded-xl border border-[#33505f] bg-[#22394a] p-3">
          <p className="text-xs">转写预览 · 可校对</p>
          <p className="mt-1 text-sm">{transcribedText}</p>
          <div className="mt-2 flex gap-2">
            <button className="flex-1 rounded-lg border border-[#33505f] py-2 text-xs" onClick={() => { setShowTranscript(false); setTranscribedText(''); void beginRecording(); }}>重录</button>
            <button className="flex-1 rounded-lg py-2 text-xs font-bold" style={{ backgroundColor: '#E85C62', color: '#F7F7FA' }} onClick={() => setShowTranscript(false)}>发送本轮</button>
          </div>
        </div>
      )}

      <footer className="border-t border-white/5 px-5 pb-6 pt-4 safe-bottom">
        {/* 录音取消提示 */}
        {voiceStatus === 'recording' && cancelModeRef.current && (
          <div className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-red-500/20 py-3">
            <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            <span className="text-sm text-red-400">松开手指，取消发送</span>
          </div>
        )}
        {/* 录音时长显示 */}
        {voiceStatus === 'recording' && !cancelModeRef.current && (
          <div className="mb-3 flex items-center justify-center gap-2">
            <div className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-sm text-red-400">{Math.floor(recordingDurationRef.current / 1000)}s</span>
            </div>
            {partialText && <span className="ml-3 text-sm text-slate-400">{partialText}</span>}
          </div>
        )}
        <div className="flex items-center justify-center gap-4">
          <button
            ref={micButtonRef}
            className="flex h-16 w-16 touch-none items-center justify-center rounded-full transition active:scale-95 disabled:opacity-50"
            style={{
              backgroundColor: cancelModeRef.current ? '#ff4444' : voiceStatus === 'recording' ? '#ff4444' : '#E85C62',
              color: '#F7F7FA',
              transform: voiceStatus === 'recording' && !cancelModeRef.current ? 'scale(1.15)' : undefined,
              boxShadow: voiceStatus === 'recording' ? '0 0 0 6px rgba(255,68,68,0.25)' : undefined,
            }}
            onPointerDown={startVoicePress}
            onPointerUp={endVoicePress}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => { if (pressActiveRef.current) cancelModeRef.current = true; }}
            onPointerCancel={endVoicePress}
            onContextMenu={(e) => e.preventDefault()}
            disabled={ending || (state.sending && voiceStatus === 'idle')}
          >
            {voiceStatus === 'waiting' ? (
              <div className="h-6 w-6 animate-spin rounded-full border-2" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#F7F7FA' }} />
            ) : cancelModeRef.current ? (
              <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m0 0H8m4 0h4" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            ) : (
              <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V6a3 3 0 016 0v5a3 3 0 01-3 3z" /></svg>
            )}
          </button>
          {voiceStatus === 'playing' && (
            <button className="rounded-full border border-red-400/60 px-4 py-2 text-sm" onClick={interruptPlayback}>打断</button>
          )}
        </div>
        <p className="mt-3 text-center text-xs">
          {voiceStatus === 'recording' && !cancelModeRef.current && '正在录音 · 松开发送，上滑取消'}
          {voiceStatus === 'waiting' && '识别中…'}
          {voiceStatus === 'playing' && '对方说话中 · 可点击打断'}
          {voiceStatus === 'idle' && '按住说话'}
        </p>
        <button className="mt-4 mx-auto block w-full max-w-[260px] rounded-xl border border-[#33505f] py-3 text-sm font-medium" onClick={endSession}>结束 → 生成报告</button>
      </footer>
    </div>
  );
}
