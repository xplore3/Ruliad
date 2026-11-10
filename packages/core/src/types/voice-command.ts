export type VoiceEditCommandStatus = 'previewed' | 'applied' | 'pending_review' | 'in_review' | 'resolved' | 'rejected';

/** 处理策略：直接修改 / 复制后修改（copy-on-write）/ 通用建议 */
export type VoiceConfigScope = 'direct' | 'copy-on-write' | 'general';

/** 单条执行计划操作 */
export interface VoiceConfigOperation {
  /** 稳定标识，供其它操作通过 ref 引用其产物 id */
  key?: string;
  /** 引用其它操作的产物 id（与 rebind.ref 不同，用于 patch 内引用，如新角色 id） */
  ref?: string;
  kind:
    | 'create-persona'
    | 'update-persona'
    | 'copy-persona'
    | 'create-scenario'
    | 'update-scenario'
    | 'create-resource'
    | 'update-resource'
    | 'copy-resource';
  /** 资源类型（target）；persona/scenario 专用操作可省略 */
  target?: string;
  /** 已有资源 id（update/copy 用） */
  id?: string;
  /** 资源名称（create 用） */
  name?: string;
  patch: Record<string, unknown>;
  /** 场景版本号（带乐观锁的 update 用） */
  expectedVersion?: number;
  /** 场景字段重绑：把旧资源 id 替换为 ref 指向的新副本 id */
  rebind?: { field: string; mode: 'single' | 'list'; oldId: string; ref: string };
  /** 该操作本身是否属于通用/共享内容 */
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

/** 历史演练诊断证据及本次增量修改说明 */
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
  /** 是否涉及公共能力、共享数据或跨场景通用问题 */
  general: boolean;
  generalReason?: string;
  affectedScenarioIds: string[];
  status: VoiceEditCommandStatus;
  reviewNote?: string;
  reviewedBy?: string;
  createdAt: string;
  updatedAt: string;

  // ===== 统一语音流程（voice-config）扩展字段 =====
  /** LLM 识别的原始对象描述（名称/特征），用于服务端自动定位 */
  subject?: string;
  /** 新建资源时的名称 */
  resourceName?: string;
  /** 当前已定位到的资源 id */
  resolvedResourceId?: string;
  /** 执行计划（创建/修改/复制/绑定） */
  plan?: VoiceConfigPlan;
  /** 整条命令的处理策略 */
  scope?: VoiceConfigScope;
  scopeReason?: string;
  /** 影响范围快照（场景 id + 名称） */
  impactScenarios?: Array<{ id: string; name: string }>;
  /** 场景操作涉及的角色补丁 */
  personaPatch?: Record<string, unknown>;
  /** 场景绑定的技能点 / 评分标准 / 演练剧本名称（服务端解析为 ID） */
  skillPointNames?: string[];
  scoreItemNames?: string[];
  drillScriptName?: string;
  /** 混合命令中提炼出的通用建议 */
  suggestions?: VoiceCommandSuggestion[];
  /** 诊断并修改任务的历史证据 */
  diagnoses?: VoiceConfigDiagnosis[];
}
