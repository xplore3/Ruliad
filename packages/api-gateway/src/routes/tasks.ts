import type { FastifyInstance } from 'fastify';
import type { ScenarioTask } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function tasksRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 当前用户的任务视图 + 技能地图
  app.get('/tasks', async (request) => {
    const userId = request.userId;
    const tenantId = request.tenantId;

    // 命中学习路径（用户团队被分配）时按路径生成任务；否则全场景 available
    const user = await store.getUser(userId);
    const path = user?.teamId
      ? (await store.listLearningPaths(tenantId)).find((p) =>
          p.assignedTeamIds.includes(user.teamId!)
        )
      : undefined;
    const pathItems = path ? [...path.items].sort((a, b) => a.order - b.order) : null;

    let tasks = await store.listScenarioTasks(userId);
    const scenarios = await store.listScenarios(tenantId);

    if (pathItems) {
      // 任务补初始化只针对路径内场景，并按当前成绩重算锁定状态：
      // 第一个未达标项及其后全部锁定（首项本身 available），已达标项保持
      let gated = false;
      const taskByScenario = new Map(tasks.map((t) => [t.scenarioId, t]));
      for (const item of pathItems) {
        const existing = taskByScenario.get(item.scenarioId);
        const passed =
          existing !== undefined &&
          (existing.status === 'passed' ||
            (existing.bestScore !== undefined && existing.bestScore >= item.passScore));
        let status: ScenarioTask['status'];
        if (passed) {
          status = existing!.status === 'locked' ? 'passed' : existing!.status;
        } else if (!gated) {
          status = existing && existing.status !== 'locked' ? existing.status : 'available';
          gated = true;
        } else {
          status = 'locked';
        }
        if (!existing || existing.status !== status) {
          await store.upsertScenarioTask({
            ...(existing ?? { userId, scenarioId: item.scenarioId }),
            status,
          });
        }
      }
      const pathScenarioIds = new Set(pathItems.map((i) => i.scenarioId));
      tasks = (await store.listScenarioTasks(userId)).filter((t) =>
        pathScenarioIds.has(t.scenarioId)
      );
    } else {
      // 为尚未有任务的场景补齐（不仅在全空时初始化，避免先建会话导致漏初始化）
      const existing = new Set(tasks.map((t) => t.scenarioId));
      for (const s of scenarios) {
        if (!existing.has(s.id)) {
          const task: ScenarioTask = { userId, scenarioId: s.id, status: 'available' };
          await store.upsertScenarioTask(task);
        }
      }
      tasks = await store.listScenarioTasks(userId);
    }
    const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
    const itemByScenario = new Map(pathItems?.map((i) => [i.scenarioId, i]) ?? []);
    const personaIds = [...new Set(scenarios.map((s) => s.personaConfigId))];
    const personaById = new Map(
      (await Promise.all(personaIds.map((id) => store.getPersonaConfig(id))))
        .filter((p) => p !== undefined)
        .map((p) => [p.id, p])
    );
    const skillPoints = await store.listSkillPoints(tenantId);
    const skillPointById = new Map(skillPoints.map((sp) => [sp.id, sp]));

    const now = Date.now();
    const taskViews = await Promise.all(
      tasks.map(async (t) => {
        const scenario = scenarioById.get(t.scenarioId);
        const persona = scenario ? personaById.get(scenario.personaConfigId) : undefined;
        const pathItem = itemByScenario.get(t.scenarioId);
        let lastScore: number | null = null;
        if (t.lastSessionId) {
          const report = await store.getScoreReportBySession(t.lastSessionId);
          lastScore = report?.totalScore ?? null;
        }
        if (lastScore === null) lastScore = t.bestScore ?? null;

        let reviewLabel: 'D7' | 'D21' | undefined;
        if (t.isReview && t.reviewDueAt) {
          const dueInMs = new Date(t.reviewDueAt).getTime() - now;
          if (dueInMs <= ONE_DAY_MS) reviewLabel = 'D7';
        }

        return {
          scenarioId: t.scenarioId,
          scenarioName: scenario?.name ?? '（场景已删除）',
          durationMinutes: scenario?.durationMinutes ?? null,
          difficulty: scenario?.difficulty ?? null,
          status: t.status,
          bestScore: t.bestScore,
          lastScore,
          needsRetry: t.status === 'failed_pending_retry',
          isReview: t.isReview ?? false,
          reviewDueAt: t.reviewDueAt,
          reviewLabel,
          personaName: persona?.name ?? null,
          order: pathItem?.order ?? null,
          requiredPassScore: pathItem?.passScore ?? null,
          personaTitle: scenario?.personaTitle ?? null,
          methodology: scenario?.methodology ?? null,
          // 「技能点来源条 · 累计被练习 N 次」口径：取场景首个技能点的练习次数
          practiceCount:
            (scenario?.skillPointIds?.length
              ? skillPointById.get(scenario.skillPointIds[0])?.practiceCount
              : undefined) ?? null,
        };
      })
    );
    // 命中路径时按路径 order 排序返回
    if (pathItems) {
      taskViews.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    const states = await store.listUserSkillStates(userId);
    const stateBySkill = new Map(states.map((s) => [s.skillPointId, s]));
    const skillMap = skillPoints.map((sp) => {
      const state = stateBySkill.get(sp.id);
      return {
        skillPointId: sp.id,
        name: sp.assetName ?? sp.name,
        skillPointName: sp.name,
        currentLevel: state?.currentLevel ?? 0,
        maxLevel: 3,
        historyCount: state?.history.length ?? 0,
        source: sp.source ?? null,
        locked: sp.locked ?? false,
      };
    });

    // 最近截止的认证窗口：本人名单内且 open 的窗口中 endsAt 最近的一个
    const nextWindow = (await store.listExamWindows(tenantId))
      .filter((w) => w.status === 'open' && w.userIds.includes(userId))
      .sort((a, b) => a.endsAt.localeCompare(b.endsAt))[0];
    const nextExamWindow = nextWindow
      ? {
          id: nextWindow.id,
          name: nextWindow.name,
          startsAt: nextWindow.startsAt,
          endsAt: nextWindow.endsAt,
        }
      : null;

    return { tasks: taskViews, skillMap, nextExamWindow };
  });
}
