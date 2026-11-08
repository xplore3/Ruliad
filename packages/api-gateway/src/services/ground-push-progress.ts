import type { LLMProvider, TranscriptTurn } from '@grasp-mvp/core';

export interface GroundPushProgressAssessment {
  substantive: boolean;
  reason: string;
}

export async function assessGroundPushProgress(
  llm: LLMProvider,
  transcript: TranscriptTurn[],
  lastChance: boolean
): Promise<GroundPushProgressAssessment> {
  const context = transcript
    .slice(-8)
    .map((turn) => `${turn.speaker === 'trainee' ? '销售' : turn.speaker === 'persona' ? '客户' : turn.speaker === 'child' ? '孩子' : '旁白'}：${turn.text}`)
    .join('\n');
  try {
    const result = await llm.chat([
      {
        role: 'system',
        content:
          '你是地推主动推进判定器。地推必须由销售主导局面，客户的中性话语只是销售推进的机会，不能由客户替销售推进。' +
          '销售完成必要介绍后，应主动售卖邀请函并引导客户完成下一步。实质推进包括：明确递出并售卖邀请函、引导填写姓名或联系方式、引导选择并完成支付方式、明确约定到校或体验时间。' +
          '与成交相关的必要介绍和简洁答疑在介绍阶段属于正常推进；但介绍完成后仍漫无目的闲聊、只解释不行动、等待客户表态、反复说“您可以来看看/来试听”而没有当场行动，都不算实质推进。' +
          '客户主动问“试听流程是什么”“接下来怎么办”不代表销售主动，销售仍必须自己提出下一步行动。' +
          (lastChance
            ? '当前是客户说“我回去琢磨琢磨”后的最后一次机会：只有坚持并作出上述明确成交行动才 substantive=true；退缩、道别、空泛邀请、继续介绍或闲聊都必须 substantive=false。'
            : '当前尚在正常演练：必要且不过度的课程、活动或邀请函介绍可以 substantive=true；如果已有足够介绍仍没有成交动作，应 substantive=false。') +
          '只输出JSON：{"substantive":true或false,"reason":"简短说明学员原话是否构成实质推进"}',
      },
      { role: 'user', content: `最近对话：\n${context}\n\n请判断销售最新一轮是否作出了当前阶段应有的实质推进。` },
    ], { jsonMode: true, temperature: 0, maxTokens: 300 });
    const parsed = JSON.parse(result.content) as { substantive?: unknown; reason?: unknown };
    return { substantive: parsed.substantive === true, reason: String(parsed.reason ?? '') };
  } catch {
    return { substantive: true, reason: '推进判定异常，保守继续演练' };
  }
}
