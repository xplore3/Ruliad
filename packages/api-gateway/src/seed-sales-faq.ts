import type { PersonaConfig, ProductKB, ProductKBEntry, Scenario } from '@grasp-mvp/core';
import { createStore } from '@grasp-mvp/infra';
import { SALES_FAQ_PERSONAS, type SalesFaqItem, type SalesFaqPersona } from './seed-sales-faq.data.js';
import { SALES_FAQ_ITEMS_ALL } from './seed-sales-faq.data2.js';

const TENANT = 'tenant-demo';
const KB_ID = 'kb-edu-sales-faq';
const PASS_SCORE = 70;
const DURATION_MINUTES = 8;

function toPersonaConfig(p: SalesFaqPersona): PersonaConfig {
  return {
    id: p.id,
    tenantId: TENANT,
    name: p.name,
    background: p.background,
    age: p.age,
    occupation: p.occupation,
    voiceProfile: { voice: p.voice },
    elementIds: [],
    behaviorBands: [
      { minArousal: 0, maxArousal: 0.4, key: 'calm', instruction: p.calm },
      { minArousal: 0.4, maxArousal: 0.7, key: 'guarded', instruction: p.guarded },
      { minArousal: 0.7, maxArousal: 1.0, key: 'annoyed', instruction: p.annoyed },
    ],
    knowledgeBoundary: {
      mustNotKnow: ['机构的内部销售政策与提成', '学员的身份是销售人员'],
      loadedKnowledge: p.loadedKnowledge,
    },
    sourceMeta: {
      archetype: p.archetype,
      recordings: 6,
      recordingsKind: '模拟构建',
      lastCalibrated: '2026-08',
      practiceCount: 0,
      calibrationStatus: '已校准',
    },
    version: 1,
  };
}

function toKBEntry(item: SalesFaqItem): ProductKBEntry {
  const content = item.why ? `${item.faq}\n\n【为什么这样回答】${item.why}` : item.faq;
  return {
    id: `kb-faq-q${String(item.num).padStart(2, '0')}`,
    kind: 'faq',
    title: `[${item.category}] ${item.question}`,
    content,
  };
}

function toScenario(item: SalesFaqItem): Scenario {
  return {
    id: `scenario-faq-${String(item.num).padStart(2, '0')}`,
    tenantId: TENANT,
    name: item.name,
    personaConfigId: item.personaId,
    productKBId: KB_ID,
    skillPointIds: item.skillPointIds,
    successCriteria: { passScore: PASS_SCORE },
    durationMinutes: DURATION_MINUTES,
    difficulty: item.difficulty,
    coverageTopics: item.coverageTopics,
    personaTitle: item.personaTitle,
    methodology: item.category,
    source: '销售FAQ话术库',
  };
}

/**
 * 销售 FAQ 陪练场景灌数脚本：8 个家长陪练角色 + 1 个 FAQ 知识库 + 50 个练习场景。
 * 用法：pnpm --filter @grasp-mvp/api-gateway seed:faq
 * 幂等：全部走 upsert（saveXxx），可重复执行。
 */
async function main() {
  const store = createStore();

  for (const p of SALES_FAQ_PERSONAS) {
    await store.savePersonaConfig(toPersonaConfig(p));
  }
  console.log(`[seed:faq] 陪练角色 upsert：${SALES_FAQ_PERSONAS.length} 个`);

  const kb: ProductKB = {
    id: KB_ID,
    tenantId: TENANT,
    name: '教培销售 FAQ 标准应答话术库',
    version: 1,
    entries: SALES_FAQ_ITEMS_ALL.map(toKBEntry),
    effectiveAt: '2026-08-14',
  };
  await store.saveProductKB(kb);
  console.log(`[seed:faq] FAQ 知识库 upsert：${kb.entries.length} 条（${kb.id}）`);

  for (const item of SALES_FAQ_ITEMS_ALL) {
    await store.saveScenario(toScenario(item));
  }
  console.log(`[seed:faq] 场景 upsert：${SALES_FAQ_ITEMS_ALL.length} 个`);

  const scenarios = await store.listScenarios(TENANT);
  const faqScenarios = scenarios.filter((s) => s.id.startsWith('scenario-faq-'));
  console.log(`[seed:faq] 校验：库中 scenario-faq-* 场景共 ${faqScenarios.length} 个（租户全部场景 ${scenarios.length} 个）`);
}

main().catch((err) => {
  console.error('[seed:faq] 失败：', err);
  process.exit(1);
});
