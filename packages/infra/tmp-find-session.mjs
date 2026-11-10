import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const items = await prisma.scoreItemDef.findMany({ where: { tenantId: 'tenant-demo' } });
const rows = items.map((it) => {
  const d = JSON.parse(it.data);
  return { id: it.id, name: it.name, category: d.category ?? '-', sp: it.skillPointId };
}).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
for (const r of rows) {
  console.log(r.id, '|', r.name, '| cat=', r.category, '| sp=', r.sp);
}
await prisma.$disconnect();
