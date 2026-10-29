/** 内容工坊 / 企业私有数据（数据架构补篇） */

export interface ProductKBEntry {
  id: string;
  /** 要点 | 红线 | 竞品对比 | FAQ */
  kind: 'keypoint' | 'redline' | 'competitor' | 'faq';
  title: string;
  content: string;
  /** 实战出现频率 %（高频异议库口径，仅 faq 类使用） */
  frequency?: number;
}

export interface ProductKB {
  id: string;
  tenantId: string;
  name: string;
  version: number;
  entries: ProductKBEntry[];
  effectiveAt: string;
}

/** KB 版本影响清单 */
export interface KBImpactMap {
  kbId: string;
  fromVersion: number;
  toVersion: number;
  affectedScenarioIds: string[];
  affectedScoreItemIds: string[];
  affectedPersonaConfigIds: string[];
}

/** 销冠萃取项目 */
export interface ExtractionProject {
  id: string;
  tenantId: string;
  name: string;
  /** 录音资产引用 */
  recordingRefs: string[];
  /** 差异点定位记录 */
  diffFindings: Array<{ topic: string; championDid: string; averageDid: string }>;
  /** 回访记录 */
  interviewNotes: string[];
  /** 销冠试打校验结果 */
  trialValidation?: { passed: boolean; note: string; at: string };
  status: 'collecting' | 'analyzing' | 'encoding' | 'validating' | 'done';
  createdAt: string;
}

/** 数据授权：哪些数据允许脱敏聚合到行业层 */
export interface DataConsent {
  id: string;
  tenantId: string;
  scope: string[];
  expiresAt?: string;
  /** 对价说明（如 POC 折扣） */
  consideration?: string;
}

/** 回归测试用例（评分回归对话） */
export interface GoldenCase {
  id: string;
  name: string;
  transcript: Array<{ seq: number; speaker: 'trainee' | 'persona'; text: string }>;
  /** 人工标注的期望判定 */
  expected: Array<{ itemId: string; levelKey: string }>;
}

export interface RegressionRun {
  id: string;
  at: string;
  totalCases: number;
  matched: number;
  /** 误判率 */
  errorRate: number;
  passed: boolean;
  details: Array<{ caseId: string; itemId: string; expected: string; actual: string; match: boolean }>;
}
