import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Organization } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';
import { requireRoles } from '../auth.js';

/** 机构列表条目：机构基础信息 + 简介 + 成员/团队规模 */
export interface OrganizationItem {
  id: string;
  tenantId: string;
  name: string;
  parentId?: string;
  description?: string;
  memberCount: number;
  teamCount: number;
}

/** 机构简介长度上限 */
const DESCRIPTION_MAX = 300;

/** 机构基础信息聚合：成员数 / 团队数 */
async function buildOrganizationItems(
  ctx: RouteContext,
  tenantId: string
): Promise<OrganizationItem[]> {
  const { store } = ctx;
  const orgs = await store.listOrganizations(tenantId);
  const users = await store.listUsers(tenantId);
  return Promise.all(
    orgs.map(async (org) => ({
      id: org.id,
      tenantId: org.tenantId,
      name: org.name,
      ...(org.parentId ? { parentId: org.parentId } : {}),
      ...(org.description ? { description: org.description } : {}),
      memberCount: users.filter((u) => u.orgId === org.id).length,
      teamCount: (await store.listTeams(org.id)).length,
    }))
  );
}

/**
 * 机构路由：机构的创建与成员归属统一由系统管理员（admin）在「机构管理」页操作，
 * 练习者/管理者端不再提供切换、加入、退出机构的能力。
 */
export async function organizationsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 机构列表（全员可读，仅用于展示机构名称与规模）
  app.get('/organizations', async (request) => {
    const organizations = await buildOrganizationItems(ctx, request.tenantId);
    return { organizations };
  });

  // 新建机构（系统管理员专属）
  app.post<{ Body: { name?: string; parentId?: string; description?: string } }>(
    '/organizations',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const name = request.body?.name?.trim();
      if (!name) {
        return reply.code(400).send({ error: '机构名称不能为空' });
      }
      if (name.length > 60) {
        return reply.code(400).send({ error: '机构名称不能超过 60 个字符' });
      }
      const description = request.body?.description?.trim();
      if (description && description.length > DESCRIPTION_MAX) {
        return reply.code(400).send({ error: `机构简介不能超过 ${DESCRIPTION_MAX} 个字符` });
      }
      if (request.body?.parentId) {
        const parent = (await store.listOrganizations(request.tenantId)).find(
          (o) => o.id === request.body.parentId
        );
        if (!parent) {
          return reply.code(400).send({ error: '上级机构不存在' });
        }
      }
      const org: Organization = {
        id: randomUUID(),
        tenantId: request.tenantId,
        name,
        ...(request.body?.parentId ? { parentId: request.body.parentId } : {}),
        ...(description ? { description } : {}),
      };
      await store.saveOrganization(org);
      return reply.code(201).send({ organization: org });
    }
  );

  // 更新机构（系统管理员专属）：名称 / 简介 / 上级机构
  app.put<{
    Params: { id: string };
    Body: { name?: string; description?: string | null; parentId?: string | null };
  }>('/organizations/:id', { preHandler: requireRoles('admin') }, async (request, reply) => {
    const orgs = await store.listOrganizations(request.tenantId);
    const target = orgs.find((o) => o.id === request.params.id);
    if (!target) {
      return reply.code(404).send({ error: '机构不存在' });
    }

    const { name, description, parentId } = request.body ?? {};

    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) {
        return reply.code(400).send({ error: '机构名称不能为空' });
      }
      if (trimmed.length > 60) {
        return reply.code(400).send({ error: '机构名称不能超过 60 个字符' });
      }
    }
    if (description !== undefined && description !== null && description.trim().length > DESCRIPTION_MAX) {
      return reply.code(400).send({ error: `机构简介不能超过 ${DESCRIPTION_MAX} 个字符` });
    }
    if (parentId !== undefined && parentId !== null) {
      const parent = orgs.find((o) => o.id === parentId);
      if (!parent) {
        return reply.code(400).send({ error: '上级机构不存在' });
      }
    }

    const next: Organization = {
      ...target,
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(description !== undefined
        ? { description: description?.trim() || undefined }
        : {}),
      ...(parentId !== undefined ? { parentId: parentId ?? undefined } : {}),
    };
    await store.saveOrganization(next);
    return {
      organization: {
        id: next.id,
        tenantId: next.tenantId,
        name: next.name,
        ...(next.parentId ? { parentId: next.parentId } : {}),
        ...(next.description ? { description: next.description } : {}),
      },
    };
  });
}
