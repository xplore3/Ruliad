export interface Task {
  scenarioId: string;
  scenarioName: string;
  durationMinutes: number | null;
  difficulty: string | null;
  status: 'locked' | 'available' | 'in_progress' | 'passed' | 'failed_pending_retry';
  bestScore?: number;
  lastScore: number | null;
  needsRetry: boolean;
  isReview?: boolean;
  reviewDueAt?: string;
  reviewLabel?: 'D7' | 'D21';
  personaName: string | null;
  order: number | null;
  requiredPassScore: number | null;
  personaTitle: string | null;
  methodology: string | null;
  practiceCount: number | null;
}

export interface SkillMapItem {
  skillPointId: string;
  name: string;
  skillPointName: string;
  currentLevel: number;
  maxLevel: number;
  historyCount: number;
  source: string | null;
  locked: boolean;
}

export interface TasksResponse {
  tasks: Task[];
  skillMap: SkillMapItem[];
  nextExamWindow: NextExamWindow | null;
}

export interface Emotion {
  arousal: number;
  bandKey: string;
}

export interface TranscriptTurn {
  seq: number;
  speaker: 'trainee' | 'persona' | 'coach';
  text: string;
  at: string;
  emotion?: Emotion;
  isHint?: boolean;
}

export interface EmotionPoint {
  seq: number;
  arousal: number;
  bandKey: string;
  at: string;
}

export interface Session {
  id: string;
  transcript: TranscriptTurn[];
  startedAt: string;
  hintsUsed: number;
  emotionTrace?: EmotionPoint[];
  status?: 'active' | 'completed' | 'abandoned';
  mode?: 'practice' | 'exam';
  examWindowId?: string;
  /** 整场对练正面录像的回放地址 */
  videoUrl?: string;
  /** 视频关键帧（多模态评分用） */
  videoFrames?: Array<{ url: string; atMs: number }>;
}

export interface Persona {
  name: string;
  age?: number;
  occupation?: string;
  background: string;
}

export interface CreateSessionResponse {
  session: Session;
  persona: Persona;
  scenario: { name: string; durationMinutes: number };
  remainingSeconds: number;
}

export interface QuizQuestion {
  id: string;
  scenarioId?: string;
  skillPointId?: string;
  productKBEntryId?: string;
  type: 'single_choice' | 'multi_choice' | 'true_false' | 'short_answer' | 'scenario_pick';
  prompt: string;
  options?: { id: string; label: string }[];
  correctAnswer: string[] | string;
  referencePoints?: string[];
  explanation: string;
  score: number;
  trigger: { kind: string; afterNTurns?: number; keywords?: string[]; topic?: string; seconds?: number };
  required: boolean;
}

export interface QuizAnswerResponse {
  correct: boolean;
  score: number;
  explanation: string;
  correctAnswer: string[] | string;
}

export interface TurnResponse {
  traineeTurn: TranscriptTurn;
  personaTurn: TranscriptTurn;
  arousal: number;
  bandKey: string;
  remainingSeconds: number;
  pendingQuizzes?: QuizQuestion[];
}

export interface HintResponse {
  hintTurn: TranscriptTurn;
  hintsRemaining: number;
}

/** 一期语音（HTTP 批量）：POST /sessions/:id/voice-turn 响应 */
export interface VoiceTurnResponse {
  userText: string;
  replyText: string;
  audioBase64?: string;
  audioFormat?: 'wav' | 'mp3';
  /** 与 /turns 响应结构一致（traineeTurn / personaTurn / remainingSeconds 等） */
  turn?: TurnResponse;
  emotion?: Emotion;
}

export interface EndSessionResponse {
  sessionId: string;
  report: Report;
}

export interface SkillScore {
  skillPointId: string;
  skillPointName: string;
  score: number;
  maxScore: number;
}

export interface ReportItem {
  itemName: string;
  skillPointId: string;
  levelLabel: string;
  score: number;
  quote: string;
  quoteTurnSeq: number;
  rationale: string;
  betterScript?: string;
  confidence: number;
  judgeAgree: boolean;
  isReference: boolean;
  isObservation: boolean;
}

export interface Violation {
  kind: string;
  detail: string;
  turnSeq?: number;
  fatal: boolean;
}

/** 视频表现评审（多模态 judge 基于录像关键帧产出，不计入总分） */
export interface VideoReview {
  expressionScore: number;
  eyeContact: string;
  expression: string;
  lipSyncNote: string;
  suggestions: string[];
  summary: string;
}

export interface Report {
  totalScore: number;
  passed: boolean;
  fatalViolation: boolean;
  skillScores: SkillScore[];
  items: ReportItem[];
  violations: Violation[];
  ruleStats: {
    interruptions: number;
    fillerCounts: Record<string, number>;
    coverageHits: string[];
    coverageMisses: string[];
  };
  videoReview?: VideoReview;
  quizScore?: { earned: number; total: number; results: Array<{ quizId: string; correct: boolean; score: number }> };
}

export interface ReviewResponse {
  session: Session;
  report: Report | null;
  scenario: { id: string; name: string; passScore: number } | null;
  persona: Persona | null;
  prevScore: number | null;
  skipped?: boolean;
}

export interface GrowthSkill {
  skillPointId: string;
  name: string;
  currentLevel: number;
  history: { at: string; score: number; sessionId: string; mode: string }[];
}

export interface GrowthSession {
  sessionId: string;
  scenarioName: string | null;
  mode: string;
  totalScore: number;
  passed: boolean;
  at: string;
  prevSessionId?: string;
}

export interface FillerTrendPoint {
  sessionId: string;
  at: string;
  fillers: Record<string, number>;
}

export interface GrowthResponse {
  skills: GrowthSkill[];
  sessions: GrowthSession[];
  fillerTrend: FillerTrendPoint[];
  certs: GrowthCert[];
}

export interface GrowthCert {
  id: string;
  examWindowId: string;
  examWindowName: string | null;
  totalScore: number;
  issuedAt: string;
}

export interface NextExamWindow {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

export interface ExamCert {
  id: string;
  passed: boolean;
  totalScore: number;
  skillDetail: Record<string, number>;
  issuedAt: string;
}

export interface ExamWindow {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  scenarioIds: string[];
  scenarioNames: string[];
  status: 'draft' | 'open' | 'closed' | 'published';
  retakeCooldownDays: number;
  myStatus: 'not_started' | 'in_progress' | 'passed' | 'failed' | 'cooldown';
  myBestScore: number | null;
  nextRetakeAt: string | null;
  myCert: ExamCert | null;
}

export interface ExamWindowsResponse {
  windows: ExamWindow[];
}

export interface CertHistoryItem {
  id: string;
  examWindowId: string;
  examWindowName: string | null;
  passed: boolean;
  totalScore: number;
  skillDetail: Record<string, number>;
  sessionIds: string[];
  issuedAt: string;
}

export interface AppealReReview {
  verdict: 'agree' | 'disagree' | 'partial';
  rationale: string;
  suggestedScore?: number;
  reviewedAt: string;
}

export interface Appeal {
  id: string;
  sessionId: string;
  targetType: 'score_item' | 'violation' | 'overall';
  scoreItemResultIndex: number;
  violationIndex: number;
  reason: string;
  status: 'pending' | 'upheld' | 'rejected';
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
  reReview?: AppealReReview;
  scenarioName: string | null;
  userName: string | null;
  scoreItemResult: {
    itemName: string;
    levelLabel: string;
    score: number;
    quote: string;
    rationale: string;
    isReference: boolean;
  } | null;
  violation?: { ruleId: string; kind: string; detail: string; fatal: boolean } | null;
}

export interface AppealsResponse {
  appeals: Appeal[];
}
