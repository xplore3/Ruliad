import type {
  ContentPart,
  LLMGateway,
  Scenario,
  Session,
  VideoReview,
} from '@grasp-mvp/core';

/** 组装视频评审 prompt 的文本部分：场景背景 + 对话转写摘要 + 输出要求 */
function buildVideoJudgeText(session: Session, scenario: Scenario, frameCount: number): string {
  const transcriptLines = session.transcript
    .filter((t) => t.speaker !== 'coach')
    .map((t) => `[${t.seq}] ${t.speaker === 'trainee' ? '学员' : '客户'}：${t.text}`)
    .join('\n');
  return [
    '你是一名销售训练评审专家。以下是学员与客户对练的视频关键帧（按时间顺序均匀截取）与对话转写。',
    '请仅根据画面中学员的正面表现（表情、眼神、仪态、口型与发声状态）进行评审，不要评价话术内容（话术另有评审）。',
    `场景：${scenario.name}${scenario.personaTitle ? `（${scenario.personaTitle}）` : ''}`,
    '对话记录：',
    transcriptLines || '（无）',
    `随附 ${frameCount} 张视频关键帧。`,
    '请只输出 JSON：{"expressionScore":0-100整数,"eyeContact":"眼神交流评价","expression":"表情/情绪表达评价","lipSyncNote":"口型与发声状态评价","suggestions":["改进建议"],"summary":"总体评语"}',
    '要求：各项评价一句话、具体可操作；suggestions 最多 3 条；全部用中文。',
  ].join('\n');
}

/** 解析视频评审输出；失败时返回 null（调用方跳过该维度） */
function parseVideoReview(content: string): VideoReview | null {
  try {
    const parsed = JSON.parse(content) as Partial<VideoReview>;
    const score = Number(parsed.expressionScore);
    if (!Number.isFinite(score)) return null;
    return {
      expressionScore: Math.max(0, Math.min(100, Math.round(score))),
      eyeContact: String(parsed.eyeContact ?? ''),
      expression: String(parsed.expression ?? ''),
      lipSyncNote: String(parsed.lipSyncNote ?? ''),
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map((s) => String(s)).filter(Boolean).slice(0, 3)
        : [],
      summary: String(parsed.summary ?? ''),
    };
  } catch {
    return null;
  }
}

/**
 * 视频表现评审（多模态 judge）：基于对练录像关键帧评价学员的表情/眼神/口型。
 * 独立维度，不计入总分。provider 为 mock、非视觉模型调用失败、输出解析失败时返回 null，
 * 由调用方决定跳过——不阻断主评分。
 */
export async function judgeVideo(
  session: Session,
  scenario: Scenario,
  frames: string[],
  gateway: LLMGateway
): Promise<VideoReview | null> {
  if (frames.length === 0) return null;
  const provider = gateway.forTask('video_judge');
  if (provider.name === 'mock') return null;

  const content: ContentPart[] = [
    { type: 'text', text: buildVideoJudgeText(session, scenario, frames.length) },
    ...frames.map((url): ContentPart => ({ type: 'image_url', image_url: { url } })),
  ];

  try {
    const result = await provider.chat([{ role: 'user', content }], { jsonMode: true });
    return parseVideoReview(result.content);
  } catch {
    return null;
  }
}
