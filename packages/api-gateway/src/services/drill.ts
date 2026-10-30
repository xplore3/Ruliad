import type { DrillScript, LLMGateway, PersonaRuntimeBundle, Scenario } from '@grasp-mvp/core';
import type { Store } from '@grasp-mvp/infra';

/**
 * 模拟演练剧本服务：
 * 演练剧本库按场景分类取整篇剧情文本，注入客户 prompt 与开场决策，
 * 由 LLM 阅读理解后决定谁先开口、客户如何回应、何时自然结束（shouldClose 见 actor.replyWithSignal）。
 */

/** 从 LLM 输出中提取 JSON 片段（容忍 ```json 包裹与前后杂文本） */
function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : content;
  const start = raw.search(/[[{]/);
  return start >= 0 ? raw.slice(start).trim() : raw.trim();
}

/** 取场景对应分类的演练剧本（该分类下第一条；无分类或无剧本返回 undefined，调用方走兼容行为） */
export async function resolveDrillScript(store: Store, scenario: Scenario): Promise<DrillScript | undefined> {
  if (!scenario.category) return undefined;
  const list = await store.listDrillScripts(scenario.tenantId, scenario.category).catch(() => []);
  return list.find((s) => s.content.trim());
}

/** 演练剧本注入客户 prompt 的说明段落 */
export function drillScriptPrompt(script: DrillScript): string {
  return [
    '【本场演练剧本（剧情参照）】',
    script.content,
    '',
    '以上剧本是本场演练的剧情参照：理解剧情中谁先开口、客户在各阶段的反应、以及剧情如何收尾。',
    '对练是自由对话，不要照念剧本台词，但你的性格、反应轨迹、拒绝与松动方式要与剧情一致；',
    '对话推进到剧情终点（或学员明显达成/无法达成本场目标）时，按剧情方式自然收口结束对话。',
  ].join('\n');
}

export interface OpeningDecision {
  /** 谁先开口：trainee=学员（销售一方）；persona=客户（AI 一方） */
  firstSpeaker: 'trainee' | 'persona';
  /** 客户先开口时的开场台词；学员先开口或生成失败时为空（调用方回退自由生成） */
  openingLine?: string;
}

/** 剧本中的学员方角色标签（台词行首） */
const TRAINEE_ROLES = ['销售', '学员', '顾问', '咨询员', '客服'];
/** 剧本中的客户方角色标签（台词行首） */
const PERSONA_ROLES = ['客户', '家长'];

/**
 * 从剧本内容确定性判定谁先开口（优先于 LLM，避免同一份剧本每次判定结果漂移）：
 * 1. 显式原则行（"客户先开口"/"学员先开口"等）
 * 2. 首个带角色标签的台词行属于销售方还是客户方
 * 判定不了返回 undefined，由调用方走 LLM 决策
 */
export function detectFirstSpeaker(content: string): 'trainee' | 'persona' | undefined {
  const explicit = content.match(/(学员|销售|顾问|咨询员|客服|客户|家长)先(开口|说话|发言)/);
  if (explicit) {
    return PERSONA_ROLES.includes(explicit[1]) ? 'persona' : 'trainee';
  }
  for (const line of content.split('\n')) {
    const m = line.trim().match(/^([一-龥]{1,4})[：:]/);
    if (!m) continue;
    if (TRAINEE_ROLES.includes(m[1])) return 'trainee';
    if (PERSONA_ROLES.includes(m[1])) return 'persona';
    // 旁白/其他标签行跳过，继续找第一个实际说话的角色
  }
  return undefined;
}

/**
 * 演练开场决策：有剧本时先按剧本内容确定性判定谁先开口；
 * 判定不了（或无剧本）由 LLM 读剧本/场景设定判断。客户先开口时一并生成开场台词。
 * 失败回退 persona + 自由生成（与旧行为一致）。
 */
export async function decideOpening(
  gateway: LLMGateway,
  bundle: PersonaRuntimeBundle,
  hasDrillScript: boolean,
  drillScriptContent?: string
): Promise<OpeningDecision> {
  // 剧本可确定性判定时不依赖 LLM（学员先开口直接返回；客户先开口仍需 LLM 生成开场台词）
  const detected = drillScriptContent ? detectFirstSpeaker(drillScriptContent) : undefined;
  if (detected === 'trainee') return { firstSpeaker: 'trainee' };
  try {
    const result = await gateway.forTask('actor').chat(
      [
        { role: 'system', content: bundle.systemPrompt },
        {
          role: 'user',
          content: [
            hasDrillScript
              ? '本场对练即将开始。剧情参照已在上方给出，请判断剧情里是谁先开口（销售/学员一方，还是客户一方）。'
              : '本场对练即将开始。根据场景与你的人设设定，判断这个情境下谁先开口更合理（销售/学员一方主动，还是客户一方主动）。',
            '如果是客户先开口：以你的角色身份说出开场的第一句台词（自然、口语化，一两句话）。',
            '如果是学员（销售）先开口：不需要台词，openingLine 给空字符串。',
            '只输出 JSON：{"firstSpeaker":"trainee" 或 "persona","openingLine":"客户开场台词或空字符串"}',
            '不要输出任何其他内容。',
          ].join('\n'),
        },
      ],
      { jsonMode: true, temperature: 0.7 }
    );
    const parsed = JSON.parse(extractJson(result.content)) as { firstSpeaker?: unknown; openingLine?: unknown };
    // 剧本确定性判定为客户先开口时，LLM 只负责给开场台词，不得翻转为学员先开口
    if (parsed.firstSpeaker === 'trainee' && detected !== 'persona') return { firstSpeaker: 'trainee' };
    return {
      firstSpeaker: 'persona',
      openingLine: typeof parsed.openingLine === 'string' && parsed.openingLine.trim() ? parsed.openingLine.trim() : undefined,
    };
  } catch {
    return { firstSpeaker: 'persona' };
  }
}
