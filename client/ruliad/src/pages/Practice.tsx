import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import {
  fetchSession,
  sendTurn,
  requestHint,
  endSession,
  pauseSession,
  resumeSession,
  fetchOpening,
  apiError,
  getStoredUser,
  voiceWsUrl,
} from '../api';
import { PcmRecorder, TtsPlayer, VoiceSocket, type VoiceServerEvent } from '../voice';
import type { TranscriptTurn } from '../types';

type PracticeStatus =
  | 'loading'
  | 'user_turn'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'time_up'
  | 'evaluating'
  | 'ended'
  | 'failed';

/** 开场阶段：启动动画 → 教练开场白 → 等待就绪 → 正式对练 */
type Phase = 'boot' | 'coach' | 'ready_wait' | 'live';

interface PersonaInfo {
  name: string;
  age?: number;
  occupation?: string;
  background: string;
  avatar?: string;
}

interface ScenarioInfo {
  name: string;
  durationMinutes: number;
}

const MAX_HINTS = 3;
const AUTO_MIC_KEY = 'grasp-auto-mic';
/** 启动动画时长 */
const BOOT_MS = 1800;
/** 开场白音频被浏览器自动播放策略拦截时，推进到下一步的兜底时长 */
const COACH_FALLBACK_MS = 8000;
const PERSONA_FALLBACK_MS = 10000;

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function Practice() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isVoice = searchParams.get('mode') === 'voice';

  const [status, setStatus] = useState<PracticeStatus>('loading');
  const [phase, setPhase] = useState<Phase>('boot');
  const [loaded, setLoaded] = useState(false);
  const [persona, setPersona] = useState<PersonaInfo | null>(null);
  const [scenario, setScenario] = useState<ScenarioInfo | null>(null);
  const [sessionMode, setSessionMode] = useState<'practice' | 'exam'>('practice');
  const [messages, setMessages] = useState<TranscriptTurn[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [timeUp, setTimeUp] = useState(false);
  const [bandKey, setBandKey] = useState<string | null>(null);
  const [hintsRemaining, setHintsRemaining] = useState(MAX_HINTS);
  const [hintLoading, setHintLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [textInput, setTextInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [partialText, setPartialText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [wsReady, setWsReady] = useState(false);
  const [coachText, setCoachText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoMic, setAutoMic] = useState(() => localStorage.getItem(AUTO_MIC_KEY) !== '0');

  const statusRef = useRef<PracticeStatus>('loading');
  const phaseRef = useRef<Phase>('boot');
  const timeUpRef = useRef(false);
  const socketRef = useRef<VoiceSocket | null>(null);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const playerRef = useRef<TtsPlayer | null>(null);
  const intentionalCloseRef = useRef(false);
  const levelAtRef = useRef(0);
  const msgEndRef = useRef<HTMLDivElement | null>(null);
  /** 开场阶段正在播放的片段：coach = 教练开场白，persona = 对方开场白 */
  const introClipRef = useRef<'coach' | 'persona' | null>(null);
  const personaAudioRef = useRef<string | undefined>(undefined);
  const introTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 当前语音回合的音频是否已全部到达（收到 turn_complete）；全部播完才轮到用户 */
  const turnAudioDoneRef = useRef(true);

  const me = getStoredUser();

  const setStatusBoth = (s: PracticeStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const afterAiDone = () => {
    if (statusRef.current === 'paused') return;
    setStatusBoth(timeUpRef.current ? 'time_up' : 'user_turn');
  };

  const applyTurnMeta = (remainingSeconds: number | null | undefined, up?: boolean) => {
    if (typeof remainingSeconds === 'number') setRemaining(Math.max(0, remainingSeconds));
    if (up) {
      timeUpRef.current = true;
      setTimeUp(true);
    }
  };

  /** 教练开场白插入消息列表顶部（仅前端展示，不落 transcript） */
  const injectCoachMessage = (text: string) => {
    setMessages((prev) =>
      prev.some((m) => m.seq === 0 && m.speaker === 'coach')
        ? prev
        : [{ seq: 0, speaker: 'coach', text, at: new Date().toISOString() }, ...prev]
    );
  };

  // ===== 会话恢复 =====
  useEffect(() => {
    if (!sessionId || sessionId === 'new') return;
    let cancelled = false;
    fetchSession(sessionId)
      .then(({ session, persona: p, scenario: s, remainingSeconds }) => {
        if (cancelled) return;
        setPersona(p);
        setScenario(s);
        setSessionMode(session.mode);
        setMessages(session.transcript ?? []);
        setHintsRemaining(Math.max(0, MAX_HINTS - (session.hintsUsed ?? 0)));
        applyTurnMeta(remainingSeconds, remainingSeconds === 0);
        const lastEmotion = session.emotionTrace?.[session.emotionTrace.length - 1];
        if (lastEmotion?.bandKey) setBandKey(lastEmotion.bandKey);
        setLoaded(true);

        if (session.status !== 'active') {
          setPhaseBoth('live');
          setStatusBoth('ended');
        } else if (remainingSeconds === 0) {
          setPhaseBoth('live');
          setStatusBoth('time_up');
        } else if (session.pausedAt) {
          // 刷新恢复：会话处于暂停中
          setPhaseBoth('live');
          setStatusBoth('paused');
        } else {
          const hasTrainee = (session.transcript ?? []).some((t) => t.speaker === 'trainee');
          if (hasTrainee) {
            // 已有对练内容：跳过开场流程直接恢复
            setPhaseBoth('live');
            setStatusBoth('user_turn');
          } else if (session.coachOpening) {
            // 开场白已生成过（刷新于开场阶段）：直接到「是否准备好」
            setCoachText(session.coachOpening);
            injectCoachMessage(session.coachOpening);
            setPhaseBoth('ready_wait');
          } else {
            setPhaseBoth('boot');
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(apiError(err, '会话加载失败'));
        setStatusBoth('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // ===== 本地倒计时（暂停时冻结） =====
  const timerIdle =
    status === 'loading' || status === 'failed' || status === 'ended' || status === 'paused';
  useEffect(() => {
    if (timerIdle) return;
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          if (!timeUpRef.current) {
            timeUpRef.current = true;
            setTimeUp(true);
            setStatusBoth('time_up');
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timerIdle]);

  // ===== 语音通道：会话恢复后即建立（开场动画期间并行完成 ASR/AI 就绪） =====
  useEffect(() => {
    if (!isVoice || !sessionId || sessionId === 'new' || !loaded) return;

    const player = new TtsPlayer();
    player.onIdle = () => {
      if (introClipRef.current === 'coach') {
        introClipRef.current = null;
        if (introTimerRef.current) clearTimeout(introTimerRef.current);
        setPhaseBoth('ready_wait');
        return;
      }
      if (introClipRef.current === 'persona') introClipRef.current = null;
      // 回合音频未全部到达（turn_complete 未收到）时，解码/播放间隙的空闲不算数
      if (statusRef.current === 'speaking' && turnAudioDoneRef.current) afterAiDone();
    };
    playerRef.current = player;

    const recorder = new PcmRecorder();
    recorder.onChunk = (buf) => socketRef.current?.sendAudio(buf);
    recorder.onLevel = (rms) => {
      const now = Date.now();
      if (now - levelAtRef.current > 100) {
        levelAtRef.current = now;
        setMicLevel(Math.min(1, rms * 3));
      }
    };
    recorderRef.current = recorder;

    intentionalCloseRef.current = false;
    const socket = new VoiceSocket(voiceWsUrl(sessionId, 'voice'));
    socketRef.current = socket;
    socket.onOpen = () => setWsReady(true);
    socket.onEvent = handleVoiceEvent;
    socket.onClose = (code) => {
      setWsReady(false);
      if (intentionalCloseRef.current) return;
      if (code === 4401) {
        setErrorMsg('登录已过期，请重新登录');
        navigate('/login');
      } else {
        setErrorMsg('语音通道已断开，可切换到文字模式继续');
      }
    };
    socket.connect().catch(() => setErrorMsg('语音通道连接失败，可切换到文字模式继续'));

    return () => {
      intentionalCloseRef.current = true;
      socket.close();
      socketRef.current = null;
      recorder.stop();
      recorderRef.current = null;
      player.dispose();
      playerRef.current = null;
      setWsReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVoice, sessionId, loaded]);

  // ===== 启动动画 → 教练开场白 =====
  useEffect(() => {
    if (phase !== 'boot') return;
    const t = setTimeout(() => void beginCoach(), BOOT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const beginCoach = async () => {
    if (!sessionId || phaseRef.current !== 'boot') return;
    setPhaseBoth('coach');
    try {
      const res = await fetchOpening(sessionId, isVoice);
      setCoachText(res.coachText);
      personaAudioRef.current = res.personaAudio;
      injectCoachMessage(res.coachText);
      if (isVoice && res.coachAudio && playerRef.current) {
        introClipRef.current = 'coach';
        playerRef.current.enqueue(res.coachAudio);
        // 自动播放策略拦截音频时的兜底推进
        introTimerRef.current = setTimeout(() => {
          if (introClipRef.current === 'coach') {
            introClipRef.current = null;
            playerRef.current?.stopAll();
            setPhaseBoth('ready_wait');
          }
        }, COACH_FALLBACK_MS);
      } else {
        setPhaseBoth('ready_wait');
      }
    } catch (err) {
      setErrorMsg(apiError(err, '教练开场白加载失败'));
      setPhaseBoth('ready_wait');
    }
  };

  // 开场阶段用户任意点击：恢复可能被自动播放策略挂起的音频上下文
  useEffect(() => {
    if (phase !== 'boot' && phase !== 'coach') return;
    const resumeAudio = () => playerRef.current?.resume();
    window.addEventListener('pointerdown', resumeAudio);
    return () => window.removeEventListener('pointerdown', resumeAudio);
  }, [phase]);

  // ===== 点击「我准备好了」→ 正式开练 =====
  const handleReady = () => {
    setErrorMsg('');
    setPhaseBoth('live');
    if (isVoice && personaAudioRef.current && playerRef.current) {
      introClipRef.current = 'persona';
      // 开场白音频已全量拿到（单段），播完即轮到用户
      turnAudioDoneRef.current = true;
      setStatusBoth('speaking');
      playerRef.current.enqueue(personaAudioRef.current);
      introTimerRef.current = setTimeout(() => {
        if (introClipRef.current === 'persona') {
          introClipRef.current = null;
          playerRef.current?.stopAll();
          if (statusRef.current === 'speaking') afterAiDone();
        }
      }, PERSONA_FALLBACK_MS);
    } else {
      setStatusBoth(timeUpRef.current ? 'time_up' : 'user_turn');
    }
  };

  // ===== 消息列表自动滚到底部 =====
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, partialText]);

  // ===== 语音事件 =====
  const handleVoiceEvent = (ev: VoiceServerEvent) => {
    const paused = statusRef.current === 'paused';
    switch (ev.type) {
      case 'asr_partial':
        if (!paused && ev.text) setPartialText(ev.text);
        break;
      case 'asr_final':
        setPartialText('');
        if (ev.text) setReplyText(`我：${ev.text}`);
        break;
      case 'reply_text':
        // 新一轮回复的音频开始下发
        turnAudioDoneRef.current = false;
        if (ev.text) setReplyText(ev.text);
        if (!paused) setStatusBoth('speaking');
        break;
      case 'tts_sentence':
        if (!paused && ev.audio) playerRef.current?.enqueue(ev.audio);
        if (!paused) setStatusBoth('speaking');
        break;
      case 'tts_chunk':
        if (!paused && ev.audio && typeof ev.seq === 'number') {
          playerRef.current?.enqueueChunk(ev.seq, ev.audio, !!ev.isFinal);
        }
        break;
      case 'tts_cancelled':
        playerRef.current?.stopAll();
        break;
      case 'turn_complete': {
        setPartialText('');
        turnAudioDoneRef.current = true;
        const t = ev.turn;
        if (t) {
          const trainee: TranscriptTurn = { ...t.traineeTurn, speaker: 'trainee' };
          const personaTurn: TranscriptTurn = { ...t.personaTurn, speaker: 'persona' };
          setMessages((prev) => {
            const seqs = new Set(prev.map((m) => `${m.seq}:${m.speaker}`));
            const add = [trainee, personaTurn].filter((m) => !seqs.has(`${m.seq}:${m.speaker}`));
            return [...prev, ...add];
          });
          setReplyText(t.personaTurn.text);
          applyTurnMeta(t.remainingSeconds, t.timeUp);
        }
        if (ev.emotion?.bandKey) setBandKey(ev.emotion.bandKey);
        // 音频全部到达且播放器真正空闲（播完）才轮到用户；否则等 onIdle
        if (!playerRef.current?.busy) afterAiDone();
        break;
      }
      case 'error':
        turnAudioDoneRef.current = true;
        setErrorMsg(ev.message || '语音服务出错');
        if (statusRef.current === 'thinking' || statusRef.current === 'speaking') afterAiDone();
        break;
      default:
        break;
    }
  };

  // ===== 文字模式发送 =====
  const handleSendText = async () => {
    const text = textInput.trim();
    if (!text || !sessionId || statusRef.current !== 'user_turn') return;
    setTextInput('');
    setErrorMsg('');
    setStatusBoth('thinking');
    try {
      const res = await sendTurn(sessionId, text);
      setMessages((prev) => [...prev, res.traineeTurn, res.personaTurn]);
      setReplyText(res.personaTurn.text);
      if (res.bandKey) setBandKey(res.bandKey);
      applyTurnMeta(res.remainingSeconds, res.timeUp);
      setStatusBoth(res.timeUp ? 'time_up' : 'user_turn');
    } catch (err) {
      const statusCode = (err as { response?: { status?: number } })?.response?.status;
      if (statusCode === 409) {
        setErrorMsg('会话已结束');
        setStatusBoth('ended');
      } else {
        setErrorMsg(apiError(err));
        setStatusBoth('user_turn');
      }
    }
  };

  // ===== 开始录音（点击麦克风或轮到你时自动触发） =====
  const startRecording = async () => {
    const socket = socketRef.current;
    const recorder = recorderRef.current;
    if (!socket?.isOpen || !recorder) return;

    // AI 播报中开始录音 = 打断并开始新轮
    if (playerRef.current?.busy) {
      socket.send({ type: 'interrupt' });
      playerRef.current.stopAll();
    }
    turnAudioDoneRef.current = false;
    setErrorMsg('');
    setPartialText('');
    try {
      await recorder.start();
    } catch {
      setErrorMsg('麦克风不可用，请检查授权，或切换到文字模式');
      return;
    }
    socket.send({ type: 'start' });
    setIsRecording(true);
    setStatusBoth('user_turn');
  };

  // ===== 轮到你时自动开麦（语音模式，可在设置中关闭） =====
  useEffect(() => {
    if (!isVoice || phase !== 'live' || status !== 'user_turn' || timeUp) return;
    if (!wsReady || isRecording || !autoMic) return;
    if (playerRef.current?.busy) return; // 对方音频没播完，绝不抢麦
    void startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVoice, phase, status, timeUp, wsReady, isRecording, autoMic]);

  // ===== 语音模式：点击麦克风开始/结束一轮 =====
  const handleMicClick = async () => {
    if (!wsReady || statusRef.current === 'paused') return;
    const socket = socketRef.current;
    const recorder = recorderRef.current;
    if (!socket || !recorder) return;

    if (isRecording) {
      recorder.stop();
      turnAudioDoneRef.current = false;
      socket.send({ type: 'finish' });
      setIsRecording(false);
      setMicLevel(0);
      setStatusBoth('thinking');
      return;
    }

    if (statusRef.current !== 'user_turn' && statusRef.current !== 'speaking') return;
    await startRecording();
  };

  // ===== 暂停 / 继续 =====
  const handlePauseToggle = async () => {
    if (!sessionId) return;

    if (statusRef.current === 'paused') {
      try {
        const res = await resumeSession(sessionId);
        if (typeof res.remainingSeconds === 'number') setRemaining(Math.max(0, res.remainingSeconds));
        setStatusBoth(timeUpRef.current ? 'time_up' : 'user_turn');
      } catch (err) {
        setErrorMsg(apiError(err, '继续失败，请重试'));
      }
      return;
    }

    if (phaseRef.current !== 'live') return;
    if (['loading', 'failed', 'ended', 'evaluating', 'time_up'].includes(statusRef.current)) return;

    // 冻结本地一切收发：录音停止、ASR/TTS 轮次取消、播放器清空
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      setMicLevel(0);
    }
    socketRef.current?.send({ type: 'interrupt' });
    playerRef.current?.stopAll();
    setPartialText('');

    try {
      const res = await pauseSession(sessionId);
      if (typeof res.remainingSeconds === 'number') setRemaining(Math.max(0, res.remainingSeconds));
      setStatusBoth('paused');
    } catch (err) {
      setErrorMsg(apiError(err, '暂停失败，请重试'));
      setStatusBoth('user_turn');
    }
  };

  // ===== 教练提示 =====
  const handleHint = async () => {
    if (!sessionId || hintLoading || hintsRemaining <= 0) return;
    if (statusRef.current !== 'user_turn' && statusRef.current !== 'thinking' && statusRef.current !== 'speaking') return;
    setHintLoading(true);
    try {
      const res = await requestHint(sessionId);
      setMessages((prev) => [...prev, res.hintTurn]);
      setHintsRemaining(res.hintsRemaining);
    } catch (err) {
      const statusCode = (err as { response?: { status?: number } })?.response?.status;
      if (statusCode === 409) {
        setHintsRemaining(0);
        setErrorMsg('提示次数已用完');
      } else {
        setErrorMsg(apiError(err));
      }
    } finally {
      setHintLoading(false);
    }
  };

  // ===== 结束并评分 =====
  const handleStop = async () => {
    if (!sessionId || statusRef.current === 'evaluating') return;
    if (!confirm('确定结束本场练习并生成评分吗？')) return;
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
    }
    playerRef.current?.stopAll();
    setStatusBoth('evaluating');
    try {
      await endSession(sessionId);
      navigate(`/review/${sessionId}`);
    } catch (err) {
      setErrorMsg(apiError(err, '评分生成失败，请重试'));
      setStatusBoth('ended');
    }
  };

  const handleBack = () => {
    if (status !== 'ended' && status !== 'failed' && status !== 'evaluating') {
      if (!confirm('练习尚未结束，确定退出吗？')) return;
    }
    navigate('/home');
  };

  if (!sessionId || sessionId === 'new') {
    return <Navigate to="/home" replace />;
  }

  const personaName = persona?.name ?? '对方';
  const personaAvatar = persona?.avatar;
  const personaTags = [persona?.occupation, persona?.age ? `${persona.age} 岁` : null].filter(
    (t): t is string => !!t
  );
  const inLive = phase === 'live';
  const inputDisabled = !inLive || status !== 'user_turn' || timeUp;
  const canStop =
    inLive && status !== 'loading' && status !== 'failed' && status !== 'ended' && status !== 'evaluating';
  const canPause =
    inLive && !['loading', 'failed', 'ended', 'evaluating', 'time_up'].includes(status);
  const micDisabled =
    !inLive ||
    !wsReady ||
    timeUp ||
    status === 'thinking' ||
    status === 'paused' ||
    status === 'evaluating' ||
    status === 'ended' ||
    status === 'loading' ||
    status === 'failed';

  const personaAvatarEl = personaAvatar ? (
    <img src={personaAvatar} alt={personaName} />
  ) : (
    personaName.slice(0, 1)
  );
  const inIntro = phase === 'coach' || phase === 'ready_wait';

  return (
    <div className="min-h-screen bg-light-bg flex flex-col text-text-primary">
      {/* ===== PC 顶栏 ===== */}
      <header className="hidden md:flex h-[60px] items-center gap-3 px-5 border-b border-line bg-white shrink-0">
        <button onClick={handleBack} className="w-9 h-9 rounded-full bg-warm-bg flex items-center justify-center text-text-secondary hover:bg-line transition-colors" title="返回">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="font-bold text-[16px] truncate">{scenario?.name ?? '练习'}</span>
        <span className="chip chip-coral !text-[11.5px]">
          {status === 'paused' ? '已暂停' : '练习中'} · {isVoice ? '语音模式' : '文字模式'}
        </span>
        <div className="ml-auto flex items-center gap-1.5 font-din font-semibold text-[15px] tabular-nums">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-tertiary">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          剩余 {formatTime(remaining)}
        </div>
      </header>

      {/* ===== 手机标题栏 ===== */}
      <div className="mtopbar">
        <span className="back cursor-pointer" onClick={handleBack}>←</span>
        {scenario?.name ?? '练习'}
        <span className="right font-din">{formatTime(remaining)}</span>
      </div>

      {/* ===== 三栏布局 ===== */}
      <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 md:px-5 py-4 md:py-0">
        <div className="layout-practice">

          {/* ---- 左：参与者 ---- */}
          <aside className="side-l">
            <div className="card panel">
              <h3 style={{ marginBottom: '6px', fontSize: '15px', fontWeight: 700 }}>参与者</h3>
              <div className="p-item">
                <div className="avatar av5">我</div>
                <div><div className="nm">{me?.name ?? '我'}</div><div className="rl">你 · 销售方</div></div>
              </div>
              <div className="p-item">
                <div className="avatar av1">{personaAvatarEl}</div>
                <div>
                  <div className="nm">{personaName}</div>
                  <div className="rl">{persona?.occupation ?? '客户'} · AI 扮演</div>
                </div>
              </div>
              {personaTags.length > 0 && (
                <div className="p-tags">
                  {personaTags.map((t) => <span key={t}>{t}</span>)}
                </div>
              )}
              <div className="p-item">
                <div className="avatar av4">教</div>
                <div><div className="nm">AI 教练</div><div className="rl">实时提示与点评</div></div>
                <span className="obs">观察中</span>
              </div>
            </div>
          </aside>

          {/* 手机端目标条 */}
          <div className="card goal-m">🎯 {scenario?.name ?? '本场练习'} · 限时 {scenario?.durationMinutes ?? '-'} 分钟</div>

          {/* ---- 中：状态条 + 提示屏 + 字幕 + 消息 + 操作区 ---- */}
          <section className="chatcol">
            {/* 状态条 */}
            <div className="statuses">
              {phase === 'boot' && (
                <div className="statusbar statusbar-gray">正在初始化练习<span className="dots"><i /><i /><i /></span></div>
              )}
              {phase === 'coach' && (
                <div className="statusbar statusbar-blue">🎓 AI 教练正在介绍本场练习<span className="dots"><i /><i /><i /></span></div>
              )}
              {phase === 'ready_wait' && (
                <div className="statusbar statusbar-coral">
                  <span className="pulse-dot" />准备好了吗？点击「我准备好了」开始对练
                </div>
              )}
              {inLive && status === 'loading' && (
                <div className="statusbar statusbar-gray">正在恢复会话<span className="dots"><i /><i /><i /></span></div>
              )}
              {inLive && status === 'thinking' && (
                <div className="statusbar statusbar-blue">对方正在思考<span className="dots"><i /><i /><i /></span></div>
              )}
              {inLive && status === 'speaking' && (
                <div className="statusbar statusbar-blue">对方正在说话<span className="dots"><i /><i /><i /></span></div>
              )}
              {inLive && status === 'user_turn' && !timeUp && (
                <div className="statusbar statusbar-coral">
                  <span className="pulse-dot" />🎙 {isRecording ? '正在聆听，再点一次结束本轮' : '轮到你了'}
                  {isVoice && (
                    <span className="ml-auto shrink-0 text-[12px] font-medium opacity-75">
                      {wsReady ? '语音识别与 AI 已就绪' : '语音通道连接中…'}
                    </span>
                  )}
                </div>
              )}
              {inLive && status === 'paused' && (
                <div className="statusbar statusbar-gray">⏸ 已暂停，倒计时已冻结 — 点击下方 ▶ 继续</div>
              )}
              {inLive && timeUp && status !== 'evaluating' && status !== 'ended' && (
                <div className="statusbar statusbar-coral">⏰ 时间到，请点击右侧「结束并评分」查看结果</div>
              )}
              {status === 'ended' && (
                <div className="statusbar statusbar-gray">本场练习已结束</div>
              )}
              {status === 'failed' && (
                <div className="statusbar statusbar-coral">会话加载失败</div>
              )}
              {bandKey && inLive && status !== 'loading' && (
                <div className="statusbar statusbar-gray font-medium">
                  <span className="truncate">对方当前状态：{bandKey}</span>
                </div>
              )}
              {errorMsg && (
                <div className="statusbar statusbar-coral font-medium">
                  <span className="truncate">⚠ {errorMsg}</span>
                  <button onClick={() => setErrorMsg('')} className="ml-auto shrink-0 text-[13px]">收起 ×</button>
                </div>
              )}
            </div>

            {/* 深色提示屏 */}
            <div className="screen">
              <div className="tile">
                {inIntro ? (
                  <div className="avatar av4">教</div>
                ) : (
                  <div className="avatar av1">{personaAvatarEl}</div>
                )}
                <div className="who">
                  {inIntro ? (
                    <span>🎓 AI 教练</span>
                  ) : (
                    <>🎙<span>{personaName}{persona?.occupation ? ` · ${persona.occupation}` : ''}</span></>
                  )}
                </div>
              </div>

              <div className="text-[#F7F7FA]">
                {phase === 'boot' && (
                  <div className="flex flex-col items-center gap-4">
                    <div className="think5"><i /><i /><i /><i /><i /></div>
                    <div className="text-[13.5px] font-medium opacity-85">会话准备中…</div>
                  </div>
                )}
                {phase === 'coach' && (
                  <div className="flex flex-col items-center gap-4 px-6 max-w-[560px]">
                    <div className="flex items-end gap-[5px] h-9">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span key={i} className="w-[5px] rounded-full bg-white/85 animate-pulse" style={{ height: `${14 + (i % 3) * 9}px`, animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                    <div className="coach-opening">{coachText || '教练正在准备开场白…'}</div>
                  </div>
                )}
                {phase === 'ready_wait' && (
                  <div className="flex flex-col items-center gap-5 px-6 max-w-[560px]">
                    <div className="coach-opening">{coachText || '本场练习已就绪。'}</div>
                    <button className="ready-btn" onClick={handleReady}>▶ 我准备好了</button>
                  </div>
                )}
                {inLive && status === 'loading' && (
                  <div className="flex flex-col items-center gap-4">
                    <div className="think5"><i /><i /><i /><i /><i /></div>
                    <div className="text-[13.5px] font-medium opacity-85">会话恢复中…</div>
                  </div>
                )}
                {inLive && status === 'thinking' && (
                  <div className="flex flex-col items-center gap-4">
                    <div className="think5"><i /><i /><i /><i /><i /></div>
                  </div>
                )}
                {inLive && status === 'speaking' && (
                  <div className="flex items-end gap-[5px] h-9">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} className="w-[5px] rounded-full bg-white/85 animate-pulse" style={{ height: `${14 + (i % 3) * 9}px`, animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                )}
                {inLive && status === 'user_turn' && (
                  <div className="flex flex-col items-center gap-3">
                    {isRecording ? (
                      <div className="flex items-end gap-[5px] h-9">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            className="w-[5px] rounded-full bg-coral"
                            style={{ height: `${8 + Math.round(micLevel * 28 * (1 - Math.abs(i - 2) / 3))}px`, transition: 'height 100ms' }}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="pulse-dot !w-4 !h-4" />
                    )}
                    <div className="turn-banner">🎙 轮到你了</div>
                    <div className="text-[13px] font-medium opacity-75">
                      {isRecording
                        ? '正在聆听… 说完后点一次麦克风结束本轮'
                        : isVoice
                          ? wsReady
                            ? autoMic ? '即将自动开麦，也可以点击麦克风' : '点击麦克风开始说话'
                            : '语音通道连接中…'
                          : '请在下方输入你的回复'}
                    </div>
                  </div>
                )}
                {inLive && status === 'paused' && (
                  <div className="paused-banner">
                    <div className="paused-icon">⏸</div>
                    <div className="text-[15px] font-semibold">已暂停</div>
                    <div className="text-[12.5px] opacity-75">倒计时已冻结，点击 ▶ 继续练习</div>
                  </div>
                )}
                {inLive && (status === 'time_up' || status === 'ended' || status === 'failed') && (
                  <div className="text-[14px] font-semibold opacity-90">
                    {status === 'time_up' ? '⏰ 本场时间已到' : status === 'ended' ? '本场练习已结束' : '会话加载失败'}
                  </div>
                )}
                {status === 'evaluating' && (
                  <div className="flex flex-col items-center gap-4">
                    <div className="think5"><i /><i /><i /><i /><i /></div>
                    <div className="text-[13.5px] font-medium opacity-85">评估生成中，请稍候…</div>
                  </div>
                )}
              </div>

              <div className="timer">{formatTime(remaining)}</div>
              <div className="me-tag">{me?.name ?? '我'}（我）</div>
            </div>

            {/* 当前字幕行 */}
            {(partialText || replyText) && inLive && status !== 'loading' && (
              <div className="curline">
                {isRecording && partialText ? `我：${partialText}…` : replyText}
              </div>
            )}

            {/* 对话记录 */}
            {messages.length > 0 && (
              <div className="card" style={{ maxHeight: 240, overflowY: 'auto', padding: '4px 16px' }}>
                {messages.map((m) => (
                  <div key={`${m.seq}:${m.speaker}`} className={`msg ${m.speaker === 'trainee' ? 'msg-me' : ''}`}>
                    <div
                      className="bubble"
                      style={m.speaker === 'coach' ? { background: '#FFF7E6', borderColor: '#FFE1B3', maxWidth: '100%' } : undefined}
                    >
                      {m.text}
                      <div className="meta">
                        {m.speaker === 'trainee' ? '我' : m.speaker === 'persona' ? personaName : m.isHint ? '💡 教练提示' : '🎓 AI 教练'}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={msgEndRef} />
              </div>
            )}

            {/* 操作区 */}
            <div className="ops">
              <div className="row">
                {sessionMode === 'practice' && (
                  <button
                    className="rbtn"
                    onClick={handleHint}
                    disabled={!inLive || status === 'paused' || hintsRemaining <= 0 || hintLoading || status === 'loading' || status === 'ended' || status === 'evaluating'}
                    title={`教练提示（剩余 ${hintsRemaining} 次）`}
                  >
                    💡{hintsRemaining}
                  </button>
                )}
                {sessionMode === 'practice' && (
                  <button
                    className="rbtn"
                    onClick={handlePauseToggle}
                    disabled={!canPause && status !== 'paused'}
                    title={status === 'paused' ? '继续练习' : '暂停练习'}
                  >
                    {status === 'paused' ? '▶' : '⏸'}
                  </button>
                )}
                <button className="rbtn stop" onClick={handleStop} disabled={!canStop} title="结束并评分">⏹</button>
                <div className="settings-wrap">
                  <button className="rbtn" onClick={() => setSettingsOpen((v) => !v)} title="设置">⚙</button>
                  {settingsOpen && (
                    <>
                      <div className="settings-mask" onClick={() => setSettingsOpen(false)} />
                      <div className="settings-pop">
                        <div className="settings-pop-title">练习设置</div>
                        <button
                          className="settings-item"
                          onClick={() => {
                            setSettingsOpen(false);
                            setSearchParams({ mode: isVoice ? 'text' : 'voice' });
                          }}
                          disabled={status === 'loading' || status === 'evaluating' || isRecording}
                        >
                          {isVoice ? '⌨ 切换到文字模式' : '🎙 切换到语音模式'}
                        </button>
                        <label className="settings-item settings-check">
                          <input
                            type="checkbox"
                            checked={autoMic}
                            onChange={(e) => {
                              setAutoMic(e.target.checked);
                              localStorage.setItem(AUTO_MIC_KEY, e.target.checked ? '1' : '0');
                            }}
                          />
                          轮到我时自动开麦（语音模式）
                        </label>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* 语音模式：麦克风行 */}
              {isVoice && (
                <div className="microw">
                  <button
                    className={`mic ${isRecording ? 'mic-halo' : ''}`}
                    onClick={handleMicClick}
                    disabled={micDisabled}
                    title={isRecording ? '结束本轮' : '点击说话（AI 播报中点击可打断）'}
                  >
                    {isRecording ? '⏹' : '🎙'}
                  </button>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px' }}>
                      {status === 'paused' ? '已暂停' : isRecording ? '说话中… 再点一次结束本轮' : '点击麦克风说话'}
                    </div>
                    <div className="mic-hint">
                      {status === 'paused'
                        ? '点击 ▶ 继续练习'
                        : timeUp
                          ? '时间已到，请结束练习'
                          : autoMic
                            ? '轮到你时会自动开麦，AI 播报中点击可打断插话'
                            : 'AI 播报中点击麦克风可打断插话'}
                    </div>
                  </div>
                </div>
              )}

              {/* 文字模式：输入行 */}
              {!isVoice && (
                <div className="textin">
                  <input
                    className="input"
                    placeholder={status === 'paused' ? '已暂停' : timeUp ? '时间已到，请结束练习' : '输入你的回复…'}
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                    disabled={inputDisabled}
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleSendText} disabled={inputDisabled || !textInput.trim()}>
                    发送
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* ---- 右：场景信息与教练 ---- */}
          <aside className="side-r">
            <div className="card panel" style={{ marginBottom: 14 }}>
              <h3 style={{ marginBottom: '8px', fontSize: '15px', fontWeight: 700 }}>🎯 本场信息</h3>
              <ul className="goal">
                <li>{scenario?.name ?? '—'}</li>
                <li>限时 {scenario?.durationMinutes ?? '-'} 分钟 · {sessionMode === 'practice' ? '练习模式' : '考核模式'}</li>
                {bandKey && <li>对方状态：{bandKey}</li>}
              </ul>
            </div>
            {sessionMode === 'practice' && (
              <div className="card panel">
                <h3 style={{ marginBottom: '8px', fontSize: '15px', fontWeight: 700 }}>💡 教练提示</h3>
                <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '10px' }}>
                  卡住时可以向教练求助，本场剩余 {hintsRemaining} 次
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleHint}
                  disabled={!inLive || status === 'paused' || hintsRemaining <= 0 || hintLoading || status === 'loading' || status === 'ended' || status === 'evaluating'}
                >
                  {hintLoading ? '生成中…' : hintsRemaining > 0 ? `给我提示（剩 ${hintsRemaining} 次）` : '次数已用完'}
                </button>
              </div>
            )}
          </aside>
        </div>
      </main>

      {/* ===== 启动动画遮罩 ===== */}
      {phase === 'boot' && (
        <div className="boot-overlay">
          <div className="boot-card">
            <div className="boot-ring"><span>🎯</span></div>
            <div className="boot-title">{scenario?.name ?? '本场练习'}</div>
            <div className="boot-sub">
              正在为你准备对练<span className="dots"><i /><i /><i /></span>
            </div>
            <div className="boot-meta">
              {persona ? `${persona.name}${persona.occupation ? ` · ${persona.occupation}` : ''}` : ''}
              {scenario ? ` · 限时 ${scenario.durationMinutes} 分钟` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
