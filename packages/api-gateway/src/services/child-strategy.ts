import type { LLMProvider, TranscriptTurn } from '@grasp-mvp/core';

export interface ChildStrategyAssessment {
  effective: boolean | null;
  reason: string;
}

export function isStoryOfferQuestion(text: string): boolean {
  return /讲.{0,4}故事/.test(text) && /好不好|可以吗|想听吗|要不要|愿不愿意|行吗|好吗/.test(text);
}

export function isChildClosedQuestion(text: string): boolean {
  if (isStoryOfferQuestion(text)) return false;
  return /喜欢吗|想学吗|想去吗|要不要学|愿不愿意|好不好/.test(text);
}

export async function assessChildStrategy(
  llm: LLMProvider,
  transcript: TranscriptTurn[]
): Promise<ChildStrategyAssessment> {
  const context = transcript
    .slice(-8)
    .map((turn) => `${turn.speaker === 'trainee' ? '销售' : turn.speaker === 'persona' ? '家长' : turn.speaker === 'child' ? '孩子' : '旁白'}：${turn.text}`)
    .join('\n');
  try {
    const result = await llm.chat([
      {
        role: 'system',
        content:
          '你是地推与孩子沟通策略判定器。有效策略有两种路线：' +
          '1. 假定成交路线：销售不征求孩子意见，直接开始讲有趣故事或做有趣游戏。故事/游戏必须实际讲出来且有具体内容，能逗孩子开心；只承诺“我给你讲故事”不算。此路线不要求先给情感支持。' +
          '2. 完整策略路线：销售先给孩子情感支持（尊重、鼓励、关注、陪伴），再实际讲出能逗孩子开心的故事或做有趣游戏，最后才问孩子是否喜欢或想学。' +
          '如果销售先问了“我给你讲个故事好不好”并被孩子拒绝，之后必须按完整策略路线执行才有效。' +
          '缺少铺垫、顺序错误、只有情感支持没有实际有趣故事、故事乏味或策略不合理时 effective=false。' +
          '铺垫充分后问“你喜欢吗/想学吗/想不想来玩”答案已经确定，不属于封闭式问题；无铺垫直接问则属于封闭式问题。只输出JSON：{"effective":true或false,"reason":"简述依据"}',
      },
      { role: 'user', content: `最近对话：\n${context}\n\n请判断销售目前是否已完成有效的孩子沟通铺垫。` },
    ], { jsonMode: true, temperature: 0, maxTokens: 300 });
    const parsed = JSON.parse(result.content) as { effective?: unknown; reason?: unknown };
    return { effective: parsed.effective === true, reason: String(parsed.reason ?? '') };
  } catch {
    return { effective: null, reason: '策略判定异常，回退孩子角色原判定' };
  }
}
