/** 对练会话 */

import type { QuizResult } from './quiz.js';

/** 数据隔离的根字段 */
export type SessionMode = 'practice' | 'exam';

export type SessionStatus = 'active' | 'completed' | 'abandoned';

export type Speaker = 'trainee' | 'persona' | 'coach' | 'child';

export interface EmotionSnapshot {
  arousal: number;
  bandKey: string;
  /** 本轮命中的触发器 id */
  triggeredBy?: string[];
}

/** 学员单轮语音的声学特征（服务端对录音 PCM 的确定性分析，供语声语调类评分标准量化判定。
 *  分析前已做电平归一化，特征与麦克风增益/距离无关；avgLoudnessDbfs 为归一化后的值，仅作诊断参考，不作评分依据） */
export interface VoiceProsodyAnalysis {
  /** 20ms 步进的完整音调轨迹（仅高置信帧） */
  pitchCurve: Array<{ atMs: number; f0Hz: number }>;
  /** 20ms 帧的完整音量轨迹 */
  loudnessCurve: Array<{ atMs: number; rms: number }>;
  /** 明显静音停顿的位置与时长 */
  pauses: Array<{ atMs: number; durationMs: number }>;
  /** 连续发声较长、可能包含拖长音的区段（仅作线索，不等同音节级拖长音识别） */
  elongatedSegments: Array<{ startMs: number; endMs: number }>;
  rhythm: { voicedMs: number; pauseMs: number; averageVoicedSegmentMs: number };
  /** 笑声启发式线索：非专用笑声模型确认，证据不足时只能为 unknown */
  laughterCue: { status: 'possible' | 'unknown'; reason: string };
  /** 夸张/表演感启发式线索：不等于幽默判定 */
  performanceCue: { status: 'possible' | 'unknown'; reason: string };
}

export interface VoiceFeatures {
  /** 平均响度 dBFS（归一化后说话段 RMS 均值；设备相关量，勿用于评分） */
  avgLoudnessDbfs: number;
  /** 响度动态范围 dB（说话段 P90 与 P10 之差，反映强弱起伏） */
  loudnessRangeDb: number;
  /** 音调变化幅度（F0 半音标准差；音频过短或无法测音调时为 null） */
  pitchVarSemitones: number | null;
  /** 音高中位数 Hz（有效音调帧 F0 的中位数，对八度跳变噪声稳健；激情"音高抬升"型表现的核心指标） */
  medianF0Hz?: number | null;
  /** 实际说话时长 ms（剔除静音段），真实语速 = 字数 / voicedMs */
  voicedMs: number;
  /** 同步提取的语气辅助证据，供幽默/情感色彩判断；启发式线索不能作为唯一判据 */
  prosody?: VoiceProsodyAnalysis;
}

export type ExpressionTone = 'playful' | 'serious' | 'uncertain';
export type ExpressionIntentKind = 'promise' | 'threat' | 'persuasion' | 'request' | 'question' | 'inform' | 'other';

export interface ExpressionIntent {
  /** 表达方式：是否玩笑/调侃；与表达意图独立，不互斥 */
  tone: ExpressionTone;
  /** 表达意图：承诺、威胁、劝说、请求、提问、陈述等 */
  intent: ExpressionIntentKind;
  confidence: number;
  rationale: string;
}

export interface TranscriptTurn {
  seq: number;
  speaker: Speaker;
  text: string;
  audioUrl?: string;
  at: string;
  /** 该轮之后的情绪快照（persona 轮） */
  emotion?: EmotionSnapshot;
  /** 该轮是否使用了提示（coach 轮） */
  isHint?: boolean;
  /** 本轮学员发言是对孩子说的（孩子模式路由判定）：该轮语音不计入音高/响度/语速等语音声学考核 */
  addressedToChild?: boolean;
  /** 学员语音轮的声学特征（文字轮/未开启语音分析时无此字段） */
  voiceFeatures?: VoiceFeatures;
  /** 本轮表达方式与意图：语气（玩笑/认真）与意图（承诺/威胁/劝说等）独立，由全局分析器产生并供对白与评分共用 */
  expressionIntent?: ExpressionIntent;
}

export interface ReceptionQuestion {
  question: string;
  referenceAnswer: string;
  /** 《接待咨询回答问题标准详解》中该题的动机分析与评分标准 */
  scoringGuide?: string;
}

export interface Session {
  id: string;
  tenantId: string;
  userId: string;
  scenarioId: string;
  mode: SessionMode;
  status: SessionStatus;
  transcript: TranscriptTurn[];
  emotionTrace: Array<{ seq: number; arousal: number; bandKey: string; at: string }>;
  hintsUsed: number;
  /** 咨询接待本场固定抽取的10题及评分参考答案，创建后不再变化 */
  receptionQuestions?: ReceptionQuestion[];
  /** 重练链：指向前次 session */
  prevSessionId?: string;
  examWindowId?: string;
  /** 整场对练正面录像（含声音）的回放地址 */
  videoUrl?: string;
  /** 视频关键帧（多模态评分用），按时间均匀截取 */
  videoFrames?: Array<{ url: string; atMs: number }>;
  /** 考题答题记录 */
  quizResults?: QuizResult[];
  /** 暂停开始时间（ISO），非空即处于暂停中 */
  pausedAt?: string;
  /** 历史累计暂停时长（毫秒），恢复时累加 */
  pausedMs?: number;
  /** AI 教练开场白缓存（首次生成后复用） */
  coachOpening?: string;
  /** 教练强度（创建会话时可选）：高强度 persona 更频繁追问/施压 */
  coachIntensity?: 'low' | 'medium' | 'high';
  /** 进入正式对练（live）的时间（ISO）；倒计时以此为起点，开场/新手指引阶段不计时 */
  liveStartedAt?: string;
  /** 新手指引资格问答结果（answers 按问题顺序） */
  qualifyResult?: { answers: string[]; experienced: boolean };
  /** 演练难度等级（对应新手指引流程配置 difficultyLevels.level；缺省用指引配置 defaultDifficulty） */
  difficulty?: number;
  /**
   * 本场客户类型（建会话时系统随机确定，整场不变）：uninterested=不感兴趣客户 / interested=潜在意向客户。
   * 仅当演练剧本声明了概率化客户类型（如"10次应该有5次客户表现出不感兴趣"）时抽取；
   * LLM 无法执行概率原则，由代码随机后写死进 prompt。
   */
  customerArchetype?: 'uninterested' | 'interested';
  /** 孩子对话模式：客户转头问孩子后激活；激活期间学员发言经路由器判定对话对象，对孩子说的由孩子角色应答 */
  childMode?: boolean;
  /** 从销售第一次说服孩子起计算的沟通轮数；第二轮孩子仍抗拒时家长强制结束 */
  childAttemptCount?: number;
  startedAt: string;
  endedAt?: string;
}
