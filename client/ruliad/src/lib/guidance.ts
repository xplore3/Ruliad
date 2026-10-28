/** 场景新手指引包类型（GET /scenarios/:id/guidance，与后端契约一致） */

/** 示范对话台词（结构与 api.ts 的 DemoLine 一致，此处独立定义避免循环依赖） */
export interface GuidanceDemoLine {
  role: 'sales' | 'customer' | 'child' | 'narrator';
  text: string;
  /** TTS 情绪唤醒度 */
  arousal?: number;
  /** 激情倍率 */
  excitement?: number;
}

export interface ScenarioGuidance {
  /** 第1步资格问题，1~2 条 */
  qualifyQuestions: string[];
  /** 第2步示范剧本；null = 无示范模式（如现场成交），跳过示范直接进讲解 */
  demo: { lines: GuidanceDemoLine[] } | null;
  /** 第3步讲解要点 */
  keyPoints: string[];
  /** 第4步进 live 前的旁白与目标 */
  liveIntro: { narration: string; goal: string };
  duration: {
    targetMinutes: number;
    minTurns: number;
    maxTurns: number;
    /** 进 live 时的倒计时秒数 */
    countdownSeconds: number;
  };
  difficultyLevels: { level: number; label: string; description: string }[];
  defaultDifficulty: number;
}
