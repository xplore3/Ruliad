import type { LLMProvider, PersonaRuntimeBundle } from '@grasp-mvp/core';

/** AI 自曝关键词（出戏） */
const AI_DISCLOSURE_KEYWORDS = [
  '作为AI',
  '作为ai',
  '我是AI',
  '我是ai',
  '人工智能',
  '语言模型',
  'AI助手',
  'AI 助手',
  'Ai助手',
];

/** 考核/评分泄露关键词 */
const EXAM_LEAK_KEYWORDS = [
  '评分标准',
  '考核标准',
  '评分项',
  '考核项',
  '打分标准',
  '给你打分',
  '你的得分',
  '评分明细',
];

export interface ConsistencyResult {
  pass: boolean;
  reasons: string[];
}

/**
 * 同步规则检测：AI 自曝 / 考核标准泄露。
 * 返回违例原因列表，空数组表示通过。
 */
export function ruleCheck(text: string): string[] {
  const reasons: string[] = [];
  const aiHit = AI_DISCLOSURE_KEYWORDS.find((k) => text.includes(k));
  if (aiHit) reasons.push(`AI 身份泄露：命中「${aiHit}」`);
  const examHit = EXAM_LEAK_KEYWORDS.find((k) => text.includes(k));
  if (examHit) reasons.push(`考核信息泄露：命中「${examHit}」`);
  return reasons;
}

interface LlmCheckParsed {
  pass?: boolean;
  reason?: string;
}

/**
 * 一致性校验：先跑同步规则，通过后由 judge 任务 LLM 做语义校验
 * （是否出戏 / 是否泄露知识边界 mustNotKnow 中的信息）。
 * LLM 输出解析失败时按通过处理（不误杀）。
 */
export async function checkConsistency(
  llm: LLMProvider,
  bundle: PersonaRuntimeBundle,
  replyText: string
): Promise<ConsistencyResult> {
  const ruleReasons = ruleCheck(replyText);
  if (ruleReasons.length > 0) {
    return { pass: false, reasons: ruleReasons };
  }

  const mustNotKnow = bundle.knowledgeBoundary.mustNotKnow;
  const prompt = [
    '你是对练角色的一致性审查员。判断下面的角色回复是否违例：',
    '1) 暴露自己是 AI / 机器人 / 程序；',
    '2) 泄露考核、评分、打分相关信息；',
    mustNotKnow.length > 0
      ? `3) 表现出知道以下该角色不该知道的事：${mustNotKnow.join('；')}。`
      : '3) （该角色无额外知识边界）',
    `角色回复：${replyText}`,
    '请只输出 JSON：{"pass":true|false,"reason":"违例原因（通过时为空字符串）"}',
  ].join('\n');

  try {
    const result = await llm.chat([{ role: 'user', content: prompt }], { jsonMode: true });
    const parsed = JSON.parse(result.content) as LlmCheckParsed;
    if (parsed.pass === false) {
      return { pass: false, reasons: [String(parsed.reason ?? '语义一致性校验未通过')] };
    }
    return { pass: true, reasons: [] };
  } catch {
    return { pass: true, reasons: [] };
  }
}
