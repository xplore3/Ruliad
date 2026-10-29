import type { DemoLine, DemoVariable } from './guidance.js';

/** 示范剧本库条目：新手指引五步第2步「示范」的 AI 双人对戏剧本；按业务线分支（地推/电销/接待咨询/课程顾问），category 为自由字符串 */
export interface DemoScript {
  id: string;
  tenantId: string;
  /** 业务线分支：地推 / 电销 / 接待咨询 / 课程顾问 */
  category: string;
  name: string;
  lines: DemoLine[];
  variables?: Record<string, DemoVariable>;
  faqPick?: number;
  faqPoolRef?: string;
}
