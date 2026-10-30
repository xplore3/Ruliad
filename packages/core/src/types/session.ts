/** 对练会话 */

import type { QuizResult } from './quiz.js';

/** 数据隔离的根字段 */
export type SessionMode = 'practice' | 'exam';

export type SessionStatus = 'active' | 'completed' | 'abandoned';

export type Speaker = 'trainee' | 'persona' | 'coach';

export interface EmotionSnapshot {
  arousal: number;
  bandKey: string;
  /** 本轮命中的触发器 id */
  triggeredBy?: string[];
}

/** 学员单轮语音的声学特征（服务端对录音 PCM 的确定性分析，供语声语调类评分标准量化判定） */
export interface VoiceFeatures {
  /** 平均响度 dBFS（说话段 RMS 均值） */
  avgLoudnessDbfs: number;
  /** 响度动态范围 dB（说话段 P90 与 P10 之差，反映强弱起伏） */
  loudnessRangeDb: number;
  /** 音调变化幅度（F0 半音标准差；音频过短或无法测音调时为 null） */
  pitchVarSemitones: number | null;
  /** 实际说话时长 ms（剔除静音段），真实语速 = 字数 / voicedMs */
  voicedMs: number;
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
  /** 学员语音轮的声学特征（文字轮/未开启语音分析时无此字段） */
  voiceFeatures?: VoiceFeatures;
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
  startedAt: string;
  endedAt?: string;
}
