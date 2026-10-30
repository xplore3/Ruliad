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

/** 场景类型：drill=实战训练（无剧本自由对练）；practical=实用场景（单点考核，有剧本） */
export type SceneType = 'drill' | 'practical';

/** 剧本维度 */
export interface ScenarioScript {
  /** 执行顺序（剧本流程/步骤） */
  executionOrder?: string;
  /** 目的 */
  purpose?: string;
  /** 话题 */
  topics?: string[];
  /** 客户的主要问题 */
  customerQuestions?: string[];
  /** 主要考核点 */
  assessmentPoints?: string[];
}

/** 参与者维度 */
export interface ScenarioParticipant {
  name: string;
  /** 主要特征 */
  traits?: string;
  /** 说话特点 */
  speakingStyle?: string;
  /** 话语范围 */
  speechScope?: string;
  /** 言语要求 */
  languageRequirements?: string;
  /** 参与目的 */
  goal?: string;
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
  description?: string;
  personaName?: string;
  personaTitle?: string;
  skillPointIds?: string[];
  skillPointNames?: string[];
  methodology?: string;
  source?: string;
  practiceCount?: number;
  /** 场景级产品知识库 id（可选；优先于角色默认知识库） */
  productKBId?: string;
  /** 场景类型（缺省视为 practical） */
  sceneType?: SceneType;
  /** 评分分类：决定评分时选用评分标准库中的哪一类标准 */
  category?: ScoreCategory;
  /** 剧本（实用场景） */
  script?: ScenarioScript;
  /** 参与者设定 */
  participants?: ScenarioParticipant[];
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
  /** 进入正式对练（live）的时间（ISO），倒计时与用时以此为起点 */
  liveStartedAt?: string;
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

/** ===== 资源库管理 ===== */

/** 示范问答库条目 */
export interface DemoFaq {
  id: string;
  tenantId: string;
  category: string;
  question: string;
  referenceAnswer?: string;
  difficulty?: number;
  skillPointIds?: string[];
  frequency?: number;
}

export interface ScoreLevel {
  key: string;
  label: string;
  score: number;
  description: string;
}

/** 评分业务分类：评分标准库按四类分库维护 */
export type ScoreCategory = '地推' | '电销' | '咨询接待' | '现场成交';

export const SCORE_CATEGORIES: readonly ScoreCategory[] = ['地推', '电销', '咨询接待', '现场成交'];

/** 演练剧本：整篇剧情文本，演练开始交给 LLM 理解，决定谁先开口、如何回应、何时结束 */
export interface DrillScript {
  id: string;
  tenantId: string;
  category: ScoreCategory;
  name: string;
  content: string;
}

export interface ScoreItemDef {
  id: string;
  tenantId: string;
  skillPointId: string;
  name: string;
  behaviorAnchor: string;
  judgePrompt: string;
  weight: number;
  levels: ScoreLevel[];
  layer: 'company' | 'team' | 'personal';
  isObservation: boolean;
  category?: ScoreCategory;
}

export interface GoldenCase {
  id: string;
  name: string;
  transcript: { seq: number; speaker: 'trainee' | 'persona'; text: string }[];
  expected: { itemId: string; levelKey: string }[];
}

/** 示范剧本库条目（新手指引第2步示范模式引用的独立资源） */
export interface DemoScript {
  id: string;
  tenantId: string;
  /** 业务线分支：地推 / 电销 / 接待咨询 / 课程顾问（可自定义） */
  category: string;
  name: string;
  lines: import('./lib/guidance').GuidanceDemoLine[];
  variables?: Record<string, import('./lib/guidance').DemoVariable>;
  /** 从示范问答库随机抽取条数 */
  faqPick?: number;
  /** 示范问答库分类名 */
  faqPoolRef?: string;
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
  options?: { id: string; label: string }[];
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
  scenario: {
    name: string;
    durationMinutes: number;
    coverageTopics?: string[];
    description?: string;
    sceneType?: SceneType;
    script?: ScenarioScript;
    participants?: ScenarioParticipant[];
  };
  remainingSeconds: number;
}

/** 学员视角考核窗口（GET /exam-windows 返回，含我的状态） */
export interface ExamWindow {
  id: string;
  tenantId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  scenarioIds: string[];
  userIds: string[];
  status: 'draft' | 'open' | 'closed' | 'published';
  retakeCooldownDays: number;
  scenarioNames?: (string | null)[];
  myStatus: 'not_started' | 'in_progress' | 'passed' | 'failed' | 'cooldown';
  myBestScore: number | null;
  nextRetakeAt: string | null;
}
