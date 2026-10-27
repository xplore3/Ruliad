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
  startedAt: string;
  endedAt?: string;
}
