import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { fetchSession, endSession, requestHint, pauseSession, resumeSession, apiError, voiceWsUrl } from '../api';
import { PcmRecorder, TtsPlayer, VoiceSocket } from '../voice';
import type { VoiceServerEvent } from '../voice';
import QuizModal from '../components/QuizModal';
import type { QuizQuestion, SessionCreated, TranscriptTurn } from '../types';

type CallPhase = 'dialing' | 'ringing' | 'connected' | 'ended';
type LiveStatus = 'connecting' | 'listening' | 'recognizing' | 'thinking' | 'speaking';

const STATUS_LABEL: Record<LiveStatus, string> = {
  connecting: '连接中…',
  listening: '监听中',
  recognizing: '识别中…',
  thinking: '思考中…',
  speaking: '对方说话中',
};

interface SubtitleItem {
  speaker: 'me' | 'persona';
  text: string;
  atSec: number;
}

interface ReplayItem {
  time: string;
  name: string;
  text: string;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function Call() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');

  const [phase, setPhase] = useState<CallPhase>('dialing');
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [persona, setPersona] = useState<SessionCreated['persona'] | null>(null);
  const [scenarioName, setScenarioName] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(true);
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [partialText, setPartialText] = useState('');
  const [historyReplay, setHistoryReplay] = useState<ReplayItem[]>([]);
  const [micError, setMicError] = useState(false);
  const [micErrorMsg, setMicErrorMsg] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  /** 场景信息（目标/剧本，来自场景库配置） */
  const [scenarioInfo, setScenarioInfo] = useState<SessionCreated['scenario'] | null>(null);
  const [sessionMode, setSessionMode] = useState<'practice' | 'exam'>('practice');
  const [hintText, setHintText] = useState('');
  const [hintsLeft, setHintsLeft] = useState(0);
  const [hintLoading, setHintLoading] = useState(false);
  /** 随场考题队列（逐题弹窗作答） */
  const [quizQueue, setQuizQueue] = useState<QuizQuestion[]>([]);

  const socketRef = useRef<VoiceSocket | null>(null);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const playerRef = useRef<TtsPlayer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dialTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedRef = useRef(0);
  const mountedRef = useRef(true);
  const endedRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  /** 本场已选择「稍后再答」的考题 id（避免每轮重复弹出） */
  const dismissedQuizIdsRef = useRef<Set<string>>(new Set());

  const personaName = persona?.name ?? '对方';
  const personaAvatar = persona?.avatar ?? '/avatars/man-3.png';
  const personaRole = persona?.occupation ?? scenarioName ?? '';

  const toast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 4000);
  };

  // 加载会话信息；已结束的会话直接进入回放
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetchSession(sessionId)
      .then((res) => {
        if (cancelled) return;
        setPersona(res.persona);
        setScenarioName(res.scenario?.name ?? null);
        setScenarioInfo(res.scenario);
        setScenarioId(res.session.scenarioId);
        setSessionMode(res.session.mode);
        setHintsLeft(Math.max(0, 3 - (res.session.hintsUsed ?? 0)));
        setRemainingSeconds(res.remainingSeconds);
        if (res.session.status !== 'active') {
          endedRef.current = true;
          const startedAt = new Date(res.session.startedAt).getTime();
          const pName = res.persona?.name ?? '对方';
          setHistoryReplay(
            res.session.transcript
              .filter((t: TranscriptTurn) => t.speaker !== 'coach')
              .map((t: TranscriptTurn) => {
                const sec = Math.max(0, Math.floor((new Date(t.at).getTime() - startedAt) / 1000));
                return { time: formatTime(sec), name: t.speaker === 'trainee' ? '我' : pName, text: t.text };
              })
          );
          setPhase('ended');
        }
      })
      .catch((err) => toast(apiError(err)));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // 卸载清理（含 StrictMode 双挂载）：释放 WS / 采集 / 播放 / 定时器
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      intentionalCloseRef.current = true;
      socketRef.current?.close();
      recorderRef.current?.stop();
      playerRef.current?.dispose();
      if (dialTimeoutRef.current) clearTimeout(dialTimeoutRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // 通话计时
  useEffect(() => {
    if (phase === 'connected') {
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  const appendSubtitle = (speaker: 'me' | 'persona', text: string) => {
    setSubtitles((prev) => [...prev, { speaker, text, atSec: elapsedRef.current }]);
  };

  const teardownToEnded = (notifyServer: boolean) => {
    if (endedRef.current) return;
    endedRef.current = true;
    intentionalCloseRef.current = true;
    recorderRef.current?.stop();
    playerRef.current?.dispose();
    socketRef.current?.close();
    setPhase('ended');
    if (notifyServer && sessionId) {
      endSession(sessionId).catch((err) => toast(apiError(err, '结束会话失败')));
    }
  };

  const handleEvent = (ev: VoiceServerEvent) => {
    switch (ev.type) {
      case 'listening':
        setLiveStatus('listening');
        break;
      case 'asr_partial':
        setLiveStatus('recognizing');
        setPartialText(ev.text ?? '');
        break;
      case 'asr_final':
        setPartialText('');
        if (ev.text) appendSubtitle('me', ev.text);
        setLiveStatus('thinking');
        break;
      case 'reply_text':
        if (ev.text) appendSubtitle('persona', ev.text);
        setLiveStatus('speaking');
        break;
      case 'tts_chunk':
        if (ev.seq != null && ev.audio) {
          playerRef.current?.enqueueChunk(ev.seq, ev.audio, !!ev.isFinal);
        }
        setLiveStatus('speaking');
        break;
      case 'tts_cancelled':
        playerRef.current?.stopAll();
        break;
      case 'turn_complete':
        if (ev.turn) {
          setRemainingSeconds(ev.turn.remainingSeconds);
          if (ev.turn.timeUp) toast('本场练习时间已到，可挂断查看复盘报告');
          enqueueQuizzes(ev.turn.pendingQuizzes);
        }
        break;
      case 'stopped':
        // 服务端主动结束（如时间到自动收尾）
        teardownToEnded(false);
        break;
      case 'error':
        toast(ev.message ?? '语音服务出错');
        break;
      default:
        break;
    }
  };

  /** 收集本轮触发的考题：过滤已在队列与已跳过的，逐题弹窗 */
  const enqueueQuizzes = (quizzes?: QuizQuestion[]) => {
    if (!quizzes || quizzes.length === 0) return;
    setQuizQueue((prev) => {
      const known = new Set(prev.map((q) => q.id));
      const fresh = quizzes.filter((q) => !known.has(q.id) && !dismissedQuizIdsRef.current.has(q.id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  };

  const quizOpen = quizQueue.length > 0;

  /** 考题弹窗期间停止采集（服务端 VAD 只见静音，不会触发新回合） */
  useEffect(() => {
    if (quizOpen && phase === 'connected') recorderRef.current?.stop();
  }, [quizOpen, phase]);

  /** 关闭考题弹窗：恢复采集（若仍在通话且未手动静音/暂停） */
  const closeQuiz = (quiz: QuizQuestion, answered: boolean) => {
    if (!answered) dismissedQuizIdsRef.current.add(quiz.id);
    setQuizQueue((prev) => prev.filter((q) => q.id !== quiz.id));
    if (phase === 'connected' && !isMuted && !isPaused) void startRecorder();
  };

  /** 教练提示（仅 practice 模式，消耗本场提示次数） */
  const handleHint = async () => {
    if (!sessionId || hintLoading || hintsLeft <= 0) return;
    setHintLoading(true);
    try {
      const res = await requestHint(sessionId);
      setHintText(res.hintTurn.text);
      setHintsLeft(res.hintsRemaining);
    } catch (err) {
      toast(apiError(err, '提示生成失败'));
    } finally {
      setHintLoading(false);
    }
  };

  const startRecorder = async () => {
    if (!recorderRef.current) {
      const rec = new PcmRecorder();
      rec.onChunk = (buf) => socketRef.current?.sendAudio(buf);
      recorderRef.current = rec;
    }
    try {
      await recorderRef.current.start();
      setMicError(false);
      setMicErrorMsg('');
    } catch (err) {
      setMicError(true);
      setMicErrorMsg(err instanceof Error && err.message ? err.message : '麦克风不可用');
    }
  };

  const connectVoice = async () => {
    if (!sessionId || socketRef.current) return;
    const socket = new VoiceSocket(voiceWsUrl(sessionId, 'voice-call'));
    socketRef.current = socket;
    playerRef.current = new TtsPlayer();
    socket.onOpen = () => {
      if (!mountedRef.current || endedRef.current) {
        intentionalCloseRef.current = true;
        socket.close();
        return;
      }
      socket.send({ type: 'start' });
      setPhase('connected');
      setLiveStatus('listening');
      void startRecorder();
    };
    socket.onEvent = handleEvent;
    socket.onClose = (code) => {
      if (code === 4401) {
        navigate('/login');
        return;
      }
      if (!intentionalCloseRef.current && !endedRef.current) {
        toast('语音连接已断开');
        teardownToEnded(true);
      }
    };
    try {
      await socket.connect();
    } catch {
      intentionalCloseRef.current = true;
      socketRef.current = null;
      toast('语音通道连接失败，请重试');
      if (mountedRef.current) setPhase('dialing');
    }
  };

  const handleDial = () => {
    intentionalCloseRef.current = false;
    setPhase('ringing');
    dialTimeoutRef.current = setTimeout(() => void connectVoice(), 1500);
  };

  const handleCancelDial = () => {
    if (dialTimeoutRef.current) clearTimeout(dialTimeoutRef.current);
    intentionalCloseRef.current = true;
    socketRef.current?.close();
    socketRef.current = null;
    setPhase('dialing');
  };

  const handleEndCall = () => {
    socketRef.current?.send({ type: 'stop' });
    teardownToEnded(true);
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      void startRecorder();
      setIsMuted(false);
    } else {
      recorderRef.current?.stop();
      setIsMuted(true);
    }
  };

  /** 暂停：先通知服务端冻结计时，成功后停采集并暂停 TTS 播放；失败则保持原状 */
  const handlePause = async () => {
    if (!sessionId || isPaused) return;
    try {
      const res = await pauseSession(sessionId);
      if (typeof res.remainingSeconds === 'number') setRemainingSeconds(Math.max(0, res.remainingSeconds));
      recorderRef.current?.stop();
      playerRef.current?.pause();
      setIsPaused(true);
    } catch (err) {
      toast(apiError(err, '暂停失败，请重试'));
    }
  };

  /** 继续：先恢复服务端会话，成功后恢复播放与采集；失败则保持暂停状态 */
  const handleResume = async () => {
    if (!sessionId || !isPaused) return;
    try {
      const res = await resumeSession(sessionId);
      if (typeof res.remainingSeconds === 'number') setRemainingSeconds(Math.max(0, res.remainingSeconds));
      setIsPaused(false);
      if (isSpeaker) playerRef.current?.resumePlayback();
      if (!isMuted) void startRecorder();
    } catch (err) {
      toast(apiError(err, '继续失败，请重试'));
    }
  };

  /** 扬声器开关：关闭时暂停 TTS 播放（音频在本地排队不出声），开启后从队列恢复 */
  const handleSpeakerToggle = () => {
    if (isSpeaker) {
      playerRef.current?.pause();
      setIsSpeaker(false);
    } else {
      if (!isPaused) playerRef.current?.resumePlayback();
      setIsSpeaker(true);
    }
  };

  if (!sessionId) return <Navigate to="/home" replace />;

  const lastSubtitle = subtitles[subtitles.length - 1];
  const liveReplay: ReplayItem[] = subtitles.map((s) => ({
    time: formatTime(s.atSec),
    name: s.speaker === 'me' ? '我' : personaName,
    text: s.text,
  }));
  const replayItems = liveReplay.length > 0 ? liveReplay : historyReplay;

  return (
    <div className={phase === 'connected' ? 'md:!bg-[#17191F]' : ''}>
      {/* 手机顶部栏 */}
      <div className="md:hidden sticky top-0 z-50 h-[52px] flex items-center justify-center" style={{ background: 'rgba(23,25,31,.92)', color: '#F7F7FA', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
        <button onClick={() => navigate(-1)} className="absolute left-2 px-2.5 py-1.5 text-xl leading-none" style={{ color: '#F7F7FA' }}>←</button>
        语音通话
      </div>

      {phase === 'connected' && (
        <main className="py-0 md:py-7">
          <div className="call-wrap">
            {/* 通话卡 */}
            <div className="call-card live">
              <div className="st">
                <span className="dotg" />
                Graspit 练习通话 · 已接通 {formatTime(elapsed)}
                {remainingSeconds != null && ` · 剩余 ${formatTime(Math.max(0, remainingSeconds))}`}
              </div>
              <div className="ringbox">
                <span className="wave" />
                <span className="wave" />
                <div className="avatar av1"><img src={personaAvatar} alt={personaName} /></div>
              </div>
              <h2>{personaName}</h2>
              <div className="role">{personaRole}</div>
              <div className="mood">状态：{isPaused ? '已暂停' : STATUS_LABEL[liveStatus]}</div>
              {showSubtitle && (
                <div className="caption">
                  {partialText ? (
                    <>
                      <b>我 · 识别中</b>
                      {partialText}…
                    </>
                  ) : (
                    <>
                      <b>实时字幕 · {lastSubtitle ? (lastSubtitle.speaker === 'me' ? '我' : personaName) : personaName}</b>
                      {lastSubtitle ? lastSubtitle.text : '等待对方说话…'}
                    </>
                  )}
                </div>
              )}
              {micError && (
                <div style={{ background: 'rgba(255,107,91,.12)', border: '1px solid rgba(255,107,91,.45)', borderRadius: '10px', padding: '10px 12px', fontSize: '13px', color: '#FFB4A8', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span>需要麦克风权限才能进行语音通话。{micErrorMsg ? `（${micErrorMsg}）` : ''}</span>
                  <span style={{ display: 'flex', gap: '12px' }}>
                    <a style={{ color: '#FF6B5B', cursor: 'pointer', fontWeight: 600 }} onClick={() => void startRecorder()}>重试</a>
                    <a style={{ color: '#FF6B5B', cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate(`/practice/${sessionId}`)}>改用文字练习 →</a>
                  </span>
                </div>
              )}
              <div className="ctrl1">
                <button title="静音" onClick={handleMuteToggle} className={isMuted ? 'on' : ''}>{isMuted ? '🔇' : '🎙'}</button>
                <button title={isSpeaker ? '关闭扬声器' : '打开扬声器'} onClick={handleSpeakerToggle} className={isSpeaker ? 'on' : ''}>{isSpeaker ? '🔊' : '🔇'}</button>
                <button title="打断对方" onClick={() => socketRef.current?.send({ type: 'interrupt' })}>✋</button>
                <button title="字幕" onClick={() => setShowSubtitle(!showSubtitle)}>CC</button>
              </div>
              <div className="ctrl2">
                <button className="pause" title="暂停" onClick={handlePause}>⏸</button>
                <button className="hangup" title="挂断" onClick={handleEndCall}>📵</button>
                <button className="resume" title="继续" onClick={handleResume}>▶</button>
              </div>
              <div className="backlink">
                暂停后对方将保持通话 · <a style={{ color: '#FF6B5B', cursor: 'pointer' }} onClick={handleEndCall}>结束并查看回放 →</a>
              </div>
            </div>

            {/* PC 侧栏 */}
            <aside className="call-side">
              <div className="card panel">
                <h3 style={{ marginBottom: '8px', fontWeight: 700, fontSize: '15px' }}>🎯 本场目标</h3>
                <ul className="goal">
                  {(scenarioInfo?.coverageTopics?.length
                    ? scenarioInfo.coverageTopics
                    : [scenarioInfo?.script?.purpose ?? scenarioInfo?.name ?? '本场练习']
                  ).map((g) => <li key={g}>{g}</li>)}
                </ul>
              </div>
              {sessionMode === 'practice' && (
                <div className="card panel">
                  <h3 style={{ marginBottom: '8px', fontWeight: 700, fontSize: '15px' }}>💡 教练提示</h3>
                  {hintText ? (
                    <p className="small" style={{ marginBottom: 8 }}>{hintText}</p>
                  ) : (
                    <p className="small muted" style={{ marginBottom: 8 }}>卡住时可以向教练求助，本场剩余 {hintsLeft} 次</p>
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleHint}
                    disabled={hintLoading || hintsLeft <= 0 || phase !== 'connected'}
                  >
                    {hintLoading ? '生成中…' : hintsLeft > 0 ? `给我提示（剩 ${hintsLeft} 次）` : '次数已用完'}
                  </button>
                </div>
              )}
            </aside>
          </div>
        </main>
      )}

      {(phase === 'dialing' || phase === 'ringing') && (
        <main className="px-4 py-7">
          <div className="flex justify-center">
            <div className="call-card" style={{ width: 380, padding: 22, gap: 10 }}>
              <div className="st">📞 {phase === 'dialing' ? `准备呼叫 ${personaName}…` : `正在呼叫 ${personaName}…`}</div>
              <div className="ringbox" style={{ width: 110, height: 110 }}>
                <span className="wave" />
                <span className="wave" />
                <div className="avatar av1" style={{ width: 80, height: 80, fontSize: 30 }}><img src={personaAvatar} alt={personaName} /></div>
              </div>
              <div className="role">{phase === 'dialing' ? '点击下方按钮开始通话' : '拨号中，请稍候…'}</div>
              {phase === 'dialing' ? (
                <button onClick={handleDial} className="btn btn-ghost btn-sm" style={{ background: 'transparent', borderColor: 'rgba(255,255,255,.3)', color: '#F7F7FA' }}>📞 开始呼叫</button>
              ) : (
                <button onClick={handleCancelDial} className="btn btn-ghost btn-sm" style={{ background: 'transparent', borderColor: 'rgba(255,255,255,.3)', color: '#F7F7FA' }}>取消</button>
              )}
            </div>
          </div>
        </main>
      )}

      {phase === 'ended' && (
        <main className="px-4 py-7">
          <div style={{ maxWidth: 840, margin: '0 auto' }}>
            <h2 className="bar-title" style={{ marginBottom: 12 }}>通话回放</h2>
            <div className="card" style={{ padding: '8px 18px', marginBottom: 24 }}>
              {replayItems.length === 0 && (
                <div className="small muted" style={{ padding: '14px 0' }}>本通电话暂无字幕记录。</div>
              )}
              {replayItems.map((item, i) => (
                <div key={`${item.time}-${i}`} className="replay-item">
                  <span className="tm">{item.time}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: '13.5px' }}>{item.name}</b>
                    <div className="small muted">{item.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-center gap-3 pb-8">
              <button className="btn btn-ghost" onClick={() => navigate(scenarioId ? `/scenario/${scenarioId}` : '/home')}>再来一通</button>
              <button className="btn btn-primary" onClick={() => navigate(`/review/${sessionId}`)}>查看复盘报告 →</button>
            </div>
          </div>
        </main>
      )}

      {toastMsg && (
        <div style={{ position: 'fixed', left: '50%', bottom: '48px', transform: 'translateX(-50%)', background: 'rgba(23,25,31,.92)', color: '#F7F7FA', padding: '10px 18px', borderRadius: '999px', fontSize: '13.5px', zIndex: 100, boxShadow: '0 6px 24px rgba(0,0,0,.3)' }}>
          {toastMsg}
        </div>
      )}

      {/* 随场考题弹窗（对练中触发，逐题作答） */}
      {quizOpen && phase === 'connected' && (
        <QuizModal
          sessionId={sessionId}
          quiz={quizQueue[0]}
          onDone={() => closeQuiz(quizQueue[0], true)}
          onSkip={quizQueue[0].required ? undefined : () => closeQuiz(quizQueue[0], false)}
        />
      )}
    </div>
  );
}
