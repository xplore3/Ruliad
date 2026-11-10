/** ===== 核心业务类型 ===== */

/** 管理者类型：机构负责人 / 销售负责人 / 培训负责人 */
export type ManagerType = 'org_head' | 'sales_head' | 'training_head';

export interface User {
  id: string;
  tenantId: string;
  orgId: string;
  name: string;
  role: 'trainee' | 'admin' | 'supervisor' | 'executive' | 'platform';
  username: string;
  avatar?: string;
  /** 管理者类型（仅管理者角色有值） */
  managerType?: ManagerType;
  /** /auth/me 附加的所属机构名 */
  organizationName?: string | null;
  /** /auth/me 附加的所属机构简介 */
  organizationDescription?: string | null;
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
  /** 统一业务分类 */
  category?: ScoreCategory;
  flowType?: 'generic' | 'ground_push' | 'reception';
  drillScriptId?: string;
  scoreItemIds?: string[];
  /** 剧本（实用场景） */
  script?: ScenarioScript;
  /** 参与者设定 */
  participants?: ScenarioParticipant[];
  conversation?: {
    speechRate: 1 | 2 | 3;
    challenge: number;
    interruptLevel: 'off' | 'weak' | 'strong';
  };
  version?: number;
  status?: 'draft' | 'published';
  createdBy?: string;
  updatedBy?: string;
}

export interface PersonaConfig {
  id: string;
  tenantId: string;
  name: string;
  background: string;
  age?: number;
  occupation?: string;
  industry?: string;
  personalityTags?: string[];
  decisionStyle?: string;
  objections?: string[];
  hiddenInfo?: string[];
  avatar?: string;
  version: number;
  elementIds: string[];
  behaviorBands: BehaviorBand[];
  knowledgeBoundary?: { mustNotKnow: string[]; loadedKnowledge: string[] };
  productKBId?: string;
  voiceProfile?: Record<string, unknown>;
  sourceMeta?: { practiceCount?: number };
  createdBy?: string;
  updatedBy?: string;
  usageCount?: number;
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
  speaker: 'trainee' | 'persona' | 'coach' | 'child';
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
  baseScore?: number;
  confidenceIndex?: number;
  passed: boolean;
  completionStatus?: 'completed' | 'incomplete';
  completionReason?: string;
  fatalViolation?: boolean;
  skillScores: { skillPointId: string; skillPointName?: string; score: number; maxScore?: number }[];
  items: ScoreItem[];
  violations?: { ruleId: string; kind: string; detail: string; fatal: boolean; turnSeq?: number }[];
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
  improvementGoal?: {
    title: string;
    impact: number;
    rationale: string;
    suggestion: string;
    quoteTurnSeq?: number;
  };
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
  isDeduction?: boolean;
  layer?: string;
}

export interface SkillPoint {
  id: string;
  tenantId?: string;
  name: string;
  description?: string;
  assetName?: string;
  practiceCount?: number;
  locked?: boolean;
}

export interface Element {
  id: string;
  tenantId?: string;
  name: string;
  type: 'C' | 'E' | 'B' | 'S';
  layer: 'platform' | 'industry' | 'tenant';
  content: string;
  version: number;
  dynamics?: {
    triggers: Array<{ id: string; keywords: string[]; escalation: number; description: string }>;
    decayPerTurn: number;
    baseArousal: number;
  };
}

/** 处理策略：直接修改 / 复制后修改（copy-on-write）/ 通用建议 */
export type VoiceConfigScope = 'direct' | 'copy-on-write' | 'general';

/** 单条执行计划操作 */
export interface VoiceConfigOperation {
  key?: string;
  kind:
    | 'create-persona'
    | 'update-persona'
    | 'copy-persona'
    | 'create-scenario'
    | 'update-scenario'
    | 'create-resource'
    | 'update-resource'
    | 'copy-resource';
  target?: string;
  id?: string;
  name?: string;
  patch: Record<string, unknown>;
  expectedVersion?: number;
  rebind?: { field: string; mode: 'single' | 'list'; oldId: string; ref: string };
  general?: boolean;
  generalReason?: string;
}

/** 命令执行计划：一次语音命令可能同时创建资源、修改资源、绑定场景 */
export interface VoiceConfigPlan {
  scope: VoiceConfigScope;
  reason?: string;
  operations: VoiceConfigOperation[];
}

/** 通用建议拆分：混合命令中提炼到「AI自动提炼」的部分 */
export interface VoiceCommandSuggestion {
  target: string;
  action: 'create' | 'update';
  subject: string;
  resourceName?: string;
  patch: Record<string, unknown>;
  reason: string;
}

export interface VoiceConfigDiagnosis {
  kind: 'score-item-analysis';
  aspect: string;
  session: {
    id: string;
    scenarioId: string;
    scenarioName: string;
    endedAt?: string;
  };
  scoreItem: { id: string; name: string };
  summary: string;
  reasons: string[];
  evidence: string[];
  proposedChanges: string[];
}

export interface VoiceEditCommand {
  id: string;
  tenantId: string;
  userId: string;
  source: 'scenario-builder' | 'resource-ai' | 'voice-config';
  target: string;
  resourceId?: string;
  action: 'create' | 'update';
  text: string;
  transcript?: string;
  patch: Record<string, unknown>;
  general: boolean;
  generalReason?: string;
  affectedScenarioIds: string[];
  status: 'previewed' | 'applied' | 'pending_review' | 'in_review' | 'resolved' | 'rejected';
  reviewNote?: string;
  reviewedBy?: string;
  createdAt: string;
  updatedAt: string;

  // ===== 统一语音流程（voice-config）扩展字段 =====
  subject?: string;
  resourceName?: string;
  resolvedResourceId?: string;
  plan?: VoiceConfigPlan;
  scope?: VoiceConfigScope;
  scopeReason?: string;
  impactScenarios?: Array<{ id: string; name: string }>;
  personaPatch?: Record<string, unknown>;
  skillPointNames?: string[];
  scoreItemNames?: string[];
  drillScriptName?: string;
  suggestions?: VoiceCommandSuggestion[];
  diagnoses?: VoiceConfigDiagnosis[];
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
  /** 打分模式：levels=按档位判定（默认）；score=直接打分 0-100（维度与分值写在行为锚定里） */
  scoringMode?: 'levels' | 'score';
  /** 信心指数调整项：score 为扣减参数，用于换算全局信心指数，不参与基础分加权平均 */
  deductionOnly?: boolean;
  quantitativeRule?: unknown;
  voiceChannel?: 'child';
}

export interface GoldenCase {
  id: string;
  tenantId?: string;
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
  scoring?: boolean;
  scoringError?: string | null;
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
  /** 客户应答轮；孩子模式下销售对孩子说话时无客户轮（由 childTurn 承担主应答） */
  personaTurn?: TranscriptTurn;
  /** 双场制切场旁白（第一小场结束、切换有意向客户时下发；speaker=coach） */
  narratorTurn?: TranscriptTurn;
  /** 孩子作答轮（客户转头问孩子时下发；speaker=child） */
  childTurn?: TranscriptTurn;
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

/** ===== 机构与管理者后台 ===== */

/** 机构列表条目（GET /organizations） */
export interface OrganizationItem {
  id: string;
  tenantId: string;
  name: string;
  parentId?: string;
  /** 机构简介（管理员维护，展示给成员） */
  description?: string;
  memberCount: number;
  teamCount: number;
}

/** 知识库条目 */
export interface KbEntry {
  id: string;
  kind: 'keypoint' | 'redline' | 'competitor' | 'faq';
  title: string;
  content: string;
  frequency?: number;
}

/** 管理总览（GET /management/overview） */
export interface ManagementOverview {
  me: {
    id: string;
    name: string;
    role: string;
    managerType: ManagerType | null;
    managerTypeLabel: string | null;
  };
  org: { id: string; name: string | null };
  stats: {
    members: number;
    teams: number;
    practiceCount: number;
    examCount: number;
    completedCount: number;
    passRate: number | null;
    avgScore: number | null;
    certifiedMembers: number;
  };
  knowledgeBase: {
    name: string | null;
    version: number;
    entryCount: number;
    kindCounts: Record<string, number>;
    effectiveAt: string | null;
  };
  attention: { userId: string; userName: string; reason: string }[];
  recent: {
    userId: string;
    name: string;
    practiceCount: number;
    lastAt: string | null;
    lastScore: number | null;
  }[];
}

/** 团队成果（GET /management/team-results） */
export interface ManagementTeamResults {
  summary: {
    memberCount: number;
    examAttempts: number;
    certifiedCount: number;
    certRate: number | null;
    avgScore: number | null;
  };
  members: {
    userId: string;
    name: string;
    teamId: string | null;
    teamName: string | null;
    examCount: number;
    passCount: number;
    bestScore: number | null;
    latestScore: number | null;
    avgScore: number | null;
    certified: boolean;
    certs: { id: string; examWindowName: string | null; level: string | null; passed: boolean; totalScore: number; issuedAt: string }[];
  }[];
}

/** 团队能力分析（GET /management/team-ability） */
export interface ManagementTeamAbility {
  skillPoints: { id: string; name: string }[];
  heatmap: {
    teamId: string;
    teamName: string | null;
    skillPointId: string;
    skillPointName: string;
    passRate: number;
    avgScore: number;
    sampleSize: number;
  }[];
  members: {
    userId: string;
    name: string;
    teamId: string | null;
    teamName: string | null;
    attention: 'consecutive_fail' | 'inactive' | null;
    latestTotalScore: number | null;
    avgLevel: number | null;
    skillDetails: {
      skillPointId: string;
      name: string;
      level: number | null;
      latestScore: number | null;
      historyCount: number;
    }[];
  }[];
  weakSkills: { skillPointId: string; skillPointName: string; avgScore: number; memberCount: number }[];
  attention: { userId: string; userName: string; reason: string }[];
}

/** 成员档案（GET /management/team-ability/member/:userId） */
export interface ManagementMemberProfile {
  userId: string;
  name: string;
  timeline: {
    sessionId: string;
    at: string;
    scenarioName: string;
    mode: string;
    totalScore: number | null;
    passed: boolean | null;
    /** 该场会话的录音回合数（0 = 纯文字对练，无录音） */
    recTurns: number | null;
    /** 该场录音总时长（秒） */
    recDurationSec: number | null;
  }[];
  skillDetails: {
    skillPointId: string;
    name: string;
    level: number | null;
    history: { at: string; score: number; sessionId: string; mode: string }[];
  }[];
}

/** 成员单次练习详情（GET /management/team-ability/member/:userId/session/:sessionId） */
export interface ManagementSessionDetail {
  session: {
    id: string;
    scenarioName: string;
    mode: string;
    status: string;
    at: string;
    durationSec: number | null;
  };
  report: ScoreReport | null;
  prevScore: number | null;
  recordings: {
    id: string;
    turnSeq: number;
    durationSec: number;
    fileSize: number;
    createdAt: string;
  }[];
}

/** 知识库（GET /management/knowledge-base） */
export interface ManagementKb {
  kb: {
    id: string;
    tenantId: string;
    name: string;
    version: number;
    effectiveAt: string;
    entries: KbEntry[];
  } | null;
  kindCounts: Record<string, number>;
  entries: KbEntry[];
}

/** ===== 用户反馈 ===== */

/** 反馈类型：功能建议 / 问题反馈 / 其他 */
export type FeedbackType = 'suggestion' | 'bug' | 'other';

/** 反馈状态：待处理 / 处理中 / 已解决 / 已关闭 */
export type FeedbackStatus = 'pending' | 'processing' | 'resolved' | 'closed';

/** 反馈回复（管理员回复） */
export interface FeedbackReply {
  id: string;
  feedbackId: string;
  userId: string;
  userName: string;
  content: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface Feedback {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  type: FeedbackType;
  content: string;
  /** 关联的功能/页面（可选） */
  source?: string;
  status: FeedbackStatus;
  replies: FeedbackReply[];
  createdAt: string;
  updatedAt?: string;
}

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  suggestion: '功能建议',
  bug: '问题反馈',
  other: '其他',
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

/** 状态对应的主题色（用于 chip 样式） */
export const FEEDBACK_STATUS_CHIP: Record<FeedbackStatus, string> = {
  pending: 'chip-amber',
  processing: 'chip-blue',
  resolved: 'chip-green',
  closed: 'chip-gray',
};
