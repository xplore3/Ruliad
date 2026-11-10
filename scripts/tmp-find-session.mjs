import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const rows = await prisma.session.findMany({ orderBy: { startedAt: 'desc' }, take: 20 });
for (const r of rows) {
  const raw = r.data;
  const hit = raw.includes('值得');
  console.log(r.id, '|', r.userId, '|', r.scenarioId, '|', r.status, '|', r.startedAt.toISOString(), '|', hit ? 'HIT' : '');
}
await prisma.$disconnect();
