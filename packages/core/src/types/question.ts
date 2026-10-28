/** 客户提问问题库 */

export interface CustomerQuestion {
  id: string;
  tenantId: string;
  /** 分类（如 价格 / 效果 / 竞品 / 服务） */
  category: string;
  /** 客户提问原文 */
  question: string;
  /** 参考应答要点 */
  referenceAnswer?: string;
  /** 难度 1-3 */
  difficulty?: number;
  /** 关联技能点 */
  skillPointIds?: string[];
  /** 实战出现频率 % */
  frequency?: number;
}
