import { PrismaClient } from '@prisma/client';

export { PrismaClient };
export * from './store.js';
export { buildSeedData } from './seed.js';
export { hashPassword, verifyPassword } from './password.js';
export { MemoryStore } from './memory-store.js';
export { PrismaStore } from './prisma-store.js';
export { TencentSmsClient } from './sms/tencent.js';
export type { TencentSendSmsInput, TencentSendSmsResponse } from './sms/tencent.js';

import { MemoryStore } from './memory-store.js';
import { PrismaStore } from './prisma-store.js';
import type { Store } from './store.js';

/**
 * 仓储工厂：配置了 DATABASE_URL 走 PostgreSQL（PrismaStore），
 * 否则降级为 MemoryStore（本地开发/演示/测试）。
 */
export function createStore(): Store {
  if (process.env.DATABASE_URL) {
    return new PrismaStore();
  }
  console.warn('[infra] DATABASE_URL 未配置，使用 MemoryStore（数据不持久化）');
  return new MemoryStore();
}

let globalPrisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!globalPrisma) {
    globalPrisma = new PrismaClient();
  }
  return globalPrisma;
}

export async function disconnectPrisma(): Promise<void> {
  await globalPrisma?.$disconnect();
}
