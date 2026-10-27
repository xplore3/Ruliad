import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Organization, Team, User, UserRole } from '@grasp-mvp/core';
import { hashPassword } from '@grasp-mvp/infra';
import type { RouteContext } from '../ctx.js';
import { requireRoles } from '../auth.js';

const ROLES: UserRole[] = ['trainee', 'supervisor', 'admin', 'executive', 'platform'];

/** 批量导入的缺省初始密码（未逐项指定 password 时使用） */
const DEFAULT_PASSWORD = '123456';
/** 单次导入上限，防止误传整张大表拖垮服务 */
const IMPORT_LIMIT = 500;

interface ImportUserItem {
  username?: string;
  name?: string;
  role?: string;
  orgName?: string;
  teamName?: string;
  password?: string;
}

export async function usersRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 当前用户偏好设置（设置页持久化；未设置过返回 {}）
  app.get('/users/me/preferences', async (request, reply) => {
    const user = await store.getUser(request.userId);
    if (!user) return reply.code(404).send({ error: '用户不存在' });
    return { preferences: user.preferences ?? {} };
  });

  // 全量替换当前用户偏好设置；body 须为纯 JSON 对象，序列化后不超过 16KB
  app.put<{ Body: Record<string, unknown> }>('/users/me/preferences', async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'preferences 必须为 JSON 对象' });
    }
    if (JSON.stringify(body).length > 16 * 1024) {
      return reply.code(413).send({ error: '偏好设置过大（上限 16KB）' });
    }
    const user = await store.getUser(request.userId);
    if (!user) return reply.code(404).send({ error: '用户不存在' });
    await store.saveUser({ ...user, preferences: body });
    return { preferences: body };
  });

  // 用户列表（admin 专属），支持 ?role= 过滤；输出剔除 passwordHash
  app.get<{ Querystring: { role?: string } }>(
    '/users',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const role = request.query.role as UserRole | undefined;
      if (role && !ROLES.includes(role)) {
        return reply.code(400).send({ error: 'role 不合法' });
      }
      const users = await store.listUsers(request.tenantId, role);
      return users.map(({ passwordHash: _passwordHash, ...rest }) => rest);
    }
  );

  /**
   * 批量导入用户（admin 专属，企业 HR 花名册初始化）。
   * - orgName / teamName 按名称解析，不存在则自动创建；缺省落到租户第一个组织
   * - username 已存在 → 更新姓名/角色/组织/团队（仅显式给 password 时才重置密码）
   * - 逐行容错：错误行记入 errors，不中断整批
   */
  app.post<{ Body: { users?: ImportUserItem[] } }>(
    '/users/import',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const items = request.body?.users;
      if (!Array.isArray(items) || items.length === 0) {
        return reply.code(400).send({ error: 'users 必填且非空' });
      }
      if (items.length > IMPORT_LIMIT) {
        return reply.code(400).send({ error: `单次最多导入 ${IMPORT_LIMIT} 人` });
      }

      const tenantId = request.tenantId;
      const orgs = await store.listOrganizations(tenantId);
      const orgByName = new Map(orgs.map((o) => [o.name, o]));
      // 团队缓存：orgId -> (name -> Team)，命中后避免重复 listTeams
      const teamCache = new Map<string, Map<string, Team>>();
      const errors: { index: number; username?: string; error: string }[] = [];
      let created = 0;
      let updated = 0;

      const resolveOrg = async (orgName?: string): Promise<Organization | null> => {
        const name = orgName?.trim();
        if (!name) return orgs[0] ?? null;
        const existing = orgByName.get(name);
        if (existing) return existing;
        const org: Organization = { id: randomUUID(), tenantId, name };
        await store.saveOrganization(org);
        orgByName.set(name, org);
        return org;
      };

      const resolveTeam = async (orgId: string, teamName?: string): Promise<Team | undefined> => {
        const name = teamName?.trim();
        if (!name) return undefined;
        let byName = teamCache.get(orgId);
        if (!byName) {
          byName = new Map((await store.listTeams(orgId)).map((t) => [t.name, t]));
          teamCache.set(orgId, byName);
        }
        const existing = byName.get(name);
        if (existing) return existing;
        const team: Team = { id: randomUUID(), orgId, name };
        await store.saveTeam(team);
        byName.set(name, team);
        return team;
      };

      for (const [index, item] of items.entries()) {
        const username = item.username?.trim();
        const name = item.name?.trim();
        if (!username || !name) {
          errors.push({ index, username, error: 'username / name 必填' });
          continue;
        }
        const role = (item.role?.trim() || 'trainee') as UserRole;
        if (!ROLES.includes(role)) {
          errors.push({ index, username, error: `role 不合法: ${item.role}` });
          continue;
        }
        const org = await resolveOrg(item.orgName);
        if (!org) {
          errors.push({ index, username, error: '租户下无可用组织' });
          continue;
        }
        const team = await resolveTeam(org.id, item.teamName);

        const existing = await store.getUserByUsername(tenantId, username);
        if (existing) {
          const patched: User = {
            ...existing,
            name,
            role,
            orgId: org.id,
            teamId: team?.id,
            // 仅显式提供 password 时重置，否则保留原密码
            passwordHash: item.password ? hashPassword(item.password) : existing.passwordHash,
          };
          await store.saveUser(patched);
          updated += 1;
        } else {
          const user: User = {
            id: randomUUID(),
            tenantId,
            orgId: org.id,
            teamId: team?.id,
            name,
            role,
            username,
            passwordHash: hashPassword(item.password || DEFAULT_PASSWORD),
          };
          await store.saveUser(user);
          created += 1;
        }
      }

      return { created, updated, failed: errors.length, errors };
    }
  );
}
