import type { DrillScript, ScoreCategory } from '@grasp-mvp/core';
import type { Store } from '@grasp-mvp/infra';
import { DEMO_SCRIPTS } from './seed-guidance.data.js';
import { renderDemoScript, resolveFaqPool } from './services/guidance.js';

/**
 * 演练剧本库种子：四类各一条，仅在库为空时灌入（之后用户的增删改归用户所有，重启不恢复不覆盖）。
 * 地推/电销/咨询接待的内容用对应示范剧本渲染成剧情模板（优先读示范剧本库，库中缺该剧本时回退种子数据，
 * 避免与 seed:guidance 的执行顺序耦合）；现场成交无示范剧本，给骨架模板待补充。
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

/** 现场成交骨架模板（示范剧本库无对应剧本，待用户在库中补充完善） */
const CLOSING_TEMPLATE = `（现场成交演练剧本模板，待完善——请把标准剧情与演练原则写在这里，演练开始时 AI 会阅读本文，决定谁先开口、客户如何回应、何时结束）

剧情背景：学员扮演课程顾问，AI 扮演家长。试听课结束后进入现场谈判，家长对价格与条款有顾虑。

演练原则：
1. 客户先开口，就价格或优惠发难。
2. 客户会根据学员的应对在"压价—犹豫—松动"之间变化，不主动降价、不轻易让步。
3. 当学员成功促成签约（或谈判破裂客户决定离开）时，客户自然收口结束对话。`;

const DRILL_SEEDS: { category: ScoreCategory; name: string; demoScriptId?: string; content?: string }[] = [
  { category: '地推', name: '地推引流演练剧本', demoScriptId: 'demo-script-ground-push' },
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
    const content = seed.demoScriptId
      ? await renderDemoContent(store, tenantId, seed.demoScriptId).catch(() => undefined)
      : seed.content;
    if (!content?.trim()) continue;
    const script: DrillScript = {
      id: `drill-script-${seed.category}`,
      tenantId,
      category: seed.category,
      name: seed.name,
      content,
    };
    await store.saveDrillScript(script);
    seeded++;
  }
  return seeded;
}
