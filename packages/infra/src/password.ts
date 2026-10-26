import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * 密码哈希：scrypt（缺省参数）+ 16 字节随机 salt。
 * 返回 `salt:hash`（hex 编码，冒号分隔）。
 * 放在 infra 是因为 seed 与 api-gateway 都需要用（依赖方向：api-gateway -> infra）。
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** 校验密码：解析 salt 重算，timingSafeEqual 防时序攻击 */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const storedHash = Buffer.from(hashHex, 'hex');
  return hash.length === storedHash.length && timingSafeEqual(hash, storedHash);
}
