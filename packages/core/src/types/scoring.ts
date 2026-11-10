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

/** 定量计分区间：metric 值命中 [min, max) 时得 score 分（0-100），bands 按声明顺序首个命中生效 */
export interface QuantMetricBand {
  min?: number;
  max?: number;
  score: number;
}

/** 定量计分锚点：metric 值 value 对应 score 分（0-100）；相邻锚点间线性插值，两端外取端点分 */
export interface QuantMetricPoint {
  value: number;
  score: number;
}

/** 定量计分 metric：语音声学量化数据之一；weight 为块内权重（缺省 1，按权重加权平均） */
export interface QuantMetricRule {
  metric:
    | 'pitchVarSemitones'
    | 'loudnessRangeDb'
    | 'speechRateCpm'
    | 'avgLoudnessDbfs'
    | 'medianF0Hz'
    | 'f0LiftSemitones'
    | 'loudnessLiftDb'
    | 'fluencyScore';
  bands?: QuantMetricBand[];
  /**
   * 锚点线性插值（优先于 bands）：按 value 升序排列，命中区间在两锚点间线性插值，
   * 消除区间边界的分数悬崖；支持钟形评分（锚点分数先升后降）
   */
  points?: QuantMetricPoint[];
  /** 块内权重（缺省 1）；区分度弱的指标可降权，如 0.3 */
  weight?: number;
}

/**
 * 确定性定量计分规则：配置后该标准跳过 LLM 打分，由代码按语音量化数据查表计分
 * （块得分 = 各 metric 区间得分按 weight 加权平均 / 100 × maxScore，weight 缺省 1，
 * 缺数据的 metric 按 50 分计），LLM 只负责根据已定分数写评语与话术建议，无法再自由改分。
 */
export interface QuantitativeRule {
  blocks: Array<{
    /** 计分块名（如 激情度/语速/音调/音量） */
    label: string;
    maxScore: number;
    metrics: QuantMetricRule[];
  }>;
}

/** 学员个人语音基线（平静状态的音高中位数与响度）：用于计算音高/响度抬升；存于用户 preferences.voiceBaseline */
export interface VoiceBaseline {
  medianF0Hz: number;
  avgLoudnessDbfs: number;
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
  /**
   * 打分模式：levels=按档位判定（默认）；score=直接打分（0-100，评分标准在行为锚定中自定维度与分值，
   * 如"总分100=激情60+语速20+音量20"），judge 按锚定直接给出总分
   */
  scoringMode?: 'levels' | 'score';
  /** 信心指数调整项：score 为扣减参数，用于换算全局信心指数，不参与基础分加权平均 */
  deductionOnly?: boolean;
  /** 确定性定量计分规则（仅 score 模式）：配置后跳过 LLM 打分，按语音量化数据查表计分 */
  quantitativeRule?: QuantitativeRule;
  /** 定量评分使用的语音统计通道：缺省=对家长/客户的学员轮次；'child'=只统计对孩子说的轮次（与孩子说话的语气类标准） */
  voiceChannel?: 'child';
}

export interface ImprovementCandidate {
  title: string;
  /** 对最终分数的预估影响，数值越大越应优先改进 */
  impact: number;
  rationale: string;
  suggestion: string;
  quoteTurnSeq?: number;
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
  /** true 时 score 为信心指数扣减参数，而非该项百分制得分 */
  isDeduction?: boolean;
  layer: 'company' | 'team' | 'personal';
  /** 本评分项内可单独改进的问题，供报告只选择最高影响的一项 */
  improvementCandidates?: ImprovementCandidate[];
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
  /** 忌讳调整前的加权基础分 */
  baseScore?: number;
  /** 全局信心指数（0.2～1）：总分 = 基础分 × 信心指数 */
  confidenceIndex?: number;
  passed: boolean;
  /** 未完成演练也会生成报告，但不给完成分并强制未通过 */
  completionStatus?: 'completed' | 'incomplete';
  /** 未完成的具体原因与改进依据 */
  completionReason?: string;
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
    /** 表达流畅度（0-100）：100 为流畅，每次明显停顿扣 15 分、每个口头禅扣 5 分，最低 0 分 */
    fluencyScore?: number;
    /** 学员语音声学特征聚合（来自各语音轮的录音分析；纯文字对练时缺省） */
    voice?: {
      /** 有声学特征的语音轮数 */
      turns: number;
      /** 平均响度 dBFS（按说话时长加权的各轮均值） */
      avgLoudnessDbfs: number;
      /** 响度动态范围 dB（各轮 P90-P10：整场均值×0.5 + 峰值轮×0.5，峰值轮要求 ≥2s 有声） */
      loudnessRangeDb: number;
      /** 音调变化幅度（F0 半音标准差：整场均值×0.5 + 峰值轮×0.5；全部轮不可测时为 null） */
      pitchVarSemitones: number | null;
      /** 真实语速（字/分钟，学员语音轮总字数 / 实际说话总时长） */
      speechRateCpm: number;
      /** 音高中位数 Hz（整场各轮 F0 中位数的融合值；不可测为 null） */
      medianF0Hz?: number | null;
      /** 音高抬升（半音）：相对该学员个人平静基线的音高提升，激情"音高抬升"型的核心量；无基线时为 null */
      f0LiftSemitones?: number | null;
      /** 响度提升 dB：相对该学员个人平静基线的响度差；无基线时为 null */
      loudnessLiftDb?: number | null;
    };
    /** 对孩子说的学员轮次数（无论有无语音）；0 表示本场未与孩子对话 */
    childDialogueTurns?: number;
    /** 对孩子说的学员轮次的独立声学聚合（结构同 voice；无孩子对话时缺省），供「与孩子说话的语气」类标准评分 */
    voiceChild?: {
      turns: number;
      avgLoudnessDbfs: number;
      loudnessRangeDb: number;
      pitchVarSemitones: number | null;
      speechRateCpm: number;
      medianF0Hz?: number | null;
      f0LiftSemitones?: number | null;
      loudnessLiftDb?: number | null;
    };
  };
  /** 教练总结（LLM 生成，失败时回退模板文案） */
  summary?: string;
  /** 对最终分数影响最大的单一改进目标与具体建议 */
  improvementGoal?: ImprovementCandidate;
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

/**
 * 改进建议库：点评/改进建议的唯一来源（替代代码内硬编码文案）。
 * key 为稳定规则键（如 ground-push-incomplete / taboo-deterministic / generic-goal / summary-fallback），
 * category 为业务分类（地推/电销/咨询接待/现场成交），缺省=通用；
 * data 为该规则组的结构化内容（阶段定义、建议文本、模板等），由评分引擎按键读取。
 */
export interface SuggestionRule {
  id: string;
  tenantId: string;
  name: string;
  key: string;
  category?: ScoreCategory;
  data: Record<string, unknown>;
  version?: number;
  createdBy?: string;
  updatedBy?: string;
}
