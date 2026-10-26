import 'fastify';
import type { UserRole } from '@grasp-mvp/core';

declare module 'fastify' {
  interface FastifyRequest {
    /** 用户 ID：来自 Bearer token（鉴权钩子写入） */
    userId: string;
    /** 租户：来自 Bearer token（鉴权钩子写入） */
    tenantId: string;
    /** 角色：来自 Bearer token（鉴权钩子写入） */
    userRole: UserRole;
  }
}
