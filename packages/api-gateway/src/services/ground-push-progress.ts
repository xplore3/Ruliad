import type { LLMProvider, SuggestionRule, TranscriptTurn } from '@grasp-mvp/core';
import { suggestionData, SUGGESTION_KEYS } from '@grasp-mvp/scoring-engine';

export interface GroundPushProgressAssessment {
  substantive: boolean;
  reason: string;
}

interface ProgressRuleData {
  intro: string;
  lastChance: string;
  normal: string;
  fallbackReason: string;
}

export async function assessGroundPushProgress(
  llm: LLMProvider,
  transcript: TranscriptTurn[],
  lastChance: boolean,
  rules?: SuggestionRule[]
): Promise<GroundPushProgressAssessment> {
  const context = transcript
    .slice(-8)
    .map((turn) => `${turn.speaker === 'trainee' ? '销售' : turn.speaker === 'persona' ? '客户' : turn.speaker === 'child' ? '孩子' : '旁白'}：${turn.text}`)
    .join('\n');
  // 判定规则来自改进建议库（ground-push-progress），可在场景编辑器中调整白名单
  const rule = suggestionData<ProgressRuleData>(rules, SUGGESTION_KEYS.groundPushProgress, '地推');
  try {
    const result = await llm.chat([
      {
        role: 'system',
        content:
          rule.intro +
          (lastChance ? rule.lastChance : rule.normal) +
          '只输出JSON：{"substantive":true或false,"reason":"简短说明学员原话是否构成实质推进"}',
      },
      { role: 'user', content: `最近对话：\n${context}\n\n请判断销售最新一轮是否作出了当前阶段应有的实质推进。` },
    ], { jsonMode: true, temperature: 0, maxTokens: 1000 });
    const parsed = JSON.parse(result.content) as { substantive?: unknown; reason?: unknown };
    return { substantive: parsed.substantive === true, reason: String(parsed.reason ?? '') };
  } catch {
    return { substantive: true, reason: rule.fallbackReason };
  }
}
