import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { LearningPath, LearningPathItem } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';
import { requireRoles } from '../auth.js';

interface PathBody {
  name?: string;
  items?: LearningPathItem[];
}

/** 校验学习路径请求体；返回错误消息，null 表示通过 */
function validatePathBody(body: PathBody): string | null {
  if (!body.name?.trim()) return 'name 必填';
  if (!Array.isArray(body.items) || body.items.length === 0) return 'items 至少一项';
  for (const item of body.items) {
    if (!item?.scenarioId) return '每个 item 的 scenarioId 必填';
    if (!Number.isFinite(item.passScore) || item.passScore < 0 || item.passScore > 100) {
      return `场景 ${item.scenarioId} 的 passScore 须为 0-100`;
    }
  }
  return null;
}

export async function pathsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 校验路径内场景：存在且属于本租户
  async function checkScenarioIds(items: LearningPathItem[], tenantId: string): Promise<string | null> {
    for (const item of items) {
      const scenario = await store.getScenario(item.scenarioId);
      if (!scenario || scenario.tenantId !== tenantId) {
        return `场景不存在: ${item.scenarioId}`;
      }
    }
    return null;
  }

  // 学习路径列表（展开场景名与团队名）
  app.get('/learning-paths', async (request) => {
    const paths = await store.listLearningPaths(request.tenantId);
    const items = await Promise.all(
      paths.map(async (p) => ({
        ...p,
        items: await Promise.all(
          [...p.items]
            .sort((a, b) => a.order - b.order)
            .map(async (item) => ({
              ...item,
              scenarioName: (await store.getScenario(item.scenarioId))?.name ?? item.scenarioId,
            }))
        ),
        assignedTeamNames: (
          await Promise.all(p.assignedTeamIds.map((id) => store.getTeam(id)))
        )
          .filter((t) => t !== undefined)
          .map((t) => t.name),
      }))
    );
    return { learningPaths: items };
  });

  // 创建学习路径
  app.post<{ Body: PathBody }>(
    '/learning-paths',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const body = request.body ?? {};
      const error = validatePathBody(body);
      if (error) return reply.code(400).send({ error });
      const scenarioError = await checkScenarioIds(body.items!, request.tenantId);
      if (scenarioError) return reply.code(400).send({ error: scenarioError });
      const path: LearningPath = {
        id: randomUUID(),
        tenantId: request.tenantId,
        name: body.name!.trim(),
        items: body.items!.map((item, i) => ({
          scenarioId: item.scenarioId,
          passScore: item.passScore,
          order: Number.isFinite(item.order) ? item.order : i + 1,
        })),
        assignedTeamIds: [],
      };
      await store.upsertLearningPath(path);
      return reply.code(201).send(path);
    }
  );

  // 更新学习路径（整体替换 name/items，保留 assignedTeamIds）
  app.put<{ Params: { id: string }; Body: PathBody }>(
    '/learning-paths/:id',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const existing = await store.getLearningPath(request.params.id);
      if (!existing || existing.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '学习路径不存在' });
      }
      const body = request.body ?? {};
      const error = validatePathBody(body);
      if (error) return reply.code(400).send({ error });
      const scenarioError = await checkScenarioIds(body.items!, request.tenantId);
      if (scenarioError) return reply.code(400).send({ error: scenarioError });
      const path: LearningPath = {
        ...existing,
        name: body.name!.trim(),
        items: body.items!.map((item, i) => ({
          scenarioId: item.scenarioId,
          passScore: item.passScore,
          order: Number.isFinite(item.order) ? item.order : i + 1,
        })),
      };
      await store.upsertLearningPath(path);
      return path;
    }
  );

  // 分配团队
  app.post<{ Params: { id: string }; Body: { teamIds?: string[] } }>(
    '/learning-paths/:id/assign',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const existing = await store.getLearningPath(request.params.id);
      if (!existing || existing.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '学习路径不存在' });
      }
      const teamIds = request.body?.teamIds;
      if (!Array.isArray(teamIds)) {
        return reply.code(400).send({ error: 'teamIds 必须为数组' });
      }
      for (const teamId of teamIds) {
        if (!(await store.getTeam(teamId))) {
          return reply.code(400).send({ error: `团队不存在: ${teamId}` });
        }
      }
      const path: LearningPath = { ...existing, assignedTeamIds: teamIds };
      await store.upsertLearningPath(path);
      return path;
    }
  );

  // 本租户组织 + 团队嵌套结构（分配团队对话框的数据源）
  app.get('/teams', { preHandler: requireRoles('admin') }, async (request) => {
    const orgs = await store.listOrganizations(request.tenantId);
    const users = await store.listUsers(request.tenantId);
    const organizations = await Promise.all(
      orgs.map(async (org) => ({
        orgId: org.id,
        orgName: org.name,
        teams: (await store.listTeams(org.id)).map((team) => ({
          id: team.id,
          name: team.name,
          supervisorId: team.supervisorId ?? null,
          memberCount: users.filter((u) => u.teamId === team.id).length,
        })),
      }))
    );
    return { organizations };
  });
}
