/** 场景 / 技能点 / 学习路径 */

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
  /** 客户侧一句话设定（如「冷淡型客户，时间只给 8 分钟」） */
  personaTitle?: string;
  /** 训练方法论标签（如「张伟三步破冰法 · L2」） */
  methodology?: string;
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
