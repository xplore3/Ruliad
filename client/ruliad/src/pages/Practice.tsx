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
  markLiveStart,
  qualifyAnswer,
  fetchDemo,
  demoChoice,
  ttsClip,
  apiError,
  getStoredUser,
  voiceWsUrl,
  type DemoLine,
} from '../api';
import { PcmRecorder, TtsPlayer, VoiceSocket, type VoiceServerEvent } from '../voice';
import QuizModal from '../components/QuizModal';
import type { QuizQuestion, TranscriptTurn } from '../types';

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

/** 开场阶段：启动加载 → 等待就绪 →（地推新手：资格提问 → 示范对话）→ 正式对练 */
type Phase = 'boot' | 'ready_wait' | 'qualify' | 'guide' | 'live';

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
  coverageTopics?: string[];
}

const MAX_HINTS = 3;
const AUTO_MIC_KEY = 'grasp-auto-mic';
const PERSONA_FALLBACK_MS = 10000;

/** 地推引流课分类关键词（与 Home.tsx 的分类规则一致） */
const GROUND_PUSH_KEYWORDS = ['地推', '破冰', '陌生', '展会', '商场', '摊位', '驻足'];
/** 新手指引资格提问（教练语音提问，用户语音自由回答） */
const QUALIFY_QUESTIONS = ['你做过地推吗？', '你做过教育行业的地推吗？'];
/** 示范播完后教练的询问 */
const GUIDE_CHOICE_QUESTION = '想再听一个版本的示范，还是开始模拟练习？';
/** 新手指引自动聆听 VAD 参数（参考服务端 voice.ts 的 RMS + 静音判停思路） */
const VAD_RMS_THRESHOLD = 0.02;
const VAD_SILENCE_MS = 1300;
const VAD_MAX_RECORD_MS = 15000;
/** 自动聆听识别失败的重试上限，超过后给出文字提示 */
const GUIDANCE_MAX_RETRY = 2;

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoMic, setAutoMic] = useState(() => localStorage.getItem(AUTO_MIC_KEY) !== '0');

  // ===== 新手指引（地推引流课）状态 =====
  const [qualifyQ, setQualifyQ] = useState<1 | 2>(1);
  const [qualifyStage, setQualifyStage] = useState<'asking' | 'recording' | 'uploading' | 'error'>('asking');
  const [qualifyText, setQualifyText] = useState('');
  const [qualifyHint, setQualifyHint] = useState('');
  const [demoVersion, setDemoVersion] = useState(1);
  const [demoLines, setDemoLines] = useState<DemoLine[]>([]);
  /** 当前正在播放的示范台词下标（-1 = 无） */
  const [demoIndex, setDemoIndex] = useState(-1);
  const [demoStage, setDemoStage] = useState<'loading' | 'playing' | 'ask'>('loading');
  const [guideRec, setGuideRec] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [guideText, setGuideText] = useState('');
  const [guideHint, setGuideHint] = useState('');

  // ===== 随场考题（对练中触发，逐题弹窗作答） =====
  const [quizQueue, setQuizQueue] = useState<QuizQuestion[]>([]);

  const statusRef = useRef<PracticeStatus>('loading');
  const phaseRef = useRef<Phase>('boot');
  const timeUpRef = useRef(false);
  const socketRef = useRef<VoiceSocket | null>(null);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const playerRef = useRef<TtsPlayer | null>(null);
  const intentionalCloseRef = useRef(false);
  const levelAtRef = useRef(0);
  const msgEndRef = useRef<HTMLDivElement | null>(null);
  /** 开场阶段正在播放的片段：persona = 对方开场白 */
  const introClipRef = useRef<'persona' | null>(null);
  const personaAudioRef = useRef<string | undefined>(undefined);
  const introTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 当前语音回合的音频是否已全部到达（收到 turn_complete）；全部播完才轮到用户 */
  const turnAudioDoneRef = useRef(true);
  /** 新手指引专用录音器（独立于语音回合的 VoiceSocket 链路） */
  const guidanceRecRef = useRef<PcmRecorder | null>(null);
  /** 中断在途自动聆听（stopGuidanceMedia / 组件清理时调用） */
  const guidanceCancelRef = useRef<(() => void) | null>(null);
  /** 自动聆听最大时长兜底定时器 */
  const vadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 资格提问 / 示范选择的识别失败重试计数 */
  const qualifyRetryRef = useRef(0);
  const guideRetryRef = useRef(0);
  /** 新手指引专用 AudioContext（在「我准备好了」点击手势内创建/resume，规避自动播放限制） */
  const guideCtxRef = useRef<AudioContext | null>(null);
  /** 新手指引当前播放的音频源 */
  const guideSrcRef = useRef<AudioBufferSourceNode | null>(null);
  /** 播放代数：打断后丢弃在途解码结果 */
  const guidePlayGenRef = useRef(0);
  /** 示范播放代数：重播/进入练习时使在途播放循环失效 */
  const demoTokenRef = useRef(0);
  /** 本场已选择「稍后再答」的考题 id（避免每轮重复弹出） */
  const dismissedQuizIdsRef = useRef<Set<string>>(new Set());

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

  /** 收集本轮触发的考题：过滤已在队列与已跳过的，逐题弹窗 */
  const enqueueQuizzes = (quizzes?: QuizQuestion[]) => {
    if (!quizzes || quizzes.length === 0) return;
    setQuizQueue((prev) => {
      const known = new Set(prev.map((q) => q.id));
      const fresh = quizzes.filter((q) => !known.has(q.id) && !dismissedQuizIdsRef.current.has(q.id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  };

  const dismissQuiz = (quiz: QuizQuestion) => {
    dismissedQuizIdsRef.current.add(quiz.id);
    setQuizQueue((prev) => prev.filter((q) => q.id !== quiz.id));
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
        // 初始开场白（seq:1 的客户第一句话）不进对话记录，从用户的实际对练开始展示
        setMessages((session.transcript ?? []).filter((t) => !(t.seq === 1 && t.speaker === 'persona')));
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
            setPhaseBoth('ready_wait');
          } else {
            // 新会话：直接到「是否准备好」，开场数据后台加载
            void beginCoach();
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

  // ===== 本地倒计时（暂停与开场/指引阶段冻结） =====
  const timerIdle =
    phase !== 'live' ||
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
      if (introClipRef.current === 'persona') {
        introClipRef.current = null;
        if (introTimerRef.current) {
          clearTimeout(introTimerRef.current);
          introTimerRef.current = null;
        }
      }
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
      if (introTimerRef.current) {
        clearTimeout(introTimerRef.current);
        introTimerRef.current = null;
      }
      // 新手指引在途的录音/播放一并清理
      demoTokenRef.current += 1;
      guidePlayGenRef.current += 1;
      guidanceCancelRef.current?.();
      guidanceCancelRef.current = null;
      if (vadTimerRef.current) {
        clearTimeout(vadTimerRef.current);
        vadTimerRef.current = null;
      }
      guidanceRecRef.current?.stop();
      guidanceRecRef.current = null;
      if (guideSrcRef.current) {
        try { guideSrcRef.current.stop(); } catch { /* 已停止 */ }
        guideSrcRef.current = null;
      }
      void guideCtxRef.current?.close();
      guideCtxRef.current = null;
      setWsReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVoice, sessionId, loaded]);

  // ===== 开场数据后台加载，页面直接停在「我准备好了」 =====
  const beginCoach = async () => {
    if (!sessionId) return;
    setPhaseBoth('ready_wait');
    try {
      const res = await fetchOpening(sessionId, isVoice);
      personaAudioRef.current = res.personaAudio;
    } catch (err) {
      setErrorMsg(apiError(err, '教练开场白加载失败'));
    }
  };

  // 加载阶段用户任意点击：恢复可能被自动播放策略挂起的音频上下文
  useEffect(() => {
    if (phase !== 'boot') return;
    const resumeAudio = () => playerRef.current?.resume();
    window.addEventListener('pointerdown', resumeAudio);
    return () => window.removeEventListener('pointerdown', resumeAudio);
  }, [phase]);

  // 指引阶段用户任意点击：恢复 guidance AudioContext（双保险，正常已在「我准备好了」手势内激活）
  useEffect(() => {
    if (phase !== 'qualify' && phase !== 'guide') return;
    const resumeAudio = () => {
      if (guideCtxRef.current?.state === 'suspended') void guideCtxRef.current.resume();
    };
    window.addEventListener('pointerdown', resumeAudio);
    return () => window.removeEventListener('pointerdown', resumeAudio);
  }, [phase]);

  /**
   * 开场白看门狗：正常由播放器 onIdle 推进；仅在流程卡死（未暂停、播放器已空闲但状态没推进）
   * 时兜底推进。音频仍在播放/缓冲时只继续等待，绝不掐断在播音频。
   */
  const armIntroWatchdog = () => {
    if (introTimerRef.current) clearTimeout(introTimerRef.current);
    introTimerRef.current = setTimeout(() => {
      introTimerRef.current = null;
      if (introClipRef.current !== 'persona' || statusRef.current === 'paused') return;
      if (playerRef.current?.busy) {
        // 仍在播放/解码：尝试恢复被挂起的音频上下文，然后继续等播完
        playerRef.current.resume();
        armIntroWatchdog();
        return;
      }
      introClipRef.current = null;
      if (statusRef.current === 'speaking') afterAiDone();
    }, PERSONA_FALLBACK_MS);
  };

  // ===== 进入正式对练（原「我准备好了」的开场逻辑） =====
  const startLive = () => {
    stopGuidanceMedia();
    setPhaseBoth('live');
    // 通知服务端从此刻起倒计时（开场/新手指引不消耗时长）；失败时回退为按会话创建时间计时
    if (sessionId) {
      markLiveStart(sessionId)
        .then((res) => {
          if (typeof res.remainingSeconds === 'number') setRemaining(Math.max(0, res.remainingSeconds));
        })
        .catch(() => { /* 不影响本地流程 */ });
    }
    if (isVoice && personaAudioRef.current && playerRef.current) {
      introClipRef.current = 'persona';
      // 开场白音频已全量拿到（单段），播完即轮到用户
      turnAudioDoneRef.current = true;
      setStatusBoth('speaking');
      playerRef.current.enqueue(personaAudioRef.current);
      armIntroWatchdog();
    } else {
      setStatusBoth(timeUpRef.current ? 'time_up' : 'user_turn');
    }
  };

  // ===== 点击「我准备好了」：地推引流课新手先走资格提问，否则直接开练 =====
  const handleReady = () => {
    setErrorMsg('');
    if (guidanceEligible) {
      // 用户手势上下文内创建/恢复 guidance AudioContext，后续 TTS 播放不受自动播放限制
      ensureGuideCtx();
      void beginQualify();
      return;
    }
    startLive();
  };

  // ===== 新手指引：通用小工具 =====

  /** guidance 专用 AudioContext：必须在用户手势里创建/恢复一次，之后异步播放不受自动播放限制 */
  const ensureGuideCtx = (): AudioContext => {
    if (!guideCtxRef.current || guideCtxRef.current.state === 'closed') {
      guideCtxRef.current = new AudioContext();
    }
    if (guideCtxRef.current.state === 'suspended') void guideCtxRef.current.resume();
    return guideCtxRef.current;
  };

  /** 用 guidance AudioContext 解码并播放一段 base64 wav，等待播完；失败也 resolve，保证流程可继续 */
  const playClip = (base64: string) =>
    new Promise<void>((resolve) => {
      let settled = false;
      let src: AudioBufferSourceNode | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (src) {
          try { src.stop(); } catch { /* 已停止 */ }
          if (guideSrcRef.current === src) guideSrcRef.current = null;
          src = null;
        }
        resolve();
      };
      const gen = guidePlayGenRef.current;
      try {
        const ctx = ensureGuideCtx();
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        // 解码兜底（正常解码是毫秒级）
        timer = setTimeout(finish, 15000);
        void ctx
          .decodeAudioData(bytes.buffer as ArrayBuffer)
          .then((buf) => {
            if (settled) return;
            if (timer) clearTimeout(timer);
            // 解码期间被重播/进 live 打断：丢弃不播
            if (gen !== guidePlayGenRef.current) return finish();
            src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            guideSrcRef.current = src;
            src.onended = finish;
            // 播放兜底：onended 未触发时按音频时长 +2s 检查。
            // AudioContext 被挂起时不发声也不触发 onended：先尝试恢复并继续等，
            // 避免在静音中直接跳到下一句；重试多次仍挂起才放行，保证流程不卡死。
            let retries = 0;
            const armWatchdog = () => {
              timer = setTimeout(() => {
                if (settled) return;
                if (ctx.state === 'suspended' && retries < 3) {
                  retries += 1;
                  void ctx.resume();
                  armWatchdog();
                  return;
                }
                finish();
              }, (buf.duration + 2) * 1000);
            };
            armWatchdog();
            src.start();
          })
          .catch(finish);
      } catch {
        finish();
      }
    });

  /** 停止指引阶段在途的播放与录音，并使示范播放循环/自动聆听失效 */
  const stopGuidanceMedia = () => {
    demoTokenRef.current += 1;
    guidePlayGenRef.current += 1;
    if (guideSrcRef.current) {
      try { guideSrcRef.current.stop(); } catch { /* 已停止 */ }
      guideSrcRef.current = null;
    }
    // 中断在途自动聆听（内部会停止录音器、释放麦克风并清 VAD 定时器）
    guidanceCancelRef.current?.();
    guidanceCancelRef.current = null;
    if (vadTimerRef.current) {
      clearTimeout(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    guidanceRecRef.current?.stop();
    guidanceRecRef.current = null;
    setGuideRec('idle');
  };

  /** 拼接已采集的 PCM 分块为一个 ArrayBuffer */
  const mergePcmChunks = (parts: ArrayBuffer[]): ArrayBuffer => {
    const total = parts.reduce((n, b) => n + b.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      merged.set(new Uint8Array(p), offset);
      offset += p.byteLength;
    }
    return merged.buffer;
  };

  /**
   * 自动聆听：RMS 音量检测说话开始，连续静音约 1.3s 判停，最大 15s 兜底。
   * resolve：micError=true 表示麦克风不可用；audio=null 表示被外部中断（阶段切换/进 live）。
   */
  const autoListen = () =>
    new Promise<{ audio: ArrayBuffer | null; micError: boolean }>((resolve) => {
      let settled = false;
      const finish = (audio: ArrayBuffer | null, micError = false) => {
        if (settled) return;
        settled = true;
        guidanceCancelRef.current = null;
        if (vadTimerRef.current) {
          clearTimeout(vadTimerRef.current);
          vadTimerRef.current = null;
        }
        guidanceRecRef.current?.stop();
        guidanceRecRef.current = null;
        resolve({ audio, micError });
      };
      guidanceCancelRef.current = () => finish(null);

      const rec = new PcmRecorder();
      const chunks: ArrayBuffer[] = [];
      rec.onChunk = (buf) => chunks.push(buf);
      let spoke = false;
      let lastVoiceAt = 0;
      rec.onLevel = (rms) => {
        if (settled) return;
        const now = Date.now();
        if (rms > VAD_RMS_THRESHOLD) {
          spoke = true;
          lastVoiceAt = now;
          return;
        }
        // 检测到开始说话后，连续静音视为说完
        if (spoke && lastVoiceAt && now - lastVoiceAt >= VAD_SILENCE_MS) {
          finish(mergePcmChunks(chunks));
        }
      };
      guidanceRecRef.current = rec;
      rec
        .start()
        .then(() => {
          if (settled) return;
          // 最大录音时长兜底：有说过话就提交，全程未说话提交空音频（后端按未识别处理）
          vadTimerRef.current = setTimeout(
            () => finish(spoke ? mergePcmChunks(chunks) : new ArrayBuffer(0)),
            VAD_MAX_RECORD_MS
          );
        })
        .catch(() => finish(null, true));
    });

  // ===== 新手指引：资格提问 =====
  const beginQualify = async () => {
    setPhaseBoth('qualify');
    await askQualifyQuestion(1);
  };

  const askQualifyQuestion = async (q: 1 | 2) => {
    if (!sessionId) return;
    const question = QUALIFY_QUESTIONS[q - 1];
    setQualifyQ(q);
    setQualifyText('');
    setQualifyHint('');
    qualifyRetryRef.current = 0;
    setQualifyStage('asking');
    try {
      const clip = await ttsClip(sessionId, question, 'coach');
      await playClip(clip.audioBase64);
    } catch {
      /* 提问音频失败不影响回答 */
    }
    if (phaseRef.current !== 'qualify' || statusRef.current === 'paused') return;
    // 问题播完自动开麦聆听
    await autoAnswerQualify(q);
  };

  /** 资格提问的全自动语音回答：自动录音 → VAD 判停 → 上传识别 → 自动进入下一环节 */
  const autoAnswerQualify = async (q: 1 | 2) => {
    if (!sessionId || phaseRef.current !== 'qualify' || statusRef.current === 'paused') return;
    setQualifyStage('recording');
    const { audio, micError } = await autoListen();
    if (phaseRef.current !== 'qualify' || (!audio && !micError)) return;
    // 聆听期间可能被暂停（autoListen 被中断返回空音频，此处再兜一次）
    if ((statusRef.current as PracticeStatus) === 'paused') return;
    if (micError) {
      setQualifyStage('error');
      setQualifyHint('麦克风不可用，请检查浏览器授权后刷新重试');
      return;
    }
    setQualifyStage('uploading');
    setErrorMsg('');
    try {
      const res = await qualifyAnswer(sessionId, q, audio!);
      if (phaseRef.current !== 'qualify') return;
      if (!res.text) throw new Error('empty asr');
      setQualifyText(`我：${res.text}`);
      setQualifyHint('');
      if (q === 1) {
        await askQualifyQuestion(2);
      } else if (res.experienced) {
        startLive();
      } else {
        await beginGuide(1);
      }
    } catch (err) {
      if (phaseRef.current !== 'qualify') return;
      qualifyRetryRef.current += 1;
      if (qualifyRetryRef.current <= GUIDANCE_MAX_RETRY) {
        setQualifyHint(
          (err instanceof Error && err.message === 'empty asr') ||
            (err as { response?: { status?: number } })?.response?.status === 422
            ? '没听清，请再说一次'
            : apiError(err, '回答上传失败') + '，请再说一次'
        );
        // 自动重新开始录音
        await autoAnswerQualify(q);
      } else {
        setQualifyStage('error');
        setQualifyHint('多次未能识别语音，请检查麦克风后刷新重试，或点击下方按钮直接进入示范教学');
      }
    }
  };

  // ===== 新手指引：示范对话 =====
  const beginGuide = async (version: number) => {
    if (!sessionId) return;
    stopGuidanceMedia();
    const token = demoTokenRef.current;
    setPhaseBoth('guide');
    setDemoVersion(version);
    setDemoStage('loading');
    setDemoLines([]);
    setDemoIndex(-1);
    setGuideText('');
    setGuideHint('');
    setErrorMsg('');
    try {
      const { lines } = await fetchDemo(sessionId, version);
      if (demoTokenRef.current !== token || phaseRef.current !== 'guide') return;
      if (lines.length === 0) throw new Error('empty demo');
      setDemoLines(lines);
      setDemoStage('playing');
      // 预合成管线：播放当前句时提前合成后面 3 句，句间不再等 TTS 网络往返（每句现场合成要 1~3 秒）
      const synthLine = (line: DemoLine) => {
        const voiceRole =
          line.role === 'sales'
            ? 'sales'
            : line.role === 'customer'
              ? 'persona'
              : line.role === 'child'
                ? 'child'
                : 'narrator';
        return ttsClip(sessionId, line.text, voiceRole, line.arousal, line.excitement).catch(() => null);
      };
      const inflight = new Map<number, Promise<{ audioBase64: string } | null>>();
      const prefetch = (i: number) => {
        if (i < lines.length && !inflight.has(i)) inflight.set(i, synthLine(lines[i]));
      };
      prefetch(0);
      prefetch(1);
      prefetch(2);
      // 逐句播放：前一句播完再播下一句
      for (let i = 0; i < lines.length; i++) {
        if (demoTokenRef.current !== token || phaseRef.current !== 'guide') return;
        setDemoIndex(i);
        const pending = inflight.get(i) ?? synthLine(lines[i]);
        inflight.delete(i);
        prefetch(i + 3);
        try {
          const clip = await pending;
          if (demoTokenRef.current !== token || phaseRef.current !== 'guide') return;
          if (clip) await playClip(clip.audioBase64);
        } catch {
          /* 单句音频失败：文字已展示，继续下一句 */
        }
      }
      if (demoTokenRef.current !== token || phaseRef.current !== 'guide') return;
      setDemoIndex(-1);
      await askGuideChoice();
    } catch (err) {
      if (demoTokenRef.current !== token) return;
      setErrorMsg(apiError(err, '示范对话加载失败，可直接开始练习'));
      setDemoStage('ask');
    }
  };

  /** 示范播完：教练语音+文字询问下一步，随后自动聆听 */
  const askGuideChoice = async () => {
    if (!sessionId) return;
    setDemoStage('ask');
    setGuideText('');
    setGuideHint('');
    guideRetryRef.current = 0;
    try {
      const clip = await ttsClip(sessionId, GUIDE_CHOICE_QUESTION, 'coach');
      await playClip(clip.audioBase64);
    } catch {
      /* 提问音频失败不影响回答 */
    }
    if (phaseRef.current !== 'guide' || statusRef.current === 'paused') return;
    await autoAnswerGuideChoice();
  };

  /** 示范选择的全自动语音回答：自动录音 → VAD 判停 → 上传识别 → 自动执行选择 */
  const autoAnswerGuideChoice = async () => {
    if (!sessionId || phaseRef.current !== 'guide' || statusRef.current === 'paused') return;
    setGuideRec('recording');
    const { audio, micError } = await autoListen();
    if (phaseRef.current !== 'guide' || (!audio && !micError)) return;
    setGuideRec('idle');
    if (micError) {
      setGuideHint('麦克风不可用，请检查浏览器授权；也可点击下方按钮选择');
      return;
    }
    setGuideRec('uploading');
    setErrorMsg('');
    try {
      const res = await demoChoice(sessionId, audio!);
      if (!res.text) throw new Error('empty asr');
      setGuideText(`我：${res.text}`);
      setGuideHint('');
      if (res.choice === 'replay') {
        await beginGuide(demoVersion + 1);
      } else {
        startLive();
      }
    } catch (err) {
      if (phaseRef.current !== 'guide') return;
      setGuideRec('idle');
      guideRetryRef.current += 1;
      if (guideRetryRef.current <= GUIDANCE_MAX_RETRY) {
        setGuideHint(
          (err instanceof Error && err.message === 'empty asr') ||
            (err as { response?: { status?: number } })?.response?.status === 422
            ? '没听清，请再说一次'
            : apiError(err, '识别失败') + '，请再说一次'
        );
        // 自动重新开始录音
        await autoAnswerGuideChoice();
      } else {
        setGuideHint('多次未能识别语音，请直接点击下方按钮选择');
      }
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
        // 暂停中也可入队：TtsPlayer 暂停时只缓冲不出声，恢复后接着播
        if (ev.audio) playerRef.current?.enqueue(ev.audio);
        if (!paused) setStatusBoth('speaking');
        break;
      case 'tts_chunk':
        if (ev.audio && typeof ev.seq === 'number') {
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
          enqueueQuizzes(t.pendingQuizzes);
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
      enqueueQuizzes(res.pendingQuizzes);
      // 等待响应期间被暂停：只落对话记录，不解除暂停态
      if ((statusRef.current as PracticeStatus) !== 'paused') setStatusBoth(res.timeUp ? 'time_up' : 'user_turn');
    } catch (err) {
      const statusCode = (err as { response?: { status?: number } })?.response?.status;
      if (statusCode === 409) {
        setErrorMsg('会话已结束');
        setStatusBoth('ended');
      } else {
        setErrorMsg(apiError(err));
        if ((statusRef.current as PracticeStatus) !== 'paused') setStatusBoth('user_turn');
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

  // ===== 轮到你时自动开麦（语音模式，可在设置中关闭；考题弹窗期间不抢麦） =====
  useEffect(() => {
    if (!isVoice || phase !== 'live' || status !== 'user_turn' || timeUp) return;
    if (!wsReady || isRecording || !autoMic) return;
    if (quizQueue.length > 0) return; // 先答考题，答完再开麦
    if (playerRef.current?.busy) return; // 对方音频没播完，绝不抢麦
    void startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVoice, phase, status, timeUp, wsReady, isRecording, autoMic, quizQueue.length]);

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
        const p = phaseRef.current;
        if (p === 'live') {
          playerRef.current?.resumePlayback();
          setStatusBoth(
            timeUpRef.current ? 'time_up' : playerRef.current?.busy ? 'speaking' : 'user_turn'
          );
        } else {
          // 开场/指引阶段：恢复到该阶段当前步骤
          setStatusBoth('loading');
          if (p === 'qualify') void askQualifyQuestion(qualifyQ);
          else if (p === 'guide') {
            if (demoStage === 'ask') void askGuideChoice();
            else void beginGuide(demoVersion);
          }
          // ready_wait：回到「我准备好了」界面即可，无需额外动作
        }
      } catch (err) {
        setErrorMsg(apiError(err, '继续失败，请重试'));
      }
      return;
    }

    if (phaseRef.current === 'boot') return;
    if (['failed', 'ended', 'evaluating', 'time_up'].includes(statusRef.current)) return;

    // 冻结本地一切收发：录音停止、ASR/TTS 轮次取消、播放器暂停、指引阶段媒体中断
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      setMicLevel(0);
    }
    socketRef.current?.send({ type: 'interrupt' });
    playerRef.current?.pause();
    stopGuidanceMedia();
    setPartialText('');

    try {
      const res = await pauseSession(sessionId);
      if (typeof res.remainingSeconds === 'number') setRemaining(Math.max(0, res.remainingSeconds));
      setStatusBoth('paused');
    } catch (err) {
      setErrorMsg(apiError(err, '暂停失败，请重试'));
      setStatusBoth(phaseRef.current === 'live' ? 'user_turn' : 'loading');
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
    stopGuidanceMedia();
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
  const inLive = phase === 'live';
  const inputDisabled = !inLive || status !== 'user_turn' || timeUp;
  const canStop =
    phase !== 'boot' && !(inLive && status === 'loading') && status !== 'failed' && status !== 'ended' && status !== 'evaluating';
  const canPause =
    phase !== 'boot' && !['failed', 'ended', 'evaluating', 'time_up'].includes(status);
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
  const inIntro = phase === 'ready_wait' || phase === 'qualify' || phase === 'guide';
  /** 示范对话当前说话的角色（用于双角色可视化高亮） */
  const demoCurrentRole =
    demoIndex >= 0 && demoIndex < demoLines.length ? demoLines[demoIndex].role : null;
  /** 仅语音模式的地推引流课场景启用新手指引 */
  const guidanceEligible =
    isVoice &&
    !!scenario &&
    GROUND_PUSH_KEYWORDS.some((k) =>
      `${scenario.name} ${(scenario.coverageTopics ?? []).join(' ')}`.includes(k)
    );

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
                  <div className="rl">家长 · AI 扮演</div>
                </div>
              </div>
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
              {phase === 'ready_wait' && status !== 'paused' && (
                <div className="statusbar statusbar-coral">
                  <span className="pulse-dot" />准备好了吗？点击「我准备好了」开始对练
                </div>
              )}
              {phase === 'qualify' && status !== 'paused' && (
                <div className="statusbar statusbar-blue">
                  🎓 新手指引 · 教练提问（第 {qualifyQ} / 2 题），请用语音回答，倒计时已冻结
                </div>
              )}
              {phase === 'guide' && status !== 'paused' && (
                <div className="statusbar statusbar-blue">
                  📖 新手指引 · 示范对话{demoStage === 'ask' ? '已播完' : '播放中'}，倒计时已冻结
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
              {status === 'paused' && (
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
                {phase === 'ready_wait' && status !== 'paused' && (
                  <div className="flex flex-col items-center gap-5 px-6 max-w-[560px]">
                    <button className="ready-btn" onClick={handleReady}>▶ 我准备好了</button>
                  </div>
                )}
                {phase === 'qualify' && status !== 'paused' && (
                  <div className="flex flex-col items-center gap-5 px-6 max-w-[560px]">
                    <div className="text-[13px] font-semibold opacity-75">资格提问 · 第 {qualifyQ} / 2 题</div>
                    {qualifyStage === 'recording' && (
                      <>
                        <div className="flex items-end gap-[5px] h-9">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <span key={i} className="w-[5px] rounded-full bg-coral animate-pulse" style={{ height: `${14 + (i % 3) * 9}px`, animationDelay: `${i * 0.15}s` }} />
                          ))}
                        </div>
                        <div className="text-[13.5px] font-medium opacity-85">🎙 正在聆听，请直接回答… 说完会自动提交</div>
                      </>
                    )}
                    {qualifyStage === 'uploading' && (
                      <>
                        <div className="think5"><i /><i /><i /><i /><i /></div>
                        <div className="text-[13px] font-medium opacity-75">正在识别你的回答…</div>
                      </>
                    )}
                    {qualifyStage === 'error' && (
                      <button className="ready-btn" onClick={() => void beginGuide(1)}>▶ 继续（进入示范教学）</button>
                    )}
                    {qualifyHint && <div className="text-[13px] font-semibold text-coral">{qualifyHint}</div>}
                    {qualifyText && <div className="text-[12.5px] font-medium opacity-60">{qualifyText}</div>}
                  </div>
                )}
                {phase === 'guide' && status !== 'paused' && (
                  <div className="flex flex-col items-center gap-4 px-6 py-14 w-full max-w-[620px]">
                    {demoStage === 'loading' && (
                      <>
                        <div className="think5"><i /><i /><i /><i /><i /></div>
                        <div className="text-[13.5px] font-medium opacity-85">正在生成示范对话…</div>
                        <button
                          className="btn btn-sm"
                          style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}
                          onClick={startLive}
                        >
                          ⏭ 跳过示范，直接开始
                        </button>
                      </>
                    )}
                    {demoStage === 'playing' && (
                      <div className="flex flex-col items-center gap-6">
                        {/* 三角色可视化：当前说话方高亮 + 声波动画 */}
                        <div className="flex items-center gap-8">
                          {([
                            { role: 'sales' as const, label: 'AI 销售', badge: '销', bg: 'bg-coral' },
                            { role: 'customer' as const, label: 'AI 客户', badge: '客', bg: 'bg-[#4B7BEC]' },
                            { role: 'child' as const, label: 'AI 小朋友', badge: '童', bg: 'bg-[#22A06B]' },
                          ]).map(({ role, label, badge, bg }) => {
                            const active = demoCurrentRole === role;
                            return (
                              <div key={role} className="flex flex-col items-center gap-2">
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-[22px] font-bold text-white transition-all ${bg} ${active ? 'scale-110 shadow-[0_0_24px_rgba(255,255,255,.25)]' : 'opacity-40'}`}>
                                  {badge}
                                </div>
                                <div className="text-[12.5px] font-semibold opacity-85">{label}</div>
                                <div className="flex items-end gap-[4px] h-6">
                                  {active && [0, 1, 2, 3, 4].map((i) => (
                                    <span key={i} className="w-[4px] rounded-full bg-white/85 animate-pulse" style={{ height: `${8 + (i % 3) * 6}px`, animationDelay: `${i * 0.15}s` }} />
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {demoCurrentRole === 'narrator' && (
                          <div className="text-[13px] italic text-white/60">🗣 旁白解说中…</div>
                        )}
                        {demoLines.length > 0 && (
                          <div className="text-[12px] font-medium opacity-60 tabular-nums">{demoIndex + 1} / {demoLines.length}</div>
                        )}
                        <button
                          className="btn btn-sm"
                          style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}
                          onClick={startLive}
                        >
                          ⏭ 跳过示范，直接开始
                        </button>
                      </div>
                    )}
                    {demoStage === 'ask' && (
                      <div className="flex flex-col items-center gap-3">
                        <div className="text-[14px] font-semibold opacity-90">🎓 {GUIDE_CHOICE_QUESTION}</div>
                        {guideRec === 'recording' && (
                          <>
                            <div className="flex items-end gap-[5px] h-9">
                              {[0, 1, 2, 3, 4].map((i) => (
                                <span key={i} className="w-[5px] rounded-full bg-coral animate-pulse" style={{ height: `${14 + (i % 3) * 9}px`, animationDelay: `${i * 0.15}s` }} />
                              ))}
                            </div>
                            <div className="text-[13.5px] font-medium opacity-85">🎙 正在聆听，请直接回答… 说完会自动提交</div>
                          </>
                        )}
                        {guideRec === 'uploading' && (
                          <>
                            <div className="think5"><i /><i /><i /><i /><i /></div>
                            <div className="text-[13px] font-medium opacity-75">正在识别你的选择…</div>
                          </>
                        )}
                        {guideText && <div className="text-[12.5px] font-medium opacity-60">{guideText}</div>}
                        {guideHint && <div className="text-[13px] font-semibold text-coral">{guideHint}</div>}
                        <div className="flex gap-3">
                          <button
                            className="btn btn-sm"
                            style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}
                            onClick={() => void beginGuide(demoVersion + 1)}
                          >
                            🔁 再听一版
                          </button>
                          <button className="btn btn-primary btn-sm" onClick={startLive}>▶ 开始练习</button>
                        </div>
                      </div>
                    )}
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
                {status === 'paused' && (
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

      {/* ===== 随场考题弹窗（对练中触发，逐题作答） ===== */}
      {phase === 'live' && quizQueue.length > 0 && (
        <QuizModal
          sessionId={sessionId}
          quiz={quizQueue[0]}
          onDone={() => setQuizQueue((prev) => prev.slice(1))}
          onSkip={quizQueue[0].required ? undefined : () => dismissQuiz(quizQueue[0])}
        />
      )}
    </div>
  );
}
