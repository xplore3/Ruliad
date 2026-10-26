﻿﻿﻿﻿﻿﻿﻿import { useEffect, useReducer, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api, { getToken } from '../api';
import { usePageTrack } from '../track';
import { LiveKitCallClient } from '../voice/livekit';
import type { CallStatus } from '../voice/call';
import { stopSpeaking } from '../tts';
import { Avatar } from '../components/Avatar';
import type { CreateSessionResponse, Persona, TranscriptTurn } from '../types';

interface SessionState {
  turns: TranscriptTurn[];
  remainingSeconds: number;
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
  | { type: 'load'; turns: TranscriptTurn[]; remainingSeconds: number }
  | { type: 'appendTurns'; turns: VoiceTurnInput[]; remainingSeconds?: number }
  | { type: 'sendError' };

function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'tick':
      return state.remainingSeconds > 0 ? { ...state, remainingSeconds: state.remainingSeconds - 1 } : state;
    case 'load':
      return { ...state, turns: action.turns, remainingSeconds: action.remainingSeconds };
    case 'appendTurns': {
      let nextSeq = state.turns.reduce((m, t) => Math.max(m, t.seq), 0);
      const turns: TranscriptTurn[] = action.turns.filter((t) => t.text).map((t) => ({ ...t, seq: t.seq ?? ++nextSeq, at: t.at ?? new Date().toISOString() }));
      return { ...state, sending: false, turns: [...state.turns, ...turns], remainingSeconds: action.remainingSeconds ?? state.remainingSeconds };
    }
    case 'sendError':
      return { ...state, sending: false };
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function VoiceCall() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams<{ sessionId: string }>();
  const initData = location.state as CreateSessionResponse | null;
  const [session, setSession] = useState(initData?.session ?? null);
  const [persona, setPersona] = useState<Persona | null>(initData?.persona ?? null);

  const [state, dispatch] = useReducer(reducer, {
    turns: initData?.session.transcript ?? [],
    remainingSeconds: initData?.remainingSeconds ?? 372,
    sending: false,
  });
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [partialText, setPartialText] = useState('');
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [showSubtitle, setShowSubtitle] = useState(true);
  const [dialing, setDialing] = useState(false);
  const dialToneRef = useRef<AudioContext | null>(null);
  const dialingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callRef = useRef<LiveKitCallClient | null>(null);
  const callConnectingRef = useRef<Promise<void> | null>(null);
  const roundRef = useRef({ userAppended: false, replyText: '' });
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  usePageTrack('/session/call/:id');

  // 页面加载时：停止任何残留的语音播放（从其他页面切换过来时可能残留）
  useEffect(() => {
    stopSpeaking();
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
        dispatch({ type: 'load', turns: res.data.session.transcript, remainingSeconds: res.data.remainingSeconds });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [initData, sessionId, navigate]);

  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (callStatus === 'listening' || callStatus === 'speaking') {
      if (!durationTimerRef.current) {
        durationTimerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
      }
    }
    return () => {
      if (callStatus === 'idle' && durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    };
  }, [callStatus]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [state.turns.length, streamingReply]);

  useEffect(() => () => { void callRef.current?.disconnect(); }, []);

  // 清理拨号音效
  useEffect(() => () => {
    if (dialToneRef.current) {
      try { dialToneRef.current.close(); } catch { /* ignore */ }
      dialToneRef.current = null;
    }
    if (dialingTimerRef.current) {
      clearTimeout(dialingTimerRef.current);
      dialingTimerRef.current = null;
    }
  }, []);

  // BFCache（往返缓存）：后退返回时页面被冻结快照，组件不会卸载（上面的清理不执行），
  // 且浏览器会强关 WebSocket。进入时主动释放通话资源；恢复时复位状态，用户重新点接听即可。
  useEffect(() => {
    const onPagehide = (e: PageTransitionEvent) => {
      if (!e.persisted) return; // 正常路由离开走组件卸载清理
      console.warn('[VoiceCall] 页面进入 BFCache：主动关闭通话资源');
      void callRef.current?.disconnect();
      callRef.current = null;
      callConnectingRef.current = null;
    };
    const onPageshow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      console.warn('[VoiceCall] 页面从 BFCache 恢复：WebSocket 已失效，请重新发起通话');
      dispatch({ type: 'sendError' });
      callRef.current = null;
      callConnectingRef.current = null;
      setCallStatus('idle');
      setPartialText('');
      setStreamingReply(null);
      setCallDuration(0);
    };
    window.addEventListener('pagehide', onPagehide);
    window.addEventListener('pageshow', onPageshow);
    return () => {
      window.removeEventListener('pagehide', onPagehide);
      window.removeEventListener('pageshow', onPageshow);
    };
  }, []);

  /** POST /sessions/:id/livekit-ticket → room + token + url */
  const fetchLiveKitTicket = async (sid: string) => {
    const res = await api.post<{ url: string; token: string; room: string }>(
      `/sessions/${sid}/livekit-ticket`,
      null,
      { params: { token: getToken() } }
    );
    return res.data;
  };

  const connectLiveKit = async (_sid: string) => {
    const client = new LiveKitCallClient({
      onStatusChange: (s) => setCallStatus(s),
      onPartial: (t) => setPartialText(t),
      onFinal: (t) => { setPartialText(''); roundRef.current.userAppended = true; dispatch({ type: 'appendTurns', turns: [{ speaker: 'trainee', text: t }] }); },
      onReplyText: (t) => { roundRef.current.replyText = t; setStreamingReply(t); },
      onTurnComplete: (turn, _emotion) => {
        setStreamingReply(null);
        const replyText = turn?.personaTurn?.text ?? roundRef.current.replyText;
        const turns: VoiceTurnInput[] = [];
        if (!roundRef.current.userAppended && turn?.traineeTurn) turns.push(turn.traineeTurn);
        turns.push(turn?.personaTurn ?? { speaker: 'persona', text: replyText });
        dispatch({ type: 'appendTurns', turns, remainingSeconds: turn?.remainingSeconds });
      },
      onError: (msg) => {
        console.warn('[VoiceCall] 通话警告:', msg);
      },
      onClose: () => { callRef.current = null; callConnectingRef.current = null; setStreamingReply(null); setPartialText(''); setCallStatus('idle'); },
    });
    return client;
  };

  const getCallClient = async (sid: string): Promise<void> => {
    if (callRef.current?.isConnected()) return Promise.resolve();
    if (callConnectingRef.current) return callConnectingRef.current as unknown as Promise<void>;
    const client = await connectLiveKit(sid);
    const ticket = await fetchLiveKitTicket(sid);
    console.log(`[LiveKit] 获取 ticket 成功: room=${ticket.room}`);
    const p = client.connect(ticket.url, ticket.token).then(() => { callRef.current = client; }).catch((err: unknown) => { callConnectingRef.current = null; throw err; });
    callConnectingRef.current = p as unknown as Promise<void>;
    return p;
  };

  const playDialTone = () => {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      dialToneRef.current = ctx;
      // 生成拨号音：440Hz + 480Hz 双音（模拟电话拨号音）
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      gain.gain.value = 0.08;
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start();
      osc2.start();
    } catch {
      // 音频上下文创建失败时静默忽略
    }
  };

  const stopDialTone = () => {
    if (dialToneRef.current) {
      try { dialToneRef.current.close(); } catch { /* ignore */ }
      dialToneRef.current = null;
    }
  };

  const startCall = async () => {
    if (!session) return;
    // 模拟拨号过程：随机 10-30 秒等待，模拟真实电话接通延迟
    const delayMs = Math.floor(Math.random() * 20000) + 10000; // 10000-30000ms
    console.log(`[VoiceCall] 开始拨号 sessionId=${session.id}，预计等待 ${(delayMs / 1000).toFixed(0)} 秒`);
    setDialing(true);
    playDialTone();
    const startedAt = Date.now();
    const tickTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setDialing((_d) => _d); // 强制刷新以更新倒计时显示
      console.log(`[VoiceCall] 拨号中… ${elapsed}/${(delayMs / 1000).toFixed(0)} 秒`);
    }, 1000);
    dialingTimerRef.current = setTimeout(async () => {
      clearInterval(tickTimer);
      console.log(`[VoiceCall] 拨号完成，开始建立连接（实际等待 ${Date.now() - startedAt}ms）`);
      stopDialTone();
      setDialing(false);
      try {
        await getCallClient(session.id);
        console.log('[VoiceCall] WebSocket 已连接，请求麦克风并发送 start…');
        await callRef.current!.startCall();
        console.log('[VoiceCall] 语音通话已启动');
        setCallDuration(0);
      } catch (err) {
        console.error(
          '[VoiceCall] 语音通话启动失败：',
          err instanceof Error ? err.message : err,
          '\n常见原因：① 反向代理未透传 WebSocket Upgrade 头（看上方 WS 关闭 code：1006/4401，服务端应有「鉴权失败：返回 401」日志）' +
            '② 麦克风权限被拒或页面非 https/localhost（看上方「麦克风获取失败」日志）③ 服务未启动'
        );
        callRef.current = null;
        callConnectingRef.current = null;
        window.alert('无法建立语音通话，请改用语音消息或文字');
        navigate(`/session/voice/${session.id}`, { replace: true });
      }
    }, delayMs);
  };

  const stopCall = () => {
    callRef.current?.stopCall();
    setPartialText('');
    setStreamingReply(null);
    setCallDuration(0);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    void callRef.current?.setMuted(next);
  };

  const endSession = () => {
    stopCall();
    if (session) navigate(`/session/${session.id}/end`);
  };

  if (!session) {
    return <div className="relative mx-auto flex min-h-screen w-full max-w-md items-center justify-center bg-[#17191F]"><p className="text-sm">正在恢复…</p></div>;
  }

  const connected = callStatus !== 'idle' && callStatus !== 'connecting';

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col bg-gradient-to-b from-[#17191F] via-[#1e3042] to-[#0f1923]">
      {/* 顶部 */}
      <div className="flex items-center justify-between px-4 pt-6">
        <button className="flex h-9 w-9 items-center justify-center" onClick={endSession}>
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <span className={`text-sm font-medium ${connected ? 'text-green-400' : ''}`}>
          {connected ? `已连接 · ${formatDuration(callDuration)}` : '语音通话'}
        </span>
        <div className="w-9" />
      </div>

      {/* 陪练员头像 */}
      <div className="flex flex-col items-center px-6 pt-8">
        <div className={`flex h-32 w-32 items-center justify-center rounded-full transition ${callStatus === 'speaking' ? 'scale-105 shadow-2xl shadow-orange-500/30' : ''}`}>
          <Avatar name={persona?.name ?? '客户'} avatar={persona?.avatar} size="xl" rounded="full" className="shadow-lg" />
        </div>
        <p className="mt-4 text-xl font-bold">{persona?.name ?? '客户'}</p>
        <p className="mt-1 text-sm">
          {callStatus === 'listening' && '正在倾听…'}
          {callStatus === 'speaking' && streamingReply ? `"${streamingReply.slice(0, 40)}${streamingReply.length > 40 ? '…' : ''}"` : ''}
          {callStatus === 'connecting' && '正在连接…'}
          {callStatus === 'processing' && '识别中…'}
          {callStatus === 'idle' && '点击下方按钮开始通话'}
        </p>
      </div>

      {/* 字幕区 */}
      {showSubtitle && connected && (partialText || streamingReply) && (
        <div className="mx-6 mt-6 rounded-2xl bg-black/30 px-4 py-3">
          {partialText && <p className="text-sm">{partialText}</p>}
        </div>
      )}

      {/* 对话记录（可滚动） */}
      {state.turns.length > 1 && (
        <div className="mx-4 mt-4 max-h-32 space-y-2 overflow-y-auto no-scrollbar">
          {state.turns.slice(-4).map((turn) => {
            if (turn.speaker === 'persona') {
              return <div key={turn.seq} className="text-left"><span className="text-xs">{turn.text}</span></div>;
            }
            return <div key={turn.seq} className="text-right"><span className="text-xs /80">{turn.text}</span></div>;
          })}
        </div>
      )}

      <div className="flex-1" />

      {/* 底部控制 */}
      <div className="px-6 pb-8 pt-4 safe-bottom">
        <div className="flex items-center justify-center gap-6">
          {/* 静音 */}
          <button
            className={`flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-full transition`}
style={{ backgroundColor: muted ? '#E85C62' : '#22252D', color: '#F7F7FA' }}
            onClick={toggleMute}
            disabled={!connected}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              {muted ? (
                <>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H3v6h3l5 4V5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M22 9l-6 6M16 9l6 6" />
                </>
              ) : (
                <>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H3v6h3l5 4V5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" />
                </>
              )}
            </svg>
            <span className="text-[10px]">静音</span>
          </button>

          {/* 接听/挂断 */}
          {connected ? (
            <button
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/30 transition active:scale-90"
              onClick={stopCall}
            >
              <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.92-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 01-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.42 2.42c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 00-2.66-1.85.996.996 0 01-.56-.92v-3.1C15.15 9.25 13.6 9 12 9z" />
              </svg>
            </button>
          ) : dialing ? (
            <button
              className="flex h-16 w-16 items-center justify-center rounded-full bg-yellow-500 shadow-lg shadow-yellow-500/30 transition active:scale-90 animate-pulse"
              onClick={() => {
                if (dialingTimerRef.current) { clearTimeout(dialingTimerRef.current); dialingTimerRef.current = null; }
                // 同时清理可能存在的倒计时日志定时器
                // tickTimer 会在 setTimeout 触发时自动清理，取消时 dialing 设为 false 后 tickTimer 的下一次执行会因 dialing 为 false 而自然停止
                stopDialTone();
                setDialing(false);
              }}
            >
              <div className="h-6 w-6 animate-spin rounded-full border-3 border-white/30 border-t-white" />
            </button>
          ) : (
            <button
              className="flex h-16 w-16 items-center justify-center rounded-full shadow-lg shadow-green-500/30 transition active:scale-90 disabled:opacity-50"
              onClick={startCall}
              disabled={callStatus === 'connecting'}
            >
              <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </button>
          )}

          {/* 字幕 */}
          <button
            className={`flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-full transition`}
style={{ backgroundColor: showSubtitle ? '#E85C62' : '#22252D', color: '#F7F7FA' }}
            onClick={() => setShowSubtitle(!showSubtitle)}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            <span className="text-[10px]">字幕</span>
          </button>
        </div>

        <button className="mt-6 mx-auto block w-full max-w-[260px] rounded-xl border border-white/10 py-3 text-sm font-medium" onClick={endSession}>
          结束通话 → 生成报告
        </button>
      </div>
    </div>
  );
}
