import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const session = await prisma.session.findUnique({ where: { id: '634b8a3b-c947-4f90-b9d7-46943f92bd2e' } });
if (!session) {
  console.log('会话不存在');
} else {
  console.log('scenarioId:', session.scenarioId, '| status:', session.status);
  const data = JSON.parse(session.data);
  const transcript = data.transcript ?? [];
  for (const t of transcript) {
    console.log(`[${t.seq}] ${t.speaker}: ${t.text}`);
  }
}
await prisma.$disconnect();
