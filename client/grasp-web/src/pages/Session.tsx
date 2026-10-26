﻿import { useEffect, useReducer, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api, { getToken } from '../api';
import { trackAction, usePageTrack } from '../track';
import { speakPersona, stopSpeaking, ttsSupported } from '../tts';
import { VoiceRecorder, blobToPcm16 } from '../voice/recorder';
import { VoiceStreamClient, buildVoiceWsUrl } from '../voice/stream';
import { VoiceCallClient, buildVoiceCallWsUrl, type CallStatus } from '../voice/call';
import { SessionVideoRecorder, extractFrames } from '../video/recorder';
import type {
  CreateSessionResponse,
  HintResponse,
  Persona,
  QuizQuestion,
  QuizAnswerResponse,
  TranscriptTurn,
  TurnResponse,
  VoiceTurnResponse,
} from '../types';

type InputMode = 'text' | 'voice' | 'call';

interface SessionState {
  turns: TranscriptTurn[];
  remainingSeconds: number;
  hintsRemaining: number;
  sending: boolean;
}

/** 语音流程补录的消息：seq/at 可缺省，由 reducer 续排 */
type VoiceTurnInput = Omit<TranscriptTurn, 'seq' | 'at' | 'speaker' | 'text'> & {
  speaker: TranscriptTurn['speaker'];
  text: string;
  seq?: number;
  at?: string;
};

/** 服务端 TTS 播报 persona 文本（音色与人设一致）；失败时回退浏览器 speechSynthesis */
async function speakServerPersona(sessionId: string, text: string, arousal?: number): Promise<void> {
  try {
    const res = await api.post<{ audioBase64: string; audioFormat: string }>(
      `/sessions/${sessionId}/tts`,
      { text, arousal }
    );
    const el = new Audio(`data:audio/${res.data.audioFormat};base64,${res.data.audioBase64}`);
    el.onerror = () => speakPersona(text, arousal);
    await el.play().catch(() => speakPersona(text, arousal));
  } catch {
    speakPersona(text, arousal);
  }
}

type VoiceStatus = 'idle' | 'recording' | 'waiting' | 'playing';

type SessionAction =
  | { type: 'tick' }
  | { type: 'load'; turns: TranscriptTurn[]; remainingSeconds: number; hintsRemaining: number }
  | { type: 'sendStart' }
  | { type: 'sendDone'; traineeTurn: TranscriptTurn; personaTurn: TranscriptTurn; remainingSeconds: number }
  | { type: 'appendTurns'; turns: VoiceTurnInput[]; remainingSeconds?: number }
  | { type: 'sendError' }
  | { type: 'hint'; hintTurn: TranscriptTurn; hintsRemaining: number };

function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'tick':
      return state.remainingSeconds > 0
        ? { ...state, remainingSeconds: state.remainingSeconds - 1 }
        : state;
    case 'load':
      return {
        ...state,
        turns: action.turns,
        remainingSeconds: action.remainingSeconds,
        hintsRemaining: action.hintsRemaining,
      };
    case 'sendStart':
      return { ...state, sending: true };
    case 'sendDone':
      return {
        ...state,
        sending: false,
        turns: [...state.turns, action.traineeTurn, action.personaTurn],
        remainingSeconds: action.remainingSeconds,
      };
    case 'appendTurns': {
      let nextSeq = state.turns.reduce((m, t) => Math.max(m, t.seq), 0);
      const turns: TranscriptTurn[] = action.turns
        .filter((t) => t.text)
        .map((t) => ({
          ...t,
          seq: t.seq ?? ++nextSeq,
          at: t.at ?? new Date().toISOString(),
        }));
      return {
        ...state,
        sending: false,
        turns: [...state.turns, ...turns],
        remainingSeconds: action.remainingSeconds ?? state.remainingSeconds,
      };
    }
    case 'sendError':
      return { ...state, sending: false };
    case 'hint':
      return {
        ...state,
        turns: [...state.turns, action.hintTurn],
        hintsRemaining: action.hintsRemaining,
      };
  }
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function Session() {
  const navigate = useNavigate();
  const location = useLocation();
  // 路由参数名为 scenarioId，实际传入的是 session id（与 main.tsx 路由一致）
  const { scenarioId: sessionId } = useParams<{ scenarioId: string }>();
  const initData = location.state as (CreateSessionResponse & { mode?: 'practice' | 'exam' }) | null;
  const [session, setSession] = useState(initData?.session ?? null);
  const [mode, setMode] = useState<'practice' | 'exam'>(
    initData?.mode ?? initData?.session.mode ?? 'practice'
  );
  const [persona, setPersona] = useState<Persona | null>(initData?.persona ?? null);
  const [loadError, setLoadError] = useState(false);

  const [state, dispatch] = useReducer(reducer, {
    turns: initData?.session.transcript ?? [],
    remainingSeconds: initData?.remainingSeconds ?? 372,
    hintsRemaining: initData ? 3 - initData.session.hintsUsed : 3,
    sending: false,
  });
const [input, setInput] = useState('');
const [ending, setEnding] = useState(false);
const [inputMode, setInputMode] = useState<InputMode>('voice');
// 考题弹窗
const [pendingQuiz, setPendingQuiz] = useState<QuizQuestion | null>(null);
const [quizAnswer, setQuizAnswer] = useState<string[]>([]);
const [quizResult, setQuizResult] = useState<{ correct: boolean; score: number; explanation: string; correctAnswer: string[] | string } | null>(null);
const [quizSubmitting, setQuizSubmitting] = useState(false);
  // 陪练员语音（TTS）：默认开启，浏览器不支持时不渲染开关；服务端音频优先，浏览器 TTS 兜底
  const [voiceOn, setVoiceOn] = useState(ttsSupported());
  // 正面录像：默认开启（浏览器支持时），拒绝授权/无摄像头时降级为无视频对练
  const [videoOn, setVideoOn] = useState(() => SessionVideoRecorder.supported());
  const [videoStatus, setVideoStatus] = useState<'idle' | 'recording' | 'denied'>('idle');
  const videoRecorderRef = useRef<SessionVideoRecorder | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  // 语音对练状态机：idle → recording → waiting →(playing)→ idle
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [partialText, setPartialText] = useState('');
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const streamRef = useRef<VoiceStreamClient | null>(null);
  const streamConnectingRef = useRef<Promise<VoiceStreamClient> | null>(null);
  // 语音通话（三期全双工）
  const callRef = useRef<VoiceCallClient | null>(null);
  const callConnectingRef = useRef<Promise<void> | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  /** WS 建连失败后本轮页面内不再尝试，直接用一期 HTTP */
  const wsDeadRef = useRef(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const httpAudioRef = useRef<HTMLAudioElement | null>(null);
  const voicePathRef = useRef<'ws' | 'http' | null>(null);
  const pressActiveRef = useRef(false);
  const pressStartAtRef = useRef(0);
  /** 短按（点按）切换模式：按下<400ms 松开后保持录制，再点一下结束 */
  const tapModeRef = useRef(false);
  /** 一轮语音的临时信息：用户气泡是否已上屏 / 服务端是否已下发音频 / reply_text 全文 */
  const roundRef = useRef({ userAppended: false, audioPlayed: false, replyText: '' });
  const voiceOnRef = useRef(voiceOn);

  usePageTrack('/session/:id');

  useEffect(() => {
    voiceOnRef.current = voiceOn;
    if (!voiceOn) stopSpeaking();
  }, [voiceOn]);

  // 卸载时释放全部语音资源
  useEffect(() => {
    return () => {
      streamRef.current?.close();
      callRef.current?.close();
      recorderRef.current?.cancel();
      httpAudioRef.current?.pause();
      stopSpeaking();
    };
  }, []);

  // BFCache（往返缓存）：后退返回时页面被冻结快照，组件不会卸载（上面的清理不执行），
  // 且浏览器会强关 WebSocket（Console 报 "WebSocket connection failed: Page entered Back-Forward Cache"）。
  // 进入时主动释放语音/录像资源；恢复时复位可能卡死的状态，并允许重新建连。
  useEffect(() => {
    const onPagehide = (e: PageTransitionEvent) => {
      if (!e.persisted) return; // 正常路由离开走组件卸载清理
      console.warn('[Session] 页面进入 BFCache：主动关闭语音/录像资源');
      streamRef.current?.close();
      streamRef.current = null;
      streamConnectingRef.current = null;
      callRef.current?.close();
      callRef.current = null;
      callConnectingRef.current = null;
      recorderRef.current?.cancel();
      recorderRef.current = null;
      videoRecorderRef.current?.cancel();
      videoRecorderRef.current = null;
      stopSpeaking();
    };
    const onPageshow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      console.warn('[Session] 页面从 BFCache 恢复：WebSocket 已失效，复位语音状态');
      dispatch({ type: 'sendError' });
      pressActiveRef.current = false;
      tapModeRef.current = false;
      voicePathRef.current = null;
      httpAudioRef.current?.pause();
      httpAudioRef.current = null;
      wsDeadRef.current = false; // 允许重新建连
      setVoiceStatus('idle');
      setCallStatus('idle');
      setVideoStatus('idle');
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

  // 新开对练：播报陪练员开场白（仅 location.state 直达场景，刷新恢复不重播历史）
  useEffect(() => {
    if (!initData || !voiceOn) return;
    const opening = [...(initData.session.transcript ?? [])]
      .reverse()
      .find((t) => t.speaker === 'persona');
    // 开场白走服务端 TTS（与人设音色一致），失败时内部自动回退浏览器播报
    if (opening) void speakServerPersona(initData.session.id, opening.text, opening.emotion?.arousal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 刷新/直链恢复：无 location.state 时从后端拉取会话；已结束的会话直接跳复盘
  useEffect(() => {
    if (initData || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<CreateSessionResponse>(`/sessions/${sessionId}`);
        if (cancelled) return;
        if (res.data.session.status !== 'active') {
          navigate(`/session/${sessionId}/review`, { replace: true });
          return;
        }
        setSession(res.data.session);
        setMode(res.data.session.mode ?? 'practice');
        setPersona(res.data.persona ?? null);
        // 排查音色问题用：打印当前说话人属性（音色由服务端按 persona 决定）
        console.debug('[voice] 说话人属性', {
          name: res.data.persona?.name,
          age: res.data.persona?.age,
          occupation: res.data.persona?.occupation,
        });
        dispatch({
          type: 'load',
          turns: res.data.session.transcript,
          remainingSeconds: res.data.remainingSeconds,
          hintsRemaining: 3 - res.data.session.hintsUsed,
        });
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initData, sessionId, navigate]);

  // 会话就绪且录像开关打开时，启动整场正面录像（与语音链路相互独立的媒体流）；
  // 关闭开关 / 退出页面时停止并丢弃。权限被拒或设备无摄像头：降级为无视频对练
  useEffect(() => {
    if (!session || !videoOn) return;
    let cancelled = false;
    const recorder = new SessionVideoRecorder();
    videoRecorderRef.current = recorder;
    recorder
      .start()
      .then(() => {
        if (cancelled) {
          recorder.cancel();
          return;
        }
        setVideoStatus('recording');
      })
      .catch(() => {
        if (videoRecorderRef.current === recorder) videoRecorderRef.current = null;
        if (!cancelled) setVideoStatus('denied');
      });
    return () => {
      cancelled = true;
      recorder.cancel();
      if (videoRecorderRef.current === recorder) videoRecorderRef.current = null;
      setVideoStatus('idle');
    };
  }, [session, videoOn]);

  // 预览小窗在 recording 状态下才挂载，需在挂载后绑定媒体流
  useEffect(() => {
    if (videoStatus === 'recording' && videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = videoRecorderRef.current?.getStream() ?? null;
    }
  }, [videoStatus]);

  // 剩余 2 分钟：微震动提示一次（设计的变色提醒已有，此处补触感反馈）
  const vibratedRef = useRef(false);
  useEffect(() => {
    if (state.remainingSeconds < 120 && !vibratedRef.current) {
      vibratedRef.current = true;
      navigator.vibrate?.(200);
    }
  }, [state.remainingSeconds]);

  // 拦截浏览器返回：误触退出会丢会话，需二次确认
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const onPopState = () => {
      if (window.confirm('确定退出本次对练吗？退出后本次记录将不会保存。')) {
        navigate('/tasks');
      } else {
        window.history.pushState(null, '', window.location.href);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [navigate]);

  // 倒计时：每秒递减（会话恢复前不计时）
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(timer);
  }, [session]);

  // 新消息自动滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.turns.length, state.sending, streamingReply]);

  // 考核模式：切屏上报，达到上限由后端自动交卷
  useEffect(() => {
    if (mode !== 'exam' || !session) return;
    const sessionId = session.id;
    const onVisibilityChange = async () => {
      if (!document.hidden) return;
      try {
        const res = await api.post<{ ended: boolean; reason?: string; count?: number }>(
          `/sessions/${sessionId}/proctor-events`,
          { kind: 'tab_switch' }
        );
        if (res.data.ended) {
          window.alert('切屏次数超限，考核已自动交卷');
          navigate(`/session/${sessionId}/review`);
        }
      } catch {
        // 上报失败不打断考核
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [mode, session, navigate]);

const send = async () => {
const text = input.trim();
if (!text || state.sending || ending || !session) return;
setInput('');
dispatch({ type: 'sendStart' });
try {
const res = await api.post<TurnResponse>(`/sessions/${session.id}/turns`, { text });
dispatch({
type: 'sendDone',
traineeTurn: res.data.traineeTurn,
personaTurn: res.data.personaTurn,
remainingSeconds: res.data.remainingSeconds,
});
// 陪练员语音回复：服务端 TTS（与人设音色一致），失败时内部回退浏览器播报
if (voiceOn) {
void speakServerPersona(session.id, res.data.personaTurn.text, res.data.personaTurn.emotion?.arousal);
}
// 考题触发
if (res.data.pendingQuizzes?.length) {
setPendingQuiz(res.data.pendingQuizzes[0]);
setQuizAnswer([]);
setQuizResult(null);
}
} catch {
dispatch({ type: 'sendError' });
window.alert('发送失败，请重试');
}
};

const requestHint = async () => {
if (mode === 'exam' || state.hintsRemaining <= 0 || state.sending || !session) return;
trackAction('hint_click', { sessionId: session.id, hintsRemaining: state.hintsRemaining });
try {
const res = await api.post<HintResponse>(`/sessions/${session.id}/hint`);
dispatch({ type: 'hint', hintTurn: res.data.hintTurn, hintsRemaining: res.data.hintsRemaining });
} catch {
window.alert('提示次数已用完');
}
};

const submitQuiz = async () => {
if (!pendingQuiz || !session || quizSubmitting) return;
if (pendingQuiz.required && quizAnswer.length === 0) return;
setQuizSubmitting(true);
try {
const res = await api.post<QuizAnswerResponse>(`/sessions/${session.id}/quiz-answer`, {
quizId: pendingQuiz.id,
answer: quizAnswer,
});
setQuizResult({ correct: res.data.correct, score: res.data.score, explanation: res.data.explanation, correctAnswer: res.data.correctAnswer });
} catch {
window.alert('提交答案失败，请重试');
} finally {
setQuizSubmitting(false);
}
};

const closeQuiz = () => {
setPendingQuiz(null);
setQuizAnswer([]);
setQuizResult(null);
};

  // ---------- 语音对练：二期 WS 流式优先，一期 HTTP 批量降级，最终回退文字 ----------

  /** 懒建立 WS 连接（回调只依赖 ref/dispatch/setState，无闭包过期问题） */
  const getVoiceStream = (sid: string): Promise<VoiceStreamClient> => {
    if (streamRef.current?.connected) return Promise.resolve(streamRef.current);
    if (!streamConnectingRef.current) {
      const client = new VoiceStreamClient({
        onPartial: (t) => setPartialText(t),
        onFinal: (t) => {
          // ASR 锁定 → 用户气泡上屏
          setPartialText('');
          roundRef.current.userAppended = true;
          dispatch({ type: 'appendTurns', turns: [{ speaker: 'trainee', text: t }] });
        },
        onReplyText: (t) => {
          // persona 回复全文：先以流式气泡展示，turn_complete 时落进消息列表
          roundRef.current.replyText = t;
          setStreamingReply(t);
        },
        onTurnComplete: (turn, emotion) => {
          setStreamingReply(null);
          const replyText = turn?.personaTurn?.text ?? roundRef.current.replyText;
          console.debug('[voice] WS 轮次完成', {
            reply: replyText?.slice(0, 30),
            服务端音频已播: roundRef.current.audioPlayed,
          });
          const turns: VoiceTurnInput[] = [];
          // asr_final 缺失时补录用户气泡
          if (!roundRef.current.userAppended && turn?.traineeTurn) turns.push(turn.traineeTurn);
          turns.push(turn?.personaTurn ?? { speaker: 'persona', text: replyText });
          dispatch({ type: 'appendTurns', turns, remainingSeconds: turn?.remainingSeconds });
          setVoiceStatus((s) => (s === 'waiting' ? 'idle' : s));
          // 服务端本轮未下发音频时，回退浏览器 TTS
          if (!roundRef.current.audioPlayed && voiceOnRef.current && replyText) {
            speakPersona(replyText, emotion?.arousal ?? turn?.personaTurn?.emotion?.arousal);
          }
        },
        onPlayingChange: (playing) => {
          if (playing) roundRef.current.audioPlayed = true;
          setVoiceStatus((s) => {
            if (playing) return 'playing';
            return s === 'playing' ? 'idle' : s;
          });
        },
        onError: (message) => {
          dispatch({ type: 'sendError' });
          setStreamingReply(null);
          setPartialText('');
          setVoiceStatus('idle');
          window.alert(message || '语音服务异常，请改用文字输入');
        },
        onClose: () => {
          // 连接中断：复位可能在途的回合（避免一直"客户正在说话…"），后续语音降级一期 HTTP
          dispatch({ type: 'sendError' });
          wsDeadRef.current = true;
          streamRef.current = null;
          streamConnectingRef.current = null;
          setStreamingReply(null);
          setPartialText('');
          setVoiceStatus('idle');
        },
      });
      const p = client
        .connect(buildVoiceWsUrl(sid, getToken()))
        .then(() => {
          streamRef.current = client;
          return client;
        })
        .catch((err: unknown) => {
          streamConnectingRef.current = null;
          throw err;
        });
      streamConnectingRef.current = p;
    }
    return streamConnectingRef.current;
  };

  /** 按下：开始录制（点按模式下再按一次 = 结束） */
  const startVoicePress = () => {
    if (state.sending || ending || !session) return;
    if (voiceStatus === 'recording') {
      void finishVoicePress();
      return;
    }
    if (voiceStatus !== 'idle') return;
    pressActiveRef.current = true;
    tapModeRef.current = false;
    pressStartAtRef.current = Date.now();
    void beginRecording();
  };

  /** 松开：长按（>=400ms）结束录制；短按切换为点按模式，保持录制 */
  const endVoicePress = () => {
    if (!pressActiveRef.current) return;
    pressActiveRef.current = false;
    const heldMs = Date.now() - pressStartAtRef.current;
    if (heldMs < 400) {
      tapModeRef.current = true;
      return;
    }
    if (voiceStatus === 'recording') {
      void finishVoicePress();
    }
    // 长按时若仍在建连/申请权限，beginRecording 完成后会立即 finish
  };

  const beginRecording = async () => {
    if (!session) return;
    roundRef.current = { userAppended: false, audioPlayed: false, replyText: '' };
    setStreamingReply(null);
    setPartialText('');
    // 优先二期 WS 流式
    if (!wsDeadRef.current) {
      try {
        const client = await getVoiceStream(session.id);
        await client.startTalking();
        voicePathRef.current = 'ws';
        setVoiceStatus('recording');
        // 建连期间用户已松手（且非点按模式）：立即结束本轮
        if (!pressActiveRef.current && !tapModeRef.current) void finishVoicePress();
        return;
      } catch {
        // WS 建连/采集失败：本轮及后续降级一期 HTTP
        wsDeadRef.current = true;
        streamRef.current = null;
        streamConnectingRef.current = null;
      }
    }
    // 降级一期 HTTP 批量
    if (VoiceRecorder.supported()) {
      try {
        const recorder = new VoiceRecorder();
        recorderRef.current = recorder;
        await recorder.start();
        voicePathRef.current = 'http';
        setVoiceStatus('recording');
        if (!pressActiveRef.current && !tapModeRef.current) void finishVoicePress();
        return;
      } catch {
        // 权限被拒等
        recorderRef.current = null;
      }
    }
    // 一期二期都不可用：回退文字输入
    window.alert('当前环境无法使用语音（麦克风不可用或未授权），已切换到文字输入');
    setInputMode('text');
  };

  const finishVoicePress = async () => {
    tapModeRef.current = false;
    const path = voicePathRef.current;
    voicePathRef.current = null;
    if (!session || !path) {
      setVoiceStatus('idle');
      return;
    }
    setVoiceStatus('waiting');
    dispatch({ type: 'sendStart' });
    if (path === 'ws') {
      // 后续由 onFinal / onTurnComplete 驱动上屏
      streamRef.current?.finishTalking();
      return;
    }
    // 一期 HTTP：录音 Blob → voice-turn
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) {
      dispatch({ type: 'sendError' });
      setVoiceStatus('idle');
      return;
    }
    try {
      const blob = await recorder.stop();
      // 浏览器录出的是 webm/mp4 容器，服务端 ASR 只认裸 PCM：先解码重采样为 16kHz PCM16
      const pcm = await blobToPcm16(blob);
      const res = await api.post<VoiceTurnResponse>(`/sessions/${session.id}/voice-turn`, pcm, {
        headers: { 'Content-Type': 'audio/pcm' },
      });
      const d = res.data;
      const replyText = d.turn?.personaTurn?.text ?? d.replyText ?? '';
      const arousal = d.turn?.personaTurn?.emotion?.arousal ?? d.emotion?.arousal;
      console.debug('[voice] HTTP voice-turn 完成', {
        说话人: persona?.name,
        audioFormat: d.audioFormat,
        有服务端音频: !!d.audioBase64,
      });
      dispatch({
        type: 'appendTurns',
        turns: [
          d.turn?.traineeTurn ?? { speaker: 'trainee', text: d.userText ?? '' },
          d.turn?.personaTurn ?? { speaker: 'persona', text: replyText },
        ],
        remainingSeconds: d.turn?.remainingSeconds,
      });
      if (d.audioBase64) {
        playHttpAudio(d.audioBase64, d.audioFormat ?? 'wav', replyText, arousal);
      } else {
        // 服务端音频缺失：浏览器 TTS 兜底
        setVoiceStatus('idle');
        if (voiceOnRef.current && replyText) speakPersona(replyText, arousal);
      }
    } catch {
      dispatch({ type: 'sendError' });
      setVoiceStatus('idle');
      window.alert('语音发送失败，请重试');
    }
  };

  /** 一期返回音频播放；播放失败时回退浏览器 TTS */
  const playHttpAudio = (base64: string, format: string, fallbackText: string, arousal?: number) => {
    const el = new Audio(`data:audio/${format};base64,${base64}`);
    httpAudioRef.current = el;
    setVoiceStatus('playing');
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      httpAudioRef.current = null;
      setVoiceStatus((s) => (s === 'playing' ? 'idle' : s));
      if (!ok && voiceOnRef.current && fallbackText) speakPersona(fallbackText, arousal);
    };
    el.onended = () => done(true);
    el.onerror = () => done(false);
    void el.play().catch(() => done(false));
  };

  /** 打断播报：二期发 interrupt + 本地停播；一期直接停掉 Audio；浏览器 TTS 一并停 */
  const interruptPlayback = () => {
    streamRef.current?.interrupt();
    callRef.current?.interrupt();
    if (httpAudioRef.current) {
      httpAudioRef.current.pause();
      httpAudioRef.current = null;
    }
    stopSpeaking();
    setVoiceStatus((s) => (s === 'playing' ? 'idle' : s));
  };

  // ---------- 语音通话（三期全双工） ----------

  /** 懒建立通话 WS 连接 */
  const getCallClient = (sid: string): Promise<void> => {
    if (callRef.current?.connected) return Promise.resolve();
    if (callConnectingRef.current) return callConnectingRef.current;
    const client = new VoiceCallClient({
      onStatusChange: (s) => setCallStatus(s),
      onPartial: (t) => setPartialText(t),
      onFinal: (t) => {
        setPartialText('');
        roundRef.current.userAppended = true;
        dispatch({ type: 'appendTurns', turns: [{ speaker: 'trainee', text: t }] });
      },
      onReplyText: (t) => {
        roundRef.current.replyText = t;
        setStreamingReply(t);
      },
      onTurnComplete: (turn, _emotion) => {
        setStreamingReply(null);
        const replyText = turn?.personaTurn?.text ?? roundRef.current.replyText;
        const turns: VoiceTurnInput[] = [];
        if (!roundRef.current.userAppended && turn?.traineeTurn) turns.push(turn.traineeTurn);
        turns.push(turn?.personaTurn ?? { speaker: 'persona', text: replyText });
        dispatch({ type: 'appendTurns', turns, remainingSeconds: turn?.remainingSeconds });
      },
      onError: (message) => {
        dispatch({ type: 'sendError' });
        setStreamingReply(null);
        setPartialText('');
        window.alert(message || '语音通话异常');
      },
      onClose: () => {
        dispatch({ type: 'sendError' });
        callRef.current = null;
        callConnectingRef.current = null;
        setStreamingReply(null);
        setPartialText('');
        setCallStatus('idle');
        client.close(); // 释放 AudioContext 等资源（close 幂等）
      },
    });
    const p = client
      .connect(buildVoiceCallWsUrl(sid, getToken()))
      .then(() => {
        callRef.current = client;
      })
      .catch((err: unknown) => {
        callConnectingRef.current = null;
        throw err;
      });
    callConnectingRef.current = p;
    return p;
  };

  /** 开始语音通话 */
  const startVoiceCall = async () => {
    if (!session) return;
    console.log(`[Session] 开始建立语音通话 sessionId=${session.id}`);
    try {
      await getCallClient(session.id);
      console.log('[Session] WebSocket 已连接，请求麦克风并发送 start…');
      await callRef.current!.startCall();
      console.log('[Session] 语音通话已启动');
    } catch (err) {
      console.error(
        '[Session] 语音通话启动失败：',
        err instanceof Error ? err.message : err,
        '\n常见原因：① 反向代理未透传 WebSocket Upgrade 头（看上方 WS 关闭 code：1006/4401，服务端应有「鉴权失败：返回 401」日志）' +
          '② 麦克风权限被拒或页面非 https/localhost（看上方「麦克风获取失败」日志）③ 服务未启动'
      );
      callRef.current = null;
      callConnectingRef.current = null;
      window.alert('无法建立语音通话，请改用语音消息或文字输入');
      setInputMode('voice');
    }
  };

  /** 结束语音通话 */
  const stopVoiceCall = () => {
    callRef.current?.stopCall();
    setPartialText('');
    setStreamingReply(null);
  };

  // 右上角 ×：二次确认后退出，不生成复盘
  const exitSession = () => {
    if (ending) return;
    if (!window.confirm('确定退出本次对练吗？退出后本次记录将不会保存。')) return;
    navigate('/tasks');
  };

  /** 停止整场录像并上传（含抽帧）；失败仅告警不阻断结束流程 */
  const uploadVideo = async () => {
    const recorder = videoRecorderRef.current;
    if (!recorder || !session) return;
    videoRecorderRef.current = null;
    setVideoStatus('idle');
    try {
      const blob = await recorder.stop();
      const frames = await extractFrames(blob, 10);
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      form.append('video', blob, `session.${ext}`);
      frames.forEach((f, i) => form.append(`frame_${i}`, f.blob, `frame_${i}.jpg`));
      form.append('frameAtMs', JSON.stringify(frames.map((f) => f.atMs)));
      await api.post(`/sessions/${session.id}/video`, form);
    } catch (err) {
      console.warn('[video] 录像上传失败（不影响复盘）', err);
    }
  };

  const endSession = async () => {
    if (ending) return;
    if (!window.confirm('确定结束本次练习吗？结束后将生成复盘报告。')) return;
    if (!session) {
      navigate('/tasks');
      return;
    }
    // 结束前先挂断语音通话
    stopVoiceCall();
    setEnding(true);
    const startedAt = Date.now();
    console.log(`[Session] 结束会话流程开始 sessionId=${session.id}`);
    try {
      // 先传录像（含评分用关键帧），再结束会话：保证评分时视频已落库
      const uploadStart = Date.now();
      await uploadVideo();
      console.log(`[Session] 录像上传完成（或无录像跳过） 耗时=${Date.now() - uploadStart}ms`);
      // 后端 /end 内逐评分项串行调用双 judge LLM，耗时与评分项数成正比
      console.log(`[Session] POST /sessions/${session.id}/end 开始（后端评分中）`);
      const endStart = Date.now();
      const res = await api.post<{ skippedReport?: boolean }>(`/sessions/${session.id}/end`);
      console.log(
        `[Session] POST /end 成功 耗时=${Date.now() - endStart}ms skippedReport=${!!res.data.skippedReport}`
      );
      // 对话太少或时间太短，后端跳过了报告生成
      if (res.data.skippedReport) {
        navigate('/tasks', { replace: true });
        return;
      }
      navigate(`/session/${session.id}/review`);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      console.error(
        `[Session] 结束会话失败 总耗时=${Date.now() - startedAt}ms status=${e.response?.status}`,
        e.response?.data ?? e.message ?? err
      );
      window.alert('结束失败，请重试');
      setEnding(false);
    }
  };

  // 会话尚未就绪（刷新恢复中 / 恢复失败）
  if (!session) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 bg-[#17191F] px-6 text-white lg:max-w-3xl">
        {loadError ? (
          <>
            <p className="text-sm text-[#9db2c0]">会话加载失败，可能已结束或不存在</p>
            <button
              className="rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-bold text-[#17191F]"
              onClick={() => navigate('/tasks')}
            >
              返回任务列表
            </button>
          </>
        ) : (
          <p className="text-sm text-[#9db2c0]">正在恢复对练…</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#17191F] text-white lg:max-w-3xl">
      {/* 考核模式常驻横幅 */}
      {mode === 'exam' && (
        <div className="bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white">
          考核中 · 本次成绩将上报
        </div>
      )}
      {/* 顶部状态条：退出 / 倒计时 / 模式 */}
      <div className="flex items-center justify-between px-4 pt-4">
        <button
          className="flex h-9 w-9 items-center justify-center text-[#9db2c0]"
          onClick={exitSession}
          aria-label="退出对练"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium ${
            state.remainingSeconds < 120
              ? 'animate-pulse bg-orange-500 text-[#17191F]'
              : 'bg-[#2a3d4f]'
          }`}
        >
          <svg
            className={`h-4 w-4 ${state.remainingSeconds < 120 ? 'text-[#17191F]' : 'text-orange-500'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          剩余 {formatTime(state.remainingSeconds)}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#2a3d4f] px-3.5 py-1.5 text-sm font-medium text-orange-500">
            {mode === 'practice' ? '练习模式' : '考核模式'}
          </span>
          {SessionVideoRecorder.supported() && (
            <button
              onClick={() => setVideoOn(!videoOn)}
              className={`relative flex h-9 w-9 items-center justify-center rounded-full ${
                videoOn ? 'text-orange-500' : 'text-[#5a7080]'
              }`}
              aria-label={videoOn ? '关闭正面录像' : '开启正面录像'}
              title={
                videoStatus === 'denied'
                  ? '摄像头不可用或未授权，本次对练不录像'
                  : videoOn
                    ? '关闭正面录像'
                    : '开启正面录像'
              }
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                {videoOn ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.9L15 14M5 6h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"
                  />
                ) : (
                  <>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.9L15 14M5 6h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
                  </>
                )}
              </svg>
              {videoStatus === 'recording' && (
                <span className="absolute right-0.5 top-0.5 h-2 w-2 animate-pulse rounded-full bg-red-500" />
              )}
            </button>
          )}
          {ttsSupported() && (
            <button
              onClick={() => setVoiceOn(!voiceOn)}
              className={`flex h-9 w-9 items-center justify-center rounded-full ${
                voiceOn ? 'text-orange-500' : 'text-[#5a7080]'
              }`}
              aria-label={voiceOn ? '关闭陪练员语音' : '开启陪练员语音'}
              title={voiceOn ? '关闭陪练员语音' : '开启陪练员语音'}
            >
              {voiceOn ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H3v6h3l5 4V5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H3v6h3l5 4V5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M22 9l-6 6M16 9l6 6" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* 顶部陪练员卡 */}
      <header className="px-5 pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xl font-bold text-[#17191F]">
            {persona?.name.charAt(0) ?? '客'}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">{persona?.name ?? '客户'}</p>
            {persona?.occupation && (
              <p className="mt-0.5 text-sm text-[#9db2c0]">{persona.occupation}</p>
            )}
          </div>
        </div>
        {persona?.background && (
          <p className="mt-3 text-sm leading-relaxed text-[#9db2c0]">{persona.background}</p>
        )}
      </header>

      {/* 对话区 */}
      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
        {/* 正面录像实时预览小窗（仅录制中展示，静音防回声） */}
        {videoStatus === 'recording' && (
          <video
            ref={videoPreviewRef}
            autoPlay
            muted
            playsInline
            className="fixed bottom-28 right-4 z-10 w-28 rounded-xl border border-white/20 shadow-lg"
            aria-label="正面录像预览"
          />
        )}
        {state.turns.map((turn) => {
          if (turn.speaker === 'coach' || turn.isHint) {
            return (
              <div key={turn.seq} className="flex justify-center">
                <div className="max-w-[85%] rounded-2xl border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-sm text-orange-400 lg:max-w-[70%]">
                  <span className="mb-1 block text-xs font-medium">教练提示</span>
                  {turn.text}
                </div>
              </div>
            );
          }
          const isTrainee = turn.speaker === 'trainee';
          return (
            <div key={turn.seq} className={`flex ${isTrainee ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed lg:max-w-[70%] ${
                  isTrainee
                    ? 'bg-orange-500 text-[#17191F]'
                    : 'bg-[#2a4152] text-white'
                }`}
              >
                {turn.text}
              </div>
            </div>
          );
        })}
        {/* 二期流式：persona 回复全文先以临时气泡展示，turn_complete 后落进消息列表 */}
        {streamingReply && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl bg-[#2a4152] px-4 py-3 text-[15px] leading-relaxed text-white lg:max-w-[70%]">
              {streamingReply}
            </div>
          </div>
        )}
        {state.sending && !streamingReply && (
          <p className="pt-2 text-center text-xs text-[#7e93a3]">
            {voiceStatus === 'idle' ? '客户正在说话…' : '识别中，请稍候…'}
          </p>
        )}
        <div ref={bottomRef} />
      </main>

      {/* 底部操作区 */}
      <footer className="border-t border-white/5 px-5 pb-6 pt-4">
        <div className="flex items-center justify-between">
          {mode !== 'exam' ? (
            <button
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm ${
                state.hintsRemaining > 0
                  ? 'bg-[#2a3d4f] text-[#c7d4dd]'
                  : 'bg-[#2a3d4f]/50 text-[#7e93a3]'
              }`}
              onClick={requestHint}
              disabled={state.hintsRemaining <= 0 || state.sending}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m5-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              暂停求提示（{state.hintsRemaining}/3）
            </button>
          ) : (
            <span />
          )}
        </div>

        {/* 输入模式切换：文字 / 语音消息 / 语音通话 */}
        <div className="mt-3 flex justify-center gap-2">
          <button
            className={`rounded-full px-3.5 py-1.5 text-xs ${
              inputMode === 'text' ? 'bg-orange-500 text-[#17191F]' : 'bg-[#2a3d4f] text-[#9db2c0]'
            }`}
            onClick={() => { setInputMode('text'); if (callStatus !== 'idle') stopVoiceCall(); }}
          >
            文字
          </button>
          <button
            className={`rounded-full px-3.5 py-1.5 text-xs ${
              inputMode === 'voice' ? 'bg-orange-500 text-[#17191F]' : 'bg-[#2a3d4f] text-[#9db2c0]'
            }`}
            onClick={() => { setInputMode('voice'); if (callStatus !== 'idle') stopVoiceCall(); }}
          >
            语音消息
          </button>
          <button
            className={`rounded-full px-3.5 py-1.5 text-xs ${
              inputMode === 'call' ? 'bg-orange-500 text-[#17191F]' : 'bg-[#2a3d4f] text-[#9db2c0]'
            }`}
            onClick={() => setInputMode('call')}
          >
            语音通话
          </button>
        </div>

        {inputMode === 'text' ? (
          <div className="mt-4 flex items-center gap-2">
            <input
              className="h-12 min-w-0 flex-1 rounded-full border border-[#33505f] bg-[#22394a] px-4 text-sm text-white placeholder-[#7e93a3] focus:border-orange-500 focus:outline-none"
              placeholder="输入你的回复…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
            />
            <button
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[#17191F] transition active:scale-95 disabled:opacity-50"
              onClick={send}
              disabled={state.sending || !input.trim()}
              aria-label="发送"
            >
              {state.sending ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#17191F]/30 border-t-[#17191F]" />
              ) : (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                </svg>
              )}
            </button>
          </div>
        ) : inputMode === 'voice' ? (
          <>
            <div className="mt-5 flex items-center justify-center gap-4">
              <button
                className={`flex h-16 w-16 touch-none items-center justify-center rounded-full transition active:scale-95 disabled:opacity-50 ${
                  voiceStatus === 'recording'
                    ? 'animate-pulse bg-red-500 text-white'
                    : 'bg-orange-500 text-[#17191F]'
                }`}
                onPointerDown={startVoicePress}
                onPointerUp={endVoicePress}
                onPointerLeave={endVoicePress}
                onPointerCancel={endVoicePress}
                onContextMenu={(e) => e.preventDefault()}
                disabled={ending || (state.sending && voiceStatus === 'idle')}
                aria-label="按住说话"
              >
                {voiceStatus === 'waiting' ? (
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#17191F]/30 border-t-[#17191F]" />
                ) : (
                  <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V6a3 3 0 016 0v5a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>
              {voiceStatus === 'playing' && (
                <button
                  className="rounded-full border border-red-400/60 px-4 py-2 text-sm text-red-400 transition active:scale-95"
                  onClick={interruptPlayback}
                >
                  打断
                </button>
              )}
            </div>
            {/* ASR 实时识别文本 */}
            {voiceStatus === 'recording' && partialText && (
              <p className="mt-3 text-center text-sm text-[#c7d4dd]">{partialText}</p>
            )}
            <p className="mt-3 text-center text-xs text-[#7e93a3]">
              {voiceStatus === 'recording' && !partialText && '正在聆听 · 松开结束（短按可保持）'}
              {voiceStatus === 'waiting' && '识别中，请稍候…'}
              {voiceStatus === 'playing' && '对方说话中 · 可点击打断'}
              {voiceStatus === 'idle' && '按住说话 · 也支持点按开始/结束'}
            </p>
          </>
        ) : (
          // 语音通话模式（三期全双工）
          <>
            <div className="mt-5 flex items-center justify-center gap-4">
              {callStatus === 'idle' ? (
                <button
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-500 text-[#17191F] transition active:scale-95 disabled:opacity-50"
                  onClick={startVoiceCall}
                  disabled={ending || state.sending}
                  aria-label="开始语音通话"
                >
                  <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </button>
              ) : (
                <button
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white transition active:scale-95"
                  onClick={stopVoiceCall}
                  aria-label="结束语音通话"
                >
                  <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.92-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 01-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.42 2.42c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 00-2.66-1.85.996.996 0 01-.56-.92v-3.1C15.15 9.25 13.6 9 12 9z" />
                  </svg>
                </button>
              )}
            </div>
            {/* ASR 实时识别文本 */}
            {callStatus === 'listening' && partialText && (
              <p className="mt-3 text-center text-sm text-[#c7d4dd]">{partialText}</p>
            )}
            <p className="mt-3 text-center text-xs text-[#7e93a3]">
              {callStatus === 'idle' && '点击按钮开始语音通话'}
              {callStatus === 'connecting' && '正在连接…'}
              {callStatus === 'listening' && !partialText && '正在聆听 · 直接说话即可'}
              {callStatus === 'processing' && '识别中，请稍候…'}
              {callStatus === 'speaking' && '对方说话中 · 可直接开口打断'}
            </p>
          </>
        )}

        <button
          className="mt-4 w-full rounded-xl border border-[#33505f] py-3 text-sm font-medium text-[#c7d4dd] transition active:scale-[0.99] disabled:opacity-50"
          onClick={endSession}
          disabled={ending}
        >
          {ending ? '正在生成复盘…' : '结束本次对练 → 进入复盘'}
        </button>
      </footer>

      {/* 教练考题弹窗 */}
      {pendingQuiz && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">教练提问</span>
              {pendingQuiz.required && <span className="text-xs text-rose-500">必答</span>}
              <span className="ml-auto text-xs text-slate-400">{pendingQuiz.score} 分</span>
            </div>
            <p className="mb-4 text-base font-semibold text-slate-800">{pendingQuiz.prompt}</p>

            {!quizResult && (
              <>
                {pendingQuiz.options?.map((opt) => (
                  <button
                    key={opt.id}
                    className={`mb-2 w-full rounded-lg border px-4 py-2.5 text-left text-sm transition ${
                      quizAnswer.includes(opt.id)
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                    onClick={() => {
                      if (pendingQuiz.type === 'single_choice' || pendingQuiz.type === 'true_false') {
                        setQuizAnswer([opt.id]);
                      } else {
                        setQuizAnswer((prev) =>
                          prev.includes(opt.id) ? prev.filter((a) => a !== opt.id) : [...prev, opt.id]
                        );
                      }
                    }}
                  >
                    {opt.label}
                  </button>
                ))}

                {(pendingQuiz.type === 'short_answer' || pendingQuiz.type === 'scenario_pick') && (
                  <textarea
                    className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    rows={3}
                    placeholder="请输入你的回答…"
                    value={quizAnswer.join('')}
                    onChange={(e) => setQuizAnswer(e.target.value ? [e.target.value] : [])}
                  />
                )}

                <div className="flex gap-3">
                  <button
                    className="flex-1 rounded-lg bg-[#0d5e63] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    onClick={submitQuiz}
                    disabled={quizSubmitting || (pendingQuiz.required && quizAnswer.length === 0)}
                  >
                    {quizSubmitting ? '提交中…' : '提交答案'}
                  </button>
                  {!pendingQuiz.required && (
                    <button
                      className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-500"
                      onClick={closeQuiz}
                    >
                      跳过
                    </button>
                  )}
                </div>
              </>
            )}

            {quizResult && (
              <div className="mt-2">
                <div className={`mb-3 rounded-lg px-4 py-3 ${quizResult.correct ? 'bg-green-50' : 'bg-red-50'}`}>
                  <p className={`text-base font-bold ${quizResult.correct ? 'text-green-600' : 'text-red-600'}`}>
                    {quizResult.correct ? '✓ 回答正确' : '✗ 回答错误'}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">得分：{quizResult.score} 分</p>
                </div>
                <div className="mb-3 rounded-lg bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-400">解析</p>
                  <p className="mt-1 text-sm text-slate-700">{quizResult.explanation}</p>
                </div>
                <button
                  className="w-full rounded-lg bg-[#0d5e63] py-2.5 text-sm font-semibold text-white"
                  onClick={closeQuiz}
                >
                  继续对练
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
