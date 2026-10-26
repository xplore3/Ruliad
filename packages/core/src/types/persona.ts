/** 角色引擎相关类型 */

/** 行为映射档位：按唤醒度区间选择生成指令 */
export interface BehaviorBand {
  /** 区间 [minArousal, maxArousal) */
  minArousal: number;
  maxArousal: number;
  /** 档位名，如 calm / guarded / annoyed */
  key: string;
  /** 注入本轮生成的行为指令 */
  instruction: string;
}

export interface KnowledgeBoundary {
  /** 该角色不该知道的事（泄露即出戏） */
  mustNotKnow: string[];
  /** 该角色额外加载的知识（如懂行客户的竞品对比） */
  loadedKnowledge: string[];
}

export interface PersonaConfig {
  id: string;
  tenantId: string;
  name: string;
  /** 展示给学员的背景简介（不含要素参数） */
  background: string;
  age?: number;
  occupation?: string;
  /** 引用的要素 id 列表（只允许向下引用：tenant -> industry -> platform） */
  elementIds: string[];
  /** 引用的产品知识库 id（可选；运行时编译时注入产品参数/红线/竞品/FAQ） */
  productKBId?: string;
  /** 三档行为映射（MVP 单变量） */
  behaviorBands: BehaviorBand[];
  knowledgeBoundary: KnowledgeBoundary;
  /** TTS 声线配置 */
  voiceProfile?: Record<string, unknown>;
  /** 角色头像 URL */
  avatar?: string;
  /** 客户认知来源信息（资产中心客户角色卡口径） */
  sourceMeta?: {
    /** 细分人群卡标题（如「三甲医院 · 学术型主任」） */
    archetype?: string;
    /** 构建来源段数（录音/访谈） */
    recordings: number;
    /** 来源类型（如「真实录音」「访谈」） */
    recordingsKind?: string;
    /** 最后校准月份（如「2026-06」） */
    lastCalibrated: string;
    /** 累计被练习次数 */
    practiceCount: number;
    /** 认知可能过期（超 6 个月未校准） */
    stale?: boolean;
    /** 校准状态（如「已校准」「待校准」） */
    calibrationStatus?: string;
  };
  version: number;
}

/** 编译产物：运行时包 */
export interface PersonaRuntimeBundle {
  personaConfigId: string;
  systemPrompt: string;
  behaviorBands: BehaviorBand[];
  knowledgeBoundary: KnowledgeBoundary;
  /** E 类要素动力学合并结果 */
  dynamics: {
    triggers: import('./element.js').EmotionTrigger[];
    decayPerTurn: number;
    baseArousal: number;
  };
}
