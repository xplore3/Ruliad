import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const items = await prisma.scoreItemDef.findMany({ where: { tenantId: 'tenant-demo' } });
const rows = items.map((it) => {
  const d = JSON.parse(it.data);
  return {
    id: it.id, name: it.name, category: d.category ?? '-', sp: it.skillPointId,
    skillPointName: it.skillPointId,
    deductionOnly: !!d.deductionOnly,
    judgePromptLen: (d.judgePrompt ?? '').length,
  };
}).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
for (const r of rows) {
  console.log(`${r.id} | ${r.name} | cat=${r.category} | sp=${r.sp} | ded=${r.deductionOnly} | promptLen=${r.judgePromptLen}`);
}

// 检查地推销售忌讳的完整内容
const taboos = items.filter((it) => it.name.includes('忌讳'));
console.log('\n===== 忌讳项详情 =====');
for (const t of taboos) {
  const d = JSON.parse(t.data);
  console.log(`\n### ${t.name} (id=${t.id}, cat=${d.category ?? '-'})`);
  console.log('behaviorAnchor:', d.behaviorAnchor);
  console.log('judgePrompt:', d.judgePrompt);
}

await prisma.$disconnect();
