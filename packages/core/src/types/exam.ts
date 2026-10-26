/** 考核与认证 */

export type ExamWindowStatus = 'draft' | 'open' | 'closed' | 'published';

export interface ExamWindow {
  id: string;
  tenantId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  scenarioIds: string[];
  userIds: string[];
  status: ExamWindowStatus;
  /** 补考间隔天数 */
  retakeCooldownDays: number;
  /** 监考规则（可选） */
  proctoring?: {
    /** 禁用教练提示（exam 本就禁用，此处显式配置） */
    disableHints: boolean;
    /** 单场景最大尝试次数（达到后不能再开该场景 exam 会话） */
    maxAttemptsPerScenario?: number;
    /** 允许的最大切屏次数，超过自动交卷 */
    maxTabSwitches?: number;
  };
}

export interface CertRecord {
  id: string;
  tenantId: string;
  userId: string;
  examWindowId: string;
  passed: boolean;
  totalScore: number;
  /** skillPointId -> score */
  skillDetail: Record<string, number>;
  sessionIds: string[];
  issuedAt: string;
}
