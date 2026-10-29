/** 示范问答库：新手指引五步流程第2步「示范」环节的 FAQ 池（renderDemoScript 渲染示范剧本时抽取）；不参与实时对练——对练中客户提问读 Scenario.script.customerQuestions */

export interface DemoFaq {
  id: string;
  tenantId: string;
  /** 分类（如 价格 / 效果 / 竞品 / 服务） */
  category: string;
  /** 示范问答原文 */
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
