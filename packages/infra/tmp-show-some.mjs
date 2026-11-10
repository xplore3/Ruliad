import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const items = await prisma.scoreItemDef.findMany({ where: { name: { in: ['告知优惠', '服务用语亲切度', '流程完整度', '语气语调'] } } });
for (const it of items) {
  const d = JSON.parse(it.data);
  console.log(`\n### ${it.name} (id=${it.id}, cat=${d.category ?? '-'}, sp=${it.skillPointId})`);
  console.log('behaviorAnchor:', d.behaviorAnchor);
  console.log('judgePrompt:', d.judgePrompt);
}
await prisma.$disconnect();
