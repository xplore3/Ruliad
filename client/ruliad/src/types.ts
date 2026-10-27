/** ===== 核心业务类型 ===== */

export interface User {
  id: string;
  tenantId: string;
  orgId: string;
  name: string;
  role: 'trainee' | 'admin' | 'supervisor' | 'executive' | 'platform';
  username: string;
  avatar?: string;
}

export interface Scenario {
  id: string;
  tenantId: string;
  name: string;
  personaConfigId: string;
  successCriteria: { passScore: number };
  durationMinutes: number;
  difficulty: number;
  coverageTopics?: string[];
  personaName?: string;
  personaTitle?: string;
  skillPointNames?: string[];
  methodology?: string;
  source?: string;
  practiceCount?: number;
}

export interface PersonaConfig {
  id: string;
  tenantId: string;
  name: string;
  background: string;
  age?: number;
  occupation?: string;
  avatar?: string;
  version: number;
  elementIds: string[];
  behaviorBands: BehaviorBand[];
  voiceProfile?: Record<string, unknown>;
  sourceMeta?: { practiceCount?: number };
}

export interface BehaviorBand {
  key: string;
  instruction: string;
  minArousal: number;
  maxArousal: number;
}

export interface Session {
  id: string;
  tenantId: string;
  userId: string;
  scenarioId: string;
  mode: 'practice' | 'exam';
  status: 'active' | 'completed' | 'abandoned';
  transcript: TranscriptTurn[];
  emotionTrace?: { seq: number; arousal: number; bandKey: string; at: string }[];
  hintsUsed: number;
  prevSessionId?: string;
  /** 暂停开始时间（ISO），非空即处于暂停中 */
  pausedAt?: string;
  /** 历史累计暂停时长（毫秒） */
  pausedMs?: number;
  /** AI 教练开场白缓存 */
  coachOpening?: string;
  startedAt: string;
  endedAt?: string;
  videoFrames?: string[];
  quizResults?: QuizResult[];
}

export interface TranscriptTurn {
  seq: number;
  speaker: 'trainee' | 'persona' | 'coach';
  text: string;
  at: string;
  isHint?: boolean;
  emotion?: { arousal: number; bandKey: string };
}

export interface QuizResult {
  quizId: string;
  answer: string[];
  correct: boolean;
  score: number;
  atTurnSeq: number;
  answeredAt: string;
}

export interface ScoreReport {
  id: string;
  sessionId: string;
  tenantId?: string;
  userId?: string;
  scenarioId?: string;
  totalScore: number;
  passed: boolean;
  fatalViolation?: boolean;
  skillScores: { skillPointId: string; skillPointName?: string; score: number; maxScore?: number }[];
  items: ScoreItem[];
  violations?: { ruleId: string; kind: string; detail: string; fatal: boolean }[];
  ruleStats: {
    fillerCounts: Record<string, number>;
    talkRatio?: number;
    avgSpeechRate?: number;
    pauseCount?: number;
    interruptions?: number;
    coverageHits?: string[];
    coverageMisses?: string[];
  };
  betterScripts?: Record<string, string>;
  summary?: string;
}

export interface ScoreItem {
  itemId: string;
  itemName: string;
  skillPointId: string;
  levelKey: string;
  levelLabel?: string;
  score: number;
  weight?: number;
  quote?: string;
  quoteTurnSeq?: number;
  rationale?: string;
  betterScript?: string;
  confidence?: number;
  isObservation?: boolean;
  layer?: string;
}

export interface SkillPoint {
  id: string;
  name: string;
  assetName?: string;
  practiceCount?: number;
  locked?: boolean;
}

export interface UserSkillState {
  skillPointId: string;
  name: string;
  currentLevel: number;
  maxLevel: number;
  history: { at: string; score: number; sessionId: string; mode: string }[];
  historyCount: number;
  score?: number;
}

export interface GrowthData {
  skills: UserSkillState[];
  sessions: {
    sessionId: string;
    scenarioName: string | null;
    mode: string;
    totalScore: number;
    passed: boolean;
    at: string;
    prevSessionId?: string;
  }[];
  fillerTrend: { sessionId: string; at: string; fillers: Record<string, number> }[];
  certs: {
    id: string;
    examWindowId: string;
    examWindowName: string | null;
    totalScore: number;
    issuedAt: string;
  }[];
}

export interface RoleCard {
  id: string;
  scenarioId: string | null;
  name: string;
  title: string;
  tags: string[];
  target: string;
  source: string;
  difficulty: '入门' | '进阶' | '高压';
  industry: string;
  role: string;
  avatar: string;
}

export interface AbilityDetail {
  key: string;
  name: string;
  score: number;
  evidenceList: {
    round: number;
    time: string;
    quote: string;
    role: 'customer' | 'me';
    tag: string;
    tagColor: string;
  }[];
  aiRationale: string;
  guidance: { label: string; content: string }[];
}

/** ===== API 响应类型 ===== */

export interface ApiResponse<T = unknown> {
  data: T;
}

export interface TaskView {
  scenarioId: string;
  scenarioName: string;
  durationMinutes: number | null;
  difficulty: number | null;
  status: 'available' | 'in_progress' | 'passed' | 'failed_pending_retry' | 'locked';
  bestScore?: number;
  lastScore: number | null;
  needsRetry: boolean;
  isReview: boolean;
  reviewDueAt?: string;
  reviewLabel?: 'D7' | 'D21';
  personaName: string | null;
  order: number | null;
  requiredPassScore: number | null;
  personaTitle: string | null;
  methodology: string | null;
  practiceCount: number | null;
}

export interface ReviewData {
  session: Session;
  report: ScoreReport | null;
  skipped?: boolean;
  scenario: { id: string; name: string; passScore: number } | null;
  persona: { name: string; age?: number; occupation?: string; background: string } | null;
  prevScore: number | null;
}

export interface QuizQuestion {
  id: string;
  type: 'single_choice' | 'multi_choice' | 'true_false' | 'short_answer' | 'scenario_pick';
  prompt: string;
  options?: string[];
  score: number;
  required?: boolean;
}

export interface TurnResult {
  traineeTurn: TranscriptTurn;
  personaTurn: TranscriptTurn;
  arousal?: number | null;
  bandKey?: string | null;
  remainingSeconds: number;
  timeUp?: boolean;
  pendingQuizzes?: QuizQuestion[];
}

export interface SessionCreated {
  session: Session;
  persona: { name: string; age?: number; occupation?: string; background: string; avatar?: string };
  scenario: { name: string; durationMinutes: number };
  remainingSeconds: number;
}
