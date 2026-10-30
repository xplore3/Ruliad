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

/** 定量计分 metric：语音声学量化数据之一 */
export interface QuantMetricRule {
  metric: 'pitchVarSemitones' | 'loudnessRangeDb' | 'speechRateCpm' | 'avgLoudnessDbfs';
  bands: QuantMetricBand[];
}

/**
 * 确定性定量计分规则：配置后该标准跳过 LLM 打分，由代码按语音量化数据查表计分
 * （块得分 = 各 metric 区间得分的均值 / 100 × maxScore，缺数据的 metric 按 50 分计），
 * LLM 只负责根据已定分数写评语与话术建议，无法再自由改分。
 */
export interface QuantitativeRule {
  blocks: Array<{
    /** 计分块名（如 激情度/语速/音调/音量） */
    label: string;
    maxScore: number;
    metrics: QuantMetricRule[];
  }>;
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
  /** 确定性定量计分规则（仅 score 模式）：配置后跳过 LLM 打分，按语音量化数据查表计分 */
  quantitativeRule?: QuantitativeRule;
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
    /** 学员语音声学特征聚合（来自各语音轮的录音分析；纯文字对练时缺省） */
    voice?: {
      /** 有声学特征的语音轮数 */
      turns: number;
      /** 平均响度 dBFS（按说话时长加权的各轮均值） */
      avgLoudnessDbfs: number;
      /** 响度动态范围 dB（各轮 P90-P10 的加权均值） */
      loudnessRangeDb: number;
      /** 音调变化幅度（F0 半音标准差，加权均值；全部轮不可测时为 null） */
      pitchVarSemitones: number | null;
      /** 真实语速（字/分钟，学员语音轮总字数 / 实际说话总时长） */
      speechRateCpm: number;
    };
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
