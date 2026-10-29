/**
 * 资源库 ↔ 执行环节对照
 * 新手指引五步流程 = 资格提问→示范→讲解→演练→评分。
 * 资源库对照：
 * - 资格提问 = ScenarioGuidance.qualifyQuestions
 * - 示范 = ScenarioGuidance.demo + 示范问答库(DemoFaq)
 * - 讲解 = ScenarioGuidance.keyPoints + 讲解标准库(BriefingStandard)
 * - 演练 = ScenarioGuidance(difficultyLevels/realismStandardIds/duration/liveIntro/voiceProfile) + 演练真实度标准库(RealismStandard)
 * - 评分 = 评分标准库(ScoreItemDef) + ScenarioGuidance.scoringFocus
 */

export type DemoRole = 'sales' | 'customer' | 'child' | 'narrator';

export interface DemoLine {
  role: DemoRole;
  text: string;
  arousal?: number;
  excitement?: number;
}

/** 示范剧本变量：choice 随机选项 / intRange 随机整数 / map 由另一变量映射（如 address→parent） */
export type DemoVariable =
  | { kind: 'choice'; options: string[] }
  | { kind: 'intRange'; min: number; max: number }
  | { kind: 'map'; from: string; mapping: Record<string, string> };

/** 示范剧本模板：text 中可含 ${name} 与 ${faq1.question} ${faq1.answer} 占位符 */
export interface DemoScriptTemplate {
  lines: DemoLine[];
  variables?: Record<string, DemoVariable>;
  /** 从 FAQ 池随机抽取条数，渲染为 faq1..faqN */
  faqPick?: number;
  /** FAQ 池标识（如 'ground-push-demo-faq'） */
  faqPoolRef?: string;
}

/** 讲解标准库条目（新手指引第3步「讲解」环节，composeBriefing 口播稿引用） */
export interface BriefingStandard {
  id: string;
  tenantId: string;
  name: string;
  /** 'tone' 语调 | 'pace' 语速 | 'method' 关键方法 | 'etiquette' 礼仪 */
  category: string;
  description: string;
  example?: string;
}

/** 演练真实度标准库条目（第4步：AI 客户逼真度标准） */
export interface RealismStandard {
  id: string;
  tenantId: string;
  name: string;
  /** 'reaction' 反应自然度 | 'objection' 拒绝行为 | 'stalling' 拖延行为 | 'emotion' 情绪变化 */
  category: string;
  description: string;
}

/** 难度系数说明参数（第4步） */
export interface DifficultyLevel {
  /** 1~5 */
  level: number;
  /** 如 '温和客户' */
  label: string;
  /** 难度说明 */
  description: string;
  /** 对 AI 客户行为的要求（供 role-engine prompt 使用） */
  customerBehavior: string;
}

/** 时长参数（第4步） */
export interface DurationParams {
  targetMinutes: number;
  minTurns: number;
  maxTurns: number;
  countdownSeconds: number;
}

export interface VoiceProfile {
  style: string;
  arousal: number;
  excitement?: number;
  rate?: number;
}

export interface LiveIntro {
  narration: string;
  goal: string;
}

/** 新手指引流程配置：五步流程的场景级配置 */
export interface ScenarioGuidance {
  id: string;
  tenantId: string;
  scenarioId: string;
  name: string;
  /** 第1步 资格提问 */
  qualifyQuestions: string[];
  /** 第2步 示范剧本；null=无示范模式 */
  demo: DemoScriptTemplate | null;
  /** 第3步 讲解要点 */
  keyPoints: string[];
  /** 第3步 讲解标准库引用 */
  briefingStandardIds: string[];
  voiceProfile: VoiceProfile;
  /** 第4步 演练旁白+目标 */
  liveIntro: LiveIntro;
  /** 第4步 演练真实度标准库引用 */
  realismStandardIds: string[];
  /** 第4步 难度系数说明参数 */
  difficultyLevels: DifficultyLevel[];
  defaultDifficulty: number;
  /** 第4步 时长参数 */
  duration: DurationParams;
  /** 第5步 重点评分维度 */
  scoringFocus: string[];
}
