/** 用户技能状态与成长档案 */

export interface UserSkillState {
  userId: string;
  skillPointId: string;
  /** 当前档位 0-5 */
  currentLevel: number;
  history: Array<{ at: string; score: number; sessionId: string; mode: 'practice' | 'exam' }>;
  /** 间隔重现计划 */
  nextReviewAt?: string;
}

/** 看板聚合（仅考核数据） */
export interface SkillHeatmapCell {
  teamId: string;
  skillPointId: string;
  passRate: number;
  avgScore: number;
  sampleSize: number;
}

export interface SupervisorDigest {
  teamId: string;
  period: string;
  weakSkills: Array<{ skillPointId: string; skillPointName: string; avgScore: number }>;
  attentionTrainees: Array<{ userId: string; userName: string; reason: string }>;
  coachingTopics: string[];
}
