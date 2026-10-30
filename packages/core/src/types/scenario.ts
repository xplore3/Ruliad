/** 场景 / 技能点 / 学习路径 */

import type { ScoreCategory } from './scoring.js';

export interface SkillPoint {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  /** 打法资产展示名（如「张伟三步破冰法」），缺省用 name */
  assetName?: string;
  /** 署名作者（如「张伟（华东销冠）」） */
  author?: string;
  /** 技能地图来源文案（如「来自 张伟（华东销冠）」） */
  source?: string;
  /** 累计被练习/引用次数（资产中心口径） */
  practiceCount?: number;
  /** 最优档达成率 %（资产中心 Top 资产口径；样本不足时为空） */
  achievementRate?: number;
  /** 资产验证徽章 */
  badge?: '已验证' | '观察中' | '待复审';
  /** 技能地图锁定展示 */
  locked?: boolean;
}

export interface SuccessCriteria {
  /** 达标分数线（0-100） */
  passScore: number;
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
  /** 参与者名称/角色 */
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
  /** 场景级产品知识库 id（可选；优先于 PersonaConfig.productKBId） */
  productKBId?: string;
  skillPointIds: string[];
  successCriteria: SuccessCriteria;
  /** 硬上限分钟数（8-15） */
  durationMinutes: number;
  difficulty: number;
  /** 要求学员覆盖的话题点（规则层 coverage 检查） */
  coverageTopics?: string[];
  /** 场景背景描述（展示 + 编译进角色 prompt；不参与 coverage 字面匹配） */
  description?: string;
  /** 客户侧一句话设定（如「冷淡型客户，时间只给 8 分钟」） */
  personaTitle?: string;
  /** 训练方法论标签（如「张伟三步破冰法 · L2」） */
  methodology?: string;
  /** 场景来源（如「官方」「企业定制」） */
  source?: string;
  /** 场景类型（缺省视为 practical，兼容存量数据） */
  sceneType?: SceneType;
  /** 评分分类：决定评分时选用评分标准库中的哪一类标准；缺省兼容存量数据（不按分类过滤） */
  category?: ScoreCategory;
  /** 剧本（实用场景） */
  script?: ScenarioScript;
  /** 参与者设定 */
  participants?: ScenarioParticipant[];
  /** 累计练习次数（展示口径，由后台维护或种子数据预置） */
  practiceCount?: number;
}

export interface LearningPathItem {
  scenarioId: string;
  passScore: number;
  order: number;
}

export interface LearningPath {
  id: string;
  tenantId: string;
  name: string;
  items: LearningPathItem[];
  assignedTeamIds: string[];
}

/** 场景任务生命周期 */
export type ScenarioTaskStatus = 'locked' | 'available' | 'in_progress' | 'passed' | 'failed_pending_retry';

export interface ScenarioTask {
  userId: string;
  scenarioId: string;
  status: ScenarioTaskStatus;
  bestScore?: number;
  lastSessionId?: string;
  /** 间隔重现复训到期日（D7/D21） */
  reviewDueAt?: string;
  /** 是否间隔复训任务 */
  isReview?: boolean;
}
