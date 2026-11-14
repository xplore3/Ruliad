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

export type ScenarioStatus = 'draft' | 'published';
export type ScenarioFlowType = 'generic' | 'ground_push' | 'reception';
export type InterruptLevel = 'off' | 'weak' | 'strong';

export function effectiveScenarioFlow(scenario: Pick<Scenario, 'category' | 'flowType'>): ScenarioFlowType {
  if (scenario.flowType) return scenario.flowType;
  if (scenario.category === '地推') return 'ground_push';
  if (scenario.category === '咨询接待') return 'reception';
  return 'generic';
}

export interface ConversationSettings {
  speechRate: 1 | 2 | 3;
  challenge: number;
  interruptLevel: InterruptLevel;
}

export interface Scenario {
  id: string;
  tenantId: string;
  name: string;
  personaConfigId: string;
  /** 场景级产品知识库 id（可选；优先于 PersonaConfig.productKBId） */
  productKBId?: string;
  /** 场景级演练剧本引用；不再按分类隐式选择剧本 */
  drillScriptId?: string;
  /**
   * 双场制演练开关（场景编辑器配置，仅地推/现场成交适用）：
   * 开启且绑定演练剧本时，第一小场固定"不感兴趣/最终拒绝"客户，切场后进入第二小场；
   * 两小场的客户行为规则由剧本库文本承载，此开关只控制是否启用双场编排。
   */
  dualSceneEnabled?: boolean;
  /** 场景级评分标准引用；定义后评分只使用这些标准 */
  scoreItemIds?: string[];
  skillPointIds: string[];
  successCriteria: SuccessCriteria;
  /** 预计时长分钟数；指引倒计时存在时由指引覆盖 */
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
  /** 统一业务分类，同时用于展示、剧本和评分资源筛选 */
  category?: ScoreCategory;
  /** 执行策略；缺省按历史分类兼容，新场景应显式保存 generic 或专项策略 */
  flowType?: ScenarioFlowType;
  /** 剧本（实用场景） */
  script?: ScenarioScript;
  /** 参与者设定 */
  participants?: ScenarioParticipant[];
  /** 对话参数的结构化真相源，供编辑器无损反填 */
  conversation?: ConversationSettings;
  /** 场景版本与发布状态；缺省按已发布 v1 兼容存量数据 */
  version?: number;
  status?: ScenarioStatus;
  createdBy?: string;
  updatedBy?: string;
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
