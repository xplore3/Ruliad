import { createHmac, timingSafeEqual } from 'node:crypto';
import type { preHandlerHookHandler } from 'fastify';
import type { UserRole } from '@grasp-mvp/core';

/** Token 载荷（签发时附加 exp） */
export interface TokenPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  name: string;
  /** 过期时间（Unix 秒） */
  exp: number;
}

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天

function secret(): string {
  return process.env.AUTH_SECRET ?? 'grasp-dev-secret';
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

/**
 * 签发 token：`base64url(JSON含exp).base64url(hmac-sha256)`，有效期 7 天。
 * 密码哈希工具（hashPassword/verifyPassword）在 @grasp-mvp/infra 中，seed 也复用。
 */
export function signToken(payload: Omit<TokenPayload, 'exp'>): string {
  const body: TokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const data = b64url(JSON.stringify(body));
  return `${data}.${hmac(data)}`;
}

/** 验签结果：成功返回 payload，失败返回可读原因（供日志诊断） */
function verifyTokenDetailed(token: string): { payload: TokenPayload } | { error: string } {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return { error: 'token 格式错误（缺少签名段）' };
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(data);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { error: '签名不匹配（AUTH_SECRET 与签发时不一致？）' };
  }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as TokenPayload;
    if (!payload.userId || !payload.tenantId || !payload.role) return { error: '载荷缺少必要字段' };
    if (typeof payload.exp !== 'number') return { error: '载荷无 exp 字段' };
    if (payload.exp < Date.now() / 1000) {
      return { error: `token 已过期（exp=${new Date(payload.exp * 1000).toISOString()}）` };
    }
    return { payload };
  } catch {
    return { error: '载荷解析失败（非合法 base64url JSON）' };
  }
}

/** 验签 + 验 exp；任何失败返回 null */
export function verifyToken(token: string): TokenPayload | null {
  const r = verifyTokenDetailed(token);
  return 'payload' in r ? r.payload : null;
}

/** token 鉴别失败原因（仅日志用）；有效返回空串 */
export function tokenFailReason(token: string): string {
  const r = verifyTokenDetailed(token);
  return 'error' in r ? r.error : '';
}

/** 角色守卫：request.userRole 不在允许列表内则 403；platform 角色放行所有守卫 */
export function requireRoles(...roles: UserRole[]): preHandlerHookHandler {
  return async (request, reply) => {
    if (request.userRole !== 'platform' && !roles.includes(request.userRole)) {
      return reply.code(403).send({ error: '无权访问' });
    }
  };
}
