import type { DataLayer } from './org.js';

/** 要素类型：C=认知 E=情绪 B=行为 S=情境 */
export type ElementType = 'C' | 'E' | 'B' | 'S';

/** E 类要素的情绪触发器（E2 触发器） */
export interface EmotionTrigger {
  id: string;
  /** 命中模式：关键词列表（任一命中即触发） */
  keywords: string[];
  /** 触发后唤醒度增量 */
  escalation: number;
  description: string;
}

/** E 类要素的动力学参数 */
export interface EmotionDynamics {
  triggers: EmotionTrigger[];
  /** 每轮自然衰减 */
  decayPerTurn: number;
  /** 初始唤醒度 */
  baseArousal: number;
}

export interface Element {
  id: string;
  type: ElementType;
  layer: DataLayer;
  /** 租户私有要素非空；platform/industry 要素为空 */
  tenantId?: string;
  name: string;
  version: number;
  /** 要素正文（人设素材/信念/行为模式描述） */
  content: string;
  /** 仅 E 类要素有 */
  dynamics?: EmotionDynamics;
}

/** 校准事件：评分申诉结论/角色失真反馈，归因到要素 */
export interface CalibrationEvent {
  id: string;
  elementId?: string;
  scoreItemId?: string;
  kind: 'appeal_upheld' | 'appeal_rejected' | 'persona_distortion' | 'rubric_misjudge';
  note: string;
  sourceSessionId?: string;
  createdAt: string;
}
