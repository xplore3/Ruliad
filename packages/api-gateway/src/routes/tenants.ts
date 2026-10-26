import type { FastifyInstance } from 'fastify';
import type { RouteContext } from '../ctx.js';

const DEFAULT_TENANT = 'tenant-demo';

export async function tenantsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 租户列表：从 organizations/users 聚合（dev 语义，无鉴权）
  app.get('/tenants', async (request) => {
    const tenantIds = [...new Set([DEFAULT_TENANT, request.tenantId])];
    const tenants = await Promise.all(
      tenantIds.map(async (tenantId) => {
        const orgs = await store.listOrganizations(tenantId);
        const users = await store.listUsers(tenantId);
        return {
          tenantId,
          name: orgs[0]?.name ?? tenantId,
          userCount: users.length,
        };
      })
    );
    return tenants;
  });

  // SSO 入口占位（Phase 3）
  app.get('/auth/providers', async () => ({
    providers: [
      {
        key: 'wecom',
        name: '企业微信',
        configured: false,
        note: 'Phase 3 入口占位：配置 WECOM_CORP_ID/WECOM_SECRET 后启用',
      },
    ],
  }));

  app.get('/auth/wecom', async (_request, reply) =>
    reply.code(501).send({ error: 'wecom sso not configured' })
  );
}
