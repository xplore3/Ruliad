import { createStore } from '@grasp-mvp/infra';
import { BRIEFING_STANDARDS, REALISM_STANDARDS, SCENARIO_GUIDANCES } from './seed-guidance.data.js';
import { DEMO_FAQ_ITEMS } from './demo-faq.data.js';

const TENANT = 'tenant-demo';

/**
 * 新手指引流程配置灌数脚本：4 条讲解标准 + 4 条演练真实度标准 + 4 个新手指引流程配置 + 地推示范 FAQ 28 条入示范问答库。
 * 用法：pnpm --filter @grasp-mvp/api-gateway seed:guidance
 * 幂等：全部走 upsert（saveXxx），可重复执行。
 */
async function main() {
  const store = createStore();

  for (const s of BRIEFING_STANDARDS) {
    await store.saveBriefingStandard(s);
  }
  console.log(`[seed:guidance] 讲解标准 upsert：${BRIEFING_STANDARDS.length} 条`);

  for (const s of REALISM_STANDARDS) {
    await store.saveRealismStandard(s);
  }
  console.log(`[seed:guidance] 演练真实度标准 upsert：${REALISM_STANDARDS.length} 条`);

  for (const g of SCENARIO_GUIDANCES) {
    await store.saveScenarioGuidance(g);
  }
  console.log(`[seed:guidance] 新手指引流程配置 upsert：${SCENARIO_GUIDANCES.length} 个`);

  // 地推示范 FAQ 28 条迁入示范问答库（分类"地推示范"，renderDemoScript 优先从示范问答库读取）
  for (let i = 0; i < DEMO_FAQ_ITEMS.length; i++) {
    const item = DEMO_FAQ_ITEMS[i];
    await store.saveDemoFaq({
      id: `cq-demo-ground-push-${String(i + 1).padStart(2, '0')}`,
      tenantId: TENANT,
      category: '地推示范',
      question: item.question,
      referenceAnswer: item.faq,
    });
  }
  console.log(`[seed:guidance] 地推示范 FAQ upsert 入示范问答库：${DEMO_FAQ_ITEMS.length} 条`);

  const guidances = await store.listScenarioGuidances(TENANT);
  console.log(`[seed:guidance] 校验：库中新手指引流程配置共 ${guidances.length} 个（${guidances.map((g) => g.scenarioId).join('、')}）`);
}

main().catch((err) => {
  console.error('[seed:guidance] 失败：', err);
  process.exit(1);
});
