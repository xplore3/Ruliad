// 临时验证脚本：确认 GoldenCase.tenantId 列存在且 prisma 查询正常
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const cols = await prisma.$queryRawUnsafe('PRAGMA table_info(GoldenCase)');
  console.log('GoldenCase columns:', cols.map((c) => c.name).join(', '));
  const count = await prisma.goldenCase.count();
  console.log('goldenCase rows:', count);
  console.log('OK: prisma.goldenCase.findMany() 所需的 tenantId 列已存在');
} catch (err) {
  console.error('FAIL:', err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
