import type { DrillScript, ScoreCategory } from '@grasp-mvp/core';
import type { Store } from '@grasp-mvp/infra';
import { DEMO_SCRIPTS } from './seed-guidance.data.js';
import { renderDemoScript, resolveFaqPool } from './services/guidance.js';

/**
 * 演练剧本库种子：四类各一条，仅在库为空时灌入（之后用户的增删改归用户所有，重启不恢复不覆盖）。
 * 地推/电销/咨询接待的内容用对应示范剧本渲染成剧情模板（优先读示范剧本库，库中缺该剧本时回退种子数据，
 * 避免与 seed:guidance 的执行顺序耦合）；现场成交演练使用独立谈判模板。
 */

const ROLE_LABELS: Record<string, string> = {
  sales: '销售',
  customer: '客户',
  child: '孩子',
  narrator: '旁白',
};

/** 示范剧本渲染为整篇剧情文本（变量/FAQ 解析后的参照稿） */
async function renderDemoContent(store: Store, tenantId: string, demoScriptId: string): Promise<string | undefined> {
  const script = (await store.getDemoScript(demoScriptId)) ?? DEMO_SCRIPTS.find((s) => s.id === demoScriptId);
  if (!script) return undefined;
  const pool = await resolveFaqPool(store, tenantId, script.faqPoolRef, script.faqPick ?? 0);
  const lines = renderDemoScript(script, pool);
  return lines.map((l) => `${ROLE_LABELS[l.role] ?? l.role}：${l.text}`).join('\n');
}

/**
 * 现场成交双场制演练模板：第一位家长谈判到最后固定拒绝，第二位家长销售表现合适则成交。
 * 两小场的行为要求承载于演练剧本库（可在资源库直接编辑），代码只做切场编排；
 * 谈判型第一小场不设地推式的 100 秒硬时限，由第一位客户拒绝离场自然切场。
 * 注意：开场判定读取"客户先开口"（第一小场）；切场旁白文案须与代码中的实际旁白一致。
 */
export const CLOSING_TEMPLATE = `（现场成交演练剧本：双场制演练。演练开始时 AI 会阅读本文，按本规则先后扮演两位谈判家长，决定客户如何回应、何时结束）

剧情背景：学员扮演课程顾问，AI 扮演家长。试听课结束后进入现场谈判，家长对价格与条款有顾虑。

【本场结构：两小场】
第一小场：客户先开口，就价格或优惠发难。你扮演第一位家长，无论销售表现如何，本场最终都固定拒绝成交。
谈判过程中根据学员的应对在"压价—犹豫—松动"之间变化，不主动降价、不轻易让步；即使学员应对出色，也只能表现出动摇，不能当场成交。
当谈判推进到收口阶段（学员完成答疑与促单、或学员放弃推进）时，以"今天先不定了／我再回去考虑考虑"等理由明确拒绝并自然离场，结束第一小场；随后系统会插入旁白"这次演练结束，现在开始下一场，请你先说话。"
第二小场：读到上述切场旁白后，由学员先开口，你改演第二位家长，同样对价格与条款有顾虑，在"压价—犹豫—松动"之间变化，不主动降价、不轻易让步。
这一位是否成交取决于销售表现：学员能有效解答顾虑、价值塑造到位并明确推进签约时，最终同意成交（确认价格与报名方式、约定缴费，自然收口结束对话）；学员敷衍、强推或无法解答顾虑时，拒绝成交并离场。`;

/**
 * 地推双场制演练说明：两小场的客户行为要求承载于演练剧本库（可在资源库直接编辑），
 * 代码不再注入客户类型提示词，仅按"双场制/两小场"声明做切场编排。
 * 注意："学员先开口"为连续字样，供开场判定确定性识别；切场旁白文案须与代码中的实际旁白一致。
 */
export const GROUND_PUSH_DUAL_SCENE_INTRO = `（地推引流演练剧本：双场制演练。演练开始时 AI 会阅读本文，按本规则分饰两位家长，并参照下方剧情决定客户如何回应、何时结束）

【本场结构：两小场，每小场均由学员先开口（销售一方主动搭讪）】
第一小场：你扮演第一位家长，固定为不感兴趣的客户。
不表现出兴趣，主要用身体语言拒绝（不停下脚步/没有放慢脚步/摇手），或简短表明（如"我们不学""我们赶时间"），不展开提问；这一小场很快就会结束。
当学员说出放弃类话术（如"那打扰您了"）、或对话已无法推进时，第一位家长自然离场；随后系统会插入旁白"这次演练结束，现在开始下一场，请你先说话。"
第二小场：读到上述切场旁白后，你改演第二位家长，固定为潜在意向客户，并严格按下方剧情参照推进。
用肢体语言表达兴趣（放慢脚步/停下脚步/转头问孩子），被动配合销售的引导推进流程；在剧情规定的提问/拒绝环节（如成交阶段的六连问）到来之前不主动提问；
销售介绍或递出物料时，要像真人一样给出简短的口头回应（如"嗯""哦，是吗""这样啊""嗯嗯，你说"），表示在听和初步兴趣，可配合旁白描述动作神态（如"（客户接过邀请函看了看）"），不要一直沉默不语，也不要用提问维持对话。

【剧情参照（第二小场）】`;

const DRILL_SEEDS: { category: ScoreCategory; name: string; demoScriptId?: string; content?: string; intro?: string }[] = [
  { category: '地推', name: '地推引流演练剧本', demoScriptId: 'demo-script-ground-push', intro: GROUND_PUSH_DUAL_SCENE_INTRO },
  { category: '电销', name: '电话销售演练剧本', demoScriptId: 'demo-script-phone-sales' },
  { category: '咨询接待', name: '咨询接待演练剧本', demoScriptId: 'demo-script-inquiry' },
  { category: '现场成交', name: '现场成交演练剧本', content: CLOSING_TEMPLATE },
];

/** 库为空时灌入四类演练剧本模板；返回灌入条数 */
export async function ensureDrillScriptSeeds(store: Store, tenantId: string): Promise<number> {
  const existing = await store.listDrillScripts(tenantId);
  if (existing.length > 0) return 0;
  let seeded = 0;
  for (const seed of DRILL_SEEDS) {
    const body = seed.demoScriptId
      ? await renderDemoContent(store, tenantId, seed.demoScriptId).catch(() => undefined)
      : seed.content;
    if (!body?.trim()) continue;
    const script: DrillScript = {
      id: `drill-script-${seed.category}`,
      tenantId,
      category: seed.category,
      name: seed.name,
      content: seed.intro ? `${seed.intro}\n${body}` : body,
    };
    await store.saveDrillScript(script);
    seeded++;
  }
  return seeded;
}
