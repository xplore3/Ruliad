/** 对练考题类型与数据结构 */

/** 考题类型 */
export type QuizType =
  | 'single_choice'
  | 'multi_choice'
  | 'true_false'
  | 'short_answer'
  | 'scenario_pick';

/** 考题触发时机 */
export type QuizTrigger =
  | { kind: 'turn_count'; afterNTurns: number }
  | { kind: 'keyword_hit'; keywords: string[] }
  | { kind: 'topic_covered'; topic: string }
  | { kind: 'time_elapsed'; seconds: number }
  | { kind: 'manual' };

/** 考题定义（管理端配置） */
export interface QuizQuestion {
  id: string;
  tenantId: string;
  /** 绑定场景（可选；不绑则全场景通用） */
  scenarioId?: string;
  /** 关联技能点（评分归属） */
  skillPointId?: string;
  /** 关联产品知识条目 id（可选） */
  productKBEntryId?: string;
  type: QuizType;
  /** 题干 */
  prompt: string;
  /** 选项（选择题/判断题用） */
  options?: { id: string; label: string }[];
  /** 正确答案：选项 id 列表（单选/多选/判断）或文本（简答） */
  correctAnswer: string[] | string;
  /** 简答题的参考答案要点（LLM 判分用） */
  referencePoints?: string[];
  /** 解析（答题后展示） */
  explanation: string;
  /** 分值（纳入最终评分） */
  score: number;
  /** 触发条件 */
  trigger: QuizTrigger;
  /** 是否必答（不答不能继续对练） */
  required: boolean;
}

/** 下发给前端的考题视图：剥离正确答案、参考要点、解析与触发条件 */
export interface QuizQuestionPublic {
  id: string;
  type: QuizType;
  prompt: string;
  options?: { id: string; label: string }[];
  score: number;
  required: boolean;
}

/** 单次答题记录（运行时落 Session） */
export interface QuizResult {
  quizId: string;
  /** 学员答案 */
  answer: string[];
  correct: boolean;
  score: number;
  /** 该题满分（答题时快照，用于汇总 total） */
  maxScore?: number;
  /** 答题时所在对话轮次 seq */
  atTurnSeq: number;
  answeredAt: string;
}

/** 评分报告中考题维度 */
export interface QuizScore {
  earned: number;
  total: number;
  results: Array<{ quizId: string; correct: boolean; score: number }>;
}
