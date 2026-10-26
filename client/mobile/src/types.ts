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
  videoUrl?: string;
  videoFrames?: Array<{ url: string; atMs: number }>;
}

export interface Persona {
  name: string;
  age?: number;
  occupation?: string;
  background: string;
  avatar?: string;
}

export interface CreateSessionResponse {
  session: Session;
  persona: Persona;
  scenario: { name: string; durationMinutes: number };
  remainingSeconds: number;
}

export interface TurnResponse {
  traineeTurn: TranscriptTurn;
  personaTurn: TranscriptTurn;
  arousal: number;
  bandKey: string;
  remainingSeconds: number;
}

export interface HintResponse {
  hintTurn: TranscriptTurn;
  hintsRemaining: number;
}

export interface VoiceTurnResponse {
  userText: string;
  replyText: string;
  audioBase64?: string;
  audioFormat?: 'wav' | 'mp3';
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
}

export interface AppealReReview {
  verdict: 'agree' | 'disagree' | 'partial';
  rationale: string;
  suggestedScore?: number;
  reviewedAt: string;
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

export interface Scenario {
  id: string;
  name: string;
  personaConfigId: string;
  skillPointIds: string[];
  durationMinutes: number;
  difficulty: number;
  passScore: number;
  personaName?: string | null;
  skillPointNames?: string[];
}

export interface ScenariosResponse {
  scenarios: Scenario[];
}

export interface PersonaConfig {
  id: string;
  name: string;
  background: string;
  age?: number;
  occupation?: string;
  version: number;
  elementIds?: string[];
  avatar?: string;
}

/** 公开陪练员卡片（首页推荐用） */
export interface RoleCard {
  id: string;
  scenarioId?: string | null;
  name: string;
  title: string;
  tags: string[];
  target: string;
  source: string;
  difficulty: '入门' | '进阶' | '高压';
  industry: string;
  role: string;
  avatar?: string;
}
