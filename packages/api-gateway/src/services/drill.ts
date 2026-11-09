import type { DrillScript, LLMGateway, PersonaRuntimeBundle, ProductKB, Scenario } from '@grasp-mvp/core';
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

/** 只读取场景显式绑定的演练剧本，并校验资源归属，避免同分类场景互相串用。 */
export async function resolveDrillScript(store: Store, scenario: Scenario): Promise<DrillScript | undefined> {
  const scriptId = scenario.id === 'scenario-humor-test' ? 'drill-script-humor-test' : scenario.drillScriptId;
  if (!scriptId) return undefined;
  const script = await store.getDrillScript(scriptId).catch(() => undefined);
  if (!script || script.tenantId !== scenario.tenantId || !script.content.trim()) return undefined;
  return script;
}

/** 演练剧本注入客户 prompt 的说明段落 */
export function drillScriptPrompt(script: DrillScript): string {
  return [
    '【本场演练剧本（剧情参照）】',
    script.content,
    '',
    '以上剧本是本场演练的唯一行为依据：理解剧情中谁先开口、客户在各阶段的反应、以及剧情如何收尾。',
    '对练是自由对话，不要照念剧本台词，但你的性格、反应轨迹、拒绝与松动方式要与剧情一致；',
    '剧本中的行为约束（客户是否提问、何时提问、沉默与肢体反应、何时结束等）是必须严格遵守的硬性规则，优先级高于其他一切行为要求；',
    '剧本未要求客户提问时，客户不得主动提问；但也不能总是沉默不语——要像真人一样，在听销售说话时随时给出简短的口头反应（如"嗯""哦？""是吗""这样啊""嗯嗯，你接着说"），表示在听、随口附和或初步兴趣，可同时用旁白配合描述动作神态（如"（客户接过邀请函看了看，点了点头）"）；不要用提问来维持对话；',
    '对话推进到剧情终点（或学员明显达成/无法达成本场目标）时，按剧情方式自然收口结束对话。',
  ].join('\n');
}

/** 机构定制资料：所有剧本场景都必须阅读，不能因剧本覆盖人设知识而丢失 */
export function institutionKnowledgePrompt(kb?: ProductKB): string {
  if (!kb || kb.entries.length === 0) return '';
  const lines = kb.entries.map((entry) => `- ${entry.title}：${entry.content}`).join('\n');
  return [
    `【${kb.name || '培训机构定制资料库'}】`,
    '以下机构资料适用于所有场景，生成客户回复、理解用户表达和分析销售话术时都必须参考；不得与资料中的机构事实、课程信息和业务规则冲突。',
    lines,
  ].join('\n');
}

/**
 * 双场制演练判定：剧本中声明了类似"10次应该有5次客户表现出不感兴趣"的概率原则时，
 * 不再随机——一场演练固定编排为两小场：第一场必定"不感兴趣"（最多 3 轮后旁白切场），
 * 第二场必定"潜在意向"，避免用户连续随机到无兴趣客户。
 * 未声明返回 undefined（不干预）。
 */
export function initialCustomerArchetype(
  content: string,
  category?: Scenario['category']
): 'uninterested' | 'interested' | undefined {
  if (category === '咨询接待') return 'interested';
  if (category !== '地推') return undefined;
  if (!/10次应该有5次|一半.*不感兴趣|5次.*不感兴趣/.test(content)) return undefined;
  return 'uninterested';
}

/** 第一场（不感兴趣）时长上限：开场满 100 秒后由系统旁白切换到有意向客户 */
export const FIRST_SCENE_MAX_MS = 100_000;
/** 学员放弃当前客户的话术特征（命中即切场，无需等满 1 分钟） */
export const GIVE_UP_PATTERN = /打扰[你您]?了?|那算了|不打扰|那您忙|不好意思.*打扰|以后再说|下次再来/;
/** 切场旁白文案（第一小场结束 → 第二小场开始，学员先开口） */
export const SCENE_TRANSITION_NARRATION = '这次演练结束，现在开始下一场，请你先说话。';

/** 本场客户类型注入 prompt 的硬约束段落 */
export function archetypePrompt(
  archetype: 'uninterested' | 'interested',
  category?: Scenario['category']
): string {
  if (category === '咨询接待') {
    return [
      '【本场客户类型（必须严格遵守，优先级高于其他行为要求）】明确有兴趣、主动上门咨询的客户。',
      '客户对课程或服务有明确兴趣，愿意了解并配合咨询流程，不得使用地推第一小场的固定无兴趣反应。',
      '按咨询接待剧本自然提问、了解课程、预约或成交；不得无故离开或把潜在客户特有的地推拒绝流程带入本场景。',
      '学员已在开场白中报出机构名称（例如“文杰围棋，有什么能帮您”）时，说明客户已经联系上文杰围棋，不得再询问“是文杰围棋吗”或重复确认机构、姓名；直接自然说明咨询需求，例如“您好，我想给孩子咨询一下围棋课程，他5岁能学吗？”。',
      '客户虽然有兴趣，但永远不会主动提出想试听课、主动约试听时间或要求安排试听；试听只能由销售主动提出并推动。客户可以回答销售提出的时间选择，但不能替销售发起邀约。',
    ].join('\n');
  }
  return archetype === 'uninterested'
    ? [
        '【本场客户类型（系统随机确定，必须严格遵守，优先级高于其他行为要求）】不感兴趣的客户。',
        '按剧本中该类客户的行为要求执行：不表现出兴趣，主要用身体语言拒绝（不停下脚步/没有放慢脚步/摇手），',
        '或简短表明（如"我们不学""我们赶时间"），不展开提问；这种类型的演练很快就会结束。',
      ].join('\n')
    : [
        '【本场客户类型（系统随机确定，必须严格遵守，优先级高于其他行为要求）】潜在意向客户。',
        '按剧本中该类客户的行为要求执行：用肢体语言表达兴趣（放慢脚步/停下脚步/转头问孩子），',
        '被动配合销售的引导推进流程；在剧本规定的提问/拒绝环节（如成交阶段的六连问）到来之前不主动提问；',
        '销售介绍或递出物料时，要像真人一样给出简短的口头回应（如"嗯""哦，是吗""这样啊""嗯嗯，你说"），',
        '表示在听和初步兴趣，可配合旁白描述动作神态（如"（客户接过邀请函看了看）"），不要一直沉默不语，也不要用提问维持对话。',
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
