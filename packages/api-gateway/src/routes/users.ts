import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ManagerType, Organization, Team, User, UserRole } from '@grasp-mvp/core';
import { hashPassword } from '@grasp-mvp/infra';
import type { RouteContext } from '../ctx.js';
import { requireRoles } from '../auth.js';

const ROLES: UserRole[] = ['trainee', 'supervisor', 'admin', 'executive', 'platform'];

/** 管理者可选的管理者类型 */
const MANAGER_TYPES: ManagerType[] = ['org_head', 'sales_head', 'training_head'];

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

  // 导出当前用户全部数据（个人信息/会话/评分报告/申诉/认证/技能状态/场景任务/偏好），JSON 附件下载
  app.get('/users/me/export', async (request, reply) => {
    const user = await store.getUser(request.userId);
    if (!user) return reply.code(404).send({ error: '用户不存在' });
    const sessions = await store.listSessions({ userId: user.id });
    const scoreReports = [];
    for (const s of sessions) {
      const report = await store.getScoreReportBySession(s.id);
      if (report) scoreReports.push(report);
    }
    const [appeals, certRecords, userSkillStates, scenarioTasks] = await Promise.all([
      store.listAppeals({ userId: user.id }),
      store.listCertRecords({ userId: user.id }),
      store.listUserSkillStates(user.id),
      store.listScenarioTasks(user.id),
    ]);
    const { passwordHash: _passwordHash, ...publicInfo } = user;
    const payload = {
      exportedAt: new Date().toISOString(),
      user: publicInfo,
      sessions,
      scoreReports,
      appeals,
      certRecords,
      userSkillStates,
      scenarioTasks,
      preferences: user.preferences ?? {},
    };
    return reply
      .header('Content-Disposition', 'attachment; filename="grasp-data-export.json"')
      .type('application/json; charset=utf-8')
      .send(JSON.stringify(payload, null, 2));
  });

  // 注销当前账号：删除用户及其全部关联数据（会话/报告/申诉/认证/技能状态/任务/事件）
  app.delete('/users/me', async (request, reply) => {
    const user = await store.getUser(request.userId);
    if (!user) return reply.code(404).send({ error: '用户不存在' });
    await store.deleteUserData(user.id);
    await store.deleteUser(user.id);
    return reply.code(204).send();
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
   * 更新指定用户（admin 专属）：姓名 / 角色 / 管理者类型 / 所属机构 / 团队。
   * 角色与管理者类型联动：设为练习者时清除 managerType，设为管理者且未指定类型时默认「机构负责人」。
   */
  app.patch<{ Params: { id: string }; Body: Partial<Pick<User, 'name' | 'role' | 'orgId' | 'teamId'>> & { managerType?: ManagerType | null } }>(
    '/users/:id',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const target = await store.getUser(request.params.id);
      if (!target) return reply.code(404).send({ error: '用户不存在' });
      if (target.tenantId !== request.tenantId) {
        return reply.code(403).send({ error: '无权访问该用户' });
      }

      const { name, role, orgId, teamId, managerType } = request.body ?? {};

      let nextRole = target.role;
      if (role !== undefined) {
        if (!ROLES.includes(role)) {
          return reply.code(400).send({ error: `role 不合法: ${role}` });
        }
        nextRole = role;
      }

      let nextManagerType = target.managerType;
      if (managerType !== undefined) {
        if (managerType !== null && !MANAGER_TYPES.includes(managerType)) {
          return reply.code(400).send({ error: `managerType 不合法: ${managerType}` });
        }
        // 练习者不允许持有管理者类型
        if (nextRole === 'trainee' && managerType !== null) {
          return reply.code(400).send({ error: '练习者角色不能设置管理者类型' });
        }
        nextManagerType = managerType ?? undefined;
      }
      // 角色切为练习者：清掉管理者类型；角色切为管理者且从未设置过：默认机构负责人
      if (role !== undefined) {
        if (role === 'trainee') nextManagerType = undefined;
        else if (!nextManagerType) nextManagerType = 'org_head';
      }

      if (orgId !== undefined) {
        const org = (await store.listOrganizations(request.tenantId)).find((o) => o.id === orgId);
        if (!org) return reply.code(400).send({ error: '机构不存在' });
      }
      if (teamId !== undefined) {
        const team = await store.getTeam(teamId);
        if (!team || team.orgId !== (orgId ?? target.orgId)) {
          return reply.code(400).send({ error: '团队不存在或不属于目标机构' });
        }
      }

      const patched: User = {
        ...target,
        ...(name?.trim() ? { name: name.trim() } : {}),
        role: nextRole,
        managerType: nextManagerType,
        ...(orgId !== undefined ? { orgId } : {}),
        ...(teamId !== undefined ? { teamId } : {}),
      };
      await store.saveUser(patched);
      const { passwordHash: _passwordHash, ...rest } = patched;
      return { user: rest };
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
