/** 评分引擎类型 */

import type { QuizScore } from './quiz.js';

/** 评分业务分类：评分标准库与场景共用，四类各自维护评分标准 */
export type ScoreCategory = '地推' | '电销' | '咨询接待' | '现场成交';

export const SCORE_CATEGORIES: readonly ScoreCategory[] = ['地推', '电销', '咨询接待', '现场成交'];

/** 评分标准档位定义 */
export interface ScoreLevel {
  key: string;
  label: string;
  score: number;
  description: string;
}

/** 评分标准定义（行为锚定） */
export interface ScoreItemDef {
  id: string;
  tenantId: string;
  skillPointId: string;
  name: string;
  /** 行为锚定描述 */
  behaviorAnchor: string;
  /** 判定 prompt 模板 */
  judgePrompt: string;
  weight: number;
  levels: ScoreLevel[];
  /** 三层标准架构 */
  layer: 'company' | 'team' | 'personal';
  /** 观察项：记录但不计分（冲突裁决用） */
  isObservation: boolean;
  /** 所属评分分类（地推/电销/咨询接待/现场成交）；缺省兼容存量数据，按全部场景可用处理 */
  category?: ScoreCategory;
}

/** 单个评分标准判定结果 */
export interface ScoreItemResult {
  itemId: string;
  itemName: string;
  skillPointId: string;
  levelKey: string;
  levelLabel: string;
  score: number;
  /** 引用原文 */
  quote: string;
  /** 原文定位（transcript seq） */
  quoteTurnSeq: number;
  rationale: string;
  /** 更优话术示范（judge 生成；最高档无扣分点或解析失败时为空） */
  betterScript?: string;
  /** 0-1，双 judge 不一致时降低 */
  confidence: number;
  /** 双 judge 是否一致 */
  judgeAgree: boolean;
  /** 不一致项：复盘中标注"参考" */
  isReference: boolean;
  isObservation: boolean;
  layer: 'company' | 'team' | 'personal';
}

/** 确定性规则层结果 */
export interface RuleViolation {
  ruleId: string;
  kind: 'redline' | 'interruption' | 'filler' | 'coverage';
  detail: string;
  turnSeq?: number;
  /** 一票否决 */
  fatal: boolean;
}

export interface SkillScore {
  skillPointId: string;
  skillPointName: string;
  score: number;
  maxScore: number;
}

/** 视频表现评审结果（多模态 judge 基于对练录像关键帧产出，独立维度，不计入总分） */
export interface VideoReview {
  /** 表情与仪态综合得分 0-100 */
  expressionScore: number;
  /** 眼神交流评价 */
  eyeContact: string;
  /** 表情/情绪表达评价 */
  expression: string;
  /** 口型与发声状态评价 */
  lipSyncNote: string;
  /** 改进建议 */
  suggestions: string[];
  /** 总体评语 */
  summary: string;
}

export interface ScoreReport {
  id: string;
  sessionId: string;
  totalScore: number;
  passed: boolean;
  /** 一票否决触发 */
  fatalViolation: boolean;
  skillScores: SkillScore[];
  items: ScoreItemResult[];
  violations: RuleViolation[];
  /** 规则层统计 */
  ruleStats: {
    interruptions: number;
    fillerCounts: Record<string, number>;
    coverageHits: string[];
    coverageMisses: string[];
    /** 学员发言占比（按字符数，0-1） */
    talkRatio: number;
    /** 估算语速（字/分钟，按对话时间窗内总字数为学员语速的近似） */
    avgSpeechRate: number;
    /** 明显停顿次数（学员应答前静默 > 3s） */
    pauseCount: number;
  };
  /** 教练总结（LLM 生成，失败时回退模板文案） */
  summary?: string;
  /** 视频表现评审（有录像且配置视觉模型时产出） */
  videoReview?: VideoReview;
  /** 考题得分汇总 */
  quizScore?: QuizScore;
  createdAt: string;
}

export type AppealStatus = 'pending' | 'upheld' | 'rejected';

/** 申诉目标类型 */
export type AppealTargetType = 'score_item' | 'violation' | 'overall';

export interface Appeal {
  id: string;
  sessionId: string;
  /** 申诉目标类型：score_item=评分标准 | violation=红线/违规 | overall=整体评价 */
  targetType: AppealTargetType;
  /** 评分标准索引（targetType=score_item 时使用，-1 表示不适用） */
  scoreItemResultIndex: number;
  /** 违规项索引（targetType=violation 时使用，-1 表示不适用） */
  violationIndex: number;
  userId: string;
  reason: string;
  status: AppealStatus;
  /** 管理员裁决意见 */
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
  /** AI 复评结果（学员提交"我不同意"后触发 AI 二次评审） */
  reReview?: AppealReReview;
}

/** AI 复评结果 */
export interface AppealReReview {
  /** 复评结论：agree=维持原评 | disagree=支持学员异议 | partial=部分支持 */
  verdict: 'agree' | 'disagree' | 'partial';
  /** 复评理由 */
  rationale: string;
  /** 复评建议分数（如果与原评不同） */
  suggestedScore?: number;
  /** 复评时间 */
  reviewedAt: string;
}
