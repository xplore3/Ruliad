import { createStore } from '@grasp-mvp/infra';
import { ANALYSIS_STANDARDS, REALISM_STANDARDS, SCENARIO_GUIDANCES } from './seed-guidance.data.js';
import { DEMO_FAQ_ITEMS } from './demo-faq.data.js';

const TENANT = 'tenant-demo';

/**
 * 场景引导资源库灌数脚本：4 条分析标准 + 4 条真实度标准 + 4 个场景引导包 + 地推示范 FAQ 28 条入问题库。
 * 用法：pnpm --filter @grasp-mvp/api-gateway seed:guidance
 * 幂等：全部走 upsert（saveXxx），可重复执行。
 */
async function main() {
  const store = createStore();

  for (const s of ANALYSIS_STANDARDS) {
    await store.saveAnalysisStandard(s);
  }
  console.log(`[seed:guidance] 分析标准 upsert：${ANALYSIS_STANDARDS.length} 条`);

  for (const s of REALISM_STANDARDS) {
    await store.saveRealismStandard(s);
  }
  console.log(`[seed:guidance] 真实度标准 upsert：${REALISM_STANDARDS.length} 条`);

  for (const g of SCENARIO_GUIDANCES) {
    await store.saveScenarioGuidance(g);
  }
  console.log(`[seed:guidance] 场景引导包 upsert：${SCENARIO_GUIDANCES.length} 个`);

  // 地推示范 FAQ 28 条迁入问题库（分类"地推示范"，renderDemoScript 优先从问题库读取）
  for (let i = 0; i < DEMO_FAQ_ITEMS.length; i++) {
    const item = DEMO_FAQ_ITEMS[i];
    await store.saveCustomerQuestion({
      id: `cq-demo-ground-push-${String(i + 1).padStart(2, '0')}`,
      tenantId: TENANT,
      category: '地推示范',
      question: item.question,
      referenceAnswer: item.faq,
    });
  }
  console.log(`[seed:guidance] 地推示范 FAQ upsert 入问题库：${DEMO_FAQ_ITEMS.length} 条`);

  const guidances = await store.listScenarioGuidances(TENANT);
  console.log(`[seed:guidance] 校验：库中场景引导包共 ${guidances.length} 个（${guidances.map((g) => g.scenarioId).join('、')}）`);
}

main().catch((err) => {
  console.error('[seed:guidance] 失败：', err);
  process.exit(1);
});
