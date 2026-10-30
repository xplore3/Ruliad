import type { ScoreCategory } from './scoring.js';

/**
 * 演练剧本：整篇剧情文本（初始内容为对应示范剧本渲染的模板，可在末尾追加演练原则）。
 * 模拟演练开始前交给 LLM 阅读理解，由它决定谁先开口、客户如何回应、何时自然结束。
 */
export interface DrillScript {
  id: string;
  tenantId: string;
  /** 所属演练分类（地推/电销/咨询接待/现场成交） */
  category: ScoreCategory;
  name: string;
  /** 整篇剧本文本（含演练原则说明） */
  content: string;
}
