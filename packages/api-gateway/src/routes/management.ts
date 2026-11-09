import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ManagerType, ProductKBEntry, SkillHeatmapCell, User, UserRole } from '@grasp-mvp/core';
import { buildImprovementGoal, confidenceIndexOf, deductionPoints } from '@grasp-mvp/scoring-engine';
import type { RouteContext } from '../ctx.js';
import { attentionKind, examReportsForUsers } from './supervisor.js';

/** 管理者角色（练习者之外均可进入团队能力管理） */
export const MANAGER_ROLES: UserRole[] = ['supervisor', 'admin', 'executive', 'platform'];

export const MANAGER_TYPE_LABELS: Record<ManagerType, string> = {
  org_head: '机构负责人',
  sales_head: '销售负责人',
  training_head: '培训负责人',
};

/** 管理者视角的数据范围：本人所属机构（若绑定了团队则收敛到本团队）下的练习者 */
interface ManagerScope {
  me: User;
  orgName: string | null;
  teamCount: number;
  members: User[];
}

async function buildManagerScope(ctx: RouteContext, request: FastifyRequest): Promise<ManagerScope | null> {
  const { store } = ctx;
  const me = await store.getUser(request.userId);
  if (!me || me.role === 'trainee') return null;

  const orgs = await store.listOrganizations(request.tenantId);
  const myOrg = orgs.find((o) => o.id === me.orgId);
  const teams = myOrg ? await store.listTeams(myOrg.id) : [];

  const allTrainees = await store.listUsers(request.tenantId, 'trainee');
  const members = allTrainees.filter(
    (u) => u.orgId === me.orgId && (!me.teamId || u.teamId === me.teamId)
  );

  return {
    me,
    orgName: myOrg?.name ?? null,
    teamCount: teams.length,
    members,
  };
}

async function teamNameMap(store: RouteContext['store'], tenantId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const org of await store.listOrganizations(tenantId)) {
    for (const t of await store.listTeams(org.id)) names.set(t.id, t.name);
  }
  return names;
}

export async function managementRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  /** 角色校验：仅管理者可访问 */
  const requireManager = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!MANAGER_ROLES.includes(request.userRole as UserRole)) {
      return reply.code(403).send({ error: '仅管理者可访问' });
    }
  };

  // ====== 管理总览 ======
  // 机构信息、成员规模、练习量、通过率、认证人数、知识库规模、需关注成员、近期活跃
  app.get('/management/overview', { preHandler: requireManager }, async (request, reply) => {
    const scope = await buildManagerScope(ctx, request);
    if (!scope) return reply.code(403).send({ error: '仅管理者可访问' });
    const { members, orgName, teamCount } = scope;

    let practiceCount = 0;
    let examCount = 0;
    let completedCount = 0;
    let passCount = 0;
    let scoreSum = 0;
    let scoredCount = 0;
    const certifiedMembers = new Set<string>();
    const attentionList: Array<{ userId: string; userName: string; reason: string }> = [];
    const recent: Array<{
      userId: string;
      name: string;
      practiceCount: number;
      lastAt: string | null;
      lastScore: number | null;
    }> = [];

    for (const m of members) {
      const sessions = await store.listSessions({ userId: m.id });
      let lastAt: string | null = null;
      let lastScore: number | null = null;
      let practice = 0;
      for (const s of sessions) {
        if (s.mode === 'practice') practiceCount += 1;
        if (s.mode === 'exam') examCount += 1;
        if (s.status !== 'completed') continue;
        completedCount += 1;
        const report = await store.getScoreReportBySession(s.id);
        if (!report) continue;
        practice += 1;
        scoreSum += report.totalScore;
        scoredCount += 1;
        if (report.passed) passCount += 1;
        const at = s.endedAt ?? s.startedAt;
        if (!lastAt || at > lastAt) {
          lastAt = at;
          lastScore = report.totalScore;
        }
      }
      const certs = await store.listCertRecords({ userId: m.id });
      if (certs.some((c) => c.passed)) certifiedMembers.add(m.id);

      const kind = await attentionKind(ctx, m.id);
      if (kind === 'consecutive_fail') {
        attentionList.push({ userId: m.id, userName: m.name, reason: '连续 2 次考核未达标' });
      } else if (kind === 'inactive') {
        attentionList.push({ userId: m.id, userName: m.name, reason: '7 天无任何会话' });
      }

      recent.push({ userId: m.id, name: m.name, practiceCount: practice, lastAt, lastScore });
    }

    const kb = await store.getProductKB(request.tenantId);
    const kindCounts: Record<string, number> = {};
    for (const e of kb?.entries ?? []) {
      kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
    }

    return {
      me: {
        id: scope.me.id,
        name: scope.me.name,
        role: scope.me.role,
        managerType: scope.me.managerType ?? null,
        managerTypeLabel: scope.me.managerType ? MANAGER_TYPE_LABELS[scope.me.managerType] : null,
      },
      org: { id: scope.me.orgId, name: orgName },
      stats: {
        members: members.length,
        teams: teamCount,
        practiceCount,
        examCount,
        completedCount,
        passRate: scoredCount > 0 ? Math.round((passCount / scoredCount) * 100) : null,
        avgScore: scoredCount > 0 ? Math.round(scoreSum / scoredCount) : null,
        certifiedMembers: certifiedMembers.size,
      },
      knowledgeBase: kb
        ? {
            name: kb.name,
            version: kb.version,
            entryCount: kb.entries.length,
            kindCounts,
            effectiveAt: kb.effectiveAt,
          }
        : { name: null, version: 0, entryCount: 0, kindCounts, effectiveAt: null },
      attention: attentionList,
      recent: recent
        .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
        .slice(0, 6),
    };
  });

  // ====== 团队成果 ======
  // 成员认证与考核成绩明细 + 团队汇总
  app.get('/management/team-results', { preHandler: requireManager }, async (request, reply) => {
    const scope = await buildManagerScope(ctx, request);
    if (!scope) return reply.code(403).send({ error: '仅管理者可访问' });
    const teamNames = await teamNameMap(store, request.tenantId);

    const members = await Promise.all(
      scope.members.map(async (m) => {
        const certs = (await store.listCertRecords({ userId: m.id })).sort((a, b) =>
          b.issuedAt.localeCompare(a.issuedAt)
        );
        const examSessions = (await store.listSessions({ userId: m.id, mode: 'exam' }))
          .filter((s) => s.status === 'completed')
          .sort((a, b) => (a.endedAt ?? a.startedAt).localeCompare(b.endedAt ?? b.startedAt));

        const issuedCerts = await Promise.all(
          certs.map(async (c) => {
            const window = await store.getExamWindow(c.examWindowId);
            const match = window?.name.match(/L\d/);
            return {
              id: c.id,
              examWindowName: window?.name ?? null,
              level: match ? match[0] : null,
              passed: c.passed,
              totalScore: c.totalScore,
              issuedAt: c.issuedAt,
            };
          })
        );

        // 考核成绩逐场对应证书（cert.sessionIds 指向产出证书的考核会话）
        const scores = await Promise.all(
          examSessions.map(async (s) => {
            const report = await store.getScoreReportBySession(s.id);
            const cert = certs.find((c) => c.sessionIds.includes(s.id));
            return {
              sessionId: s.id,
              totalScore: report?.totalScore ?? null,
              passed: report?.passed ?? cert?.passed ?? null,
              at: s.endedAt ?? s.startedAt,
            };
          })
        );
        const validScores = scores.filter((s) => s.totalScore != null);

        return {
          userId: m.id,
          name: m.name,
          teamId: m.teamId ?? null,
          teamName: m.teamId ? (teamNames.get(m.teamId) ?? null) : null,
          examCount: examSessions.length,
          passCount: scores.filter((s) => s.passed === true).length,
          bestScore: validScores.length > 0
            ? Math.max(...validScores.map((s) => s.totalScore as number))
            : null,
          latestScore: validScores.length > 0 ? validScores[validScores.length - 1].totalScore : null,
          avgScore: validScores.length > 0
            ? Math.round(validScores.reduce((a, s) => a + (s.totalScore as number), 0) / validScores.length)
            : null,
          certified: certs.some((c) => c.passed),
          certs: issuedCerts,
        };
      })
    );

    const certifiedCount = members.filter((m) => m.certified).length;
    const allScores = members
      .map((m) => m.latestScore)
      .filter((v): v is number => v !== null);

    return {
      summary: {
        memberCount: members.length,
        examAttempts: members.reduce((sum, m) => sum + m.examCount, 0),
        certifiedCount,
        certRate: members.length > 0 ? Math.round((certifiedCount / members.length) * 100) : null,
        avgScore: allScores.length > 0
          ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
          : null,
      },
      members: members.sort((a, b) => (b.bestScore ?? -1) - (a.bestScore ?? -1)),
    };
  });

  // ====== 团队能力分析 ======
  // 热力图（团队 × 技能点）+ 成员能力明细 + 团队薄弱技能 + 需关注成员
  app.get('/management/team-ability', { preHandler: requireManager }, async (request, reply) => {
    const scope = await buildManagerScope(ctx, request);
    if (!scope) return reply.code(403).send({ error: '仅管理者可访问' });
    const { members } = scope;

    const skillPoints = await store.listSkillPoints(request.tenantId);
    const nameBySkill = new Map(skillPoints.map((sp) => [sp.id, sp.name]));
    const teamNames = await teamNameMap(store, request.tenantId);

    // 热力图：按成员所属团队分组（无团队归「未分组」），只用基线考核报告
    const groups = new Map<string, User[]>();
    for (const m of members) {
      const key = m.teamId ?? '__none__';
      const arr = groups.get(key) ?? [];
      arr.push(m);
      groups.set(key, arr);
    }

    const heatmap: Array<SkillHeatmapCell & { teamName: string | null; skillPointName: string }> = [];
    for (const [teamId, teamMembers] of groups) {
      const reports = (
        await examReportsForUsers(ctx, teamMembers.map((m) => m.id), { baselineOnly: true })
      ).map((r) => r.report);
      for (const sp of skillPoints) {
        const withSkill = reports.filter((r) => r.skillScores.some((s) => s.skillPointId === sp.id));
        if (withSkill.length === 0) continue;
        heatmap.push({
          teamId: teamId === '__none__' ? '' : teamId,
          teamName: teamId === '__none__' ? '未分组' : (teamNames.get(teamId) ?? null),
          skillPointId: sp.id,
          skillPointName: sp.name,
          passRate: withSkill.filter((r) => r.passed).length / withSkill.length,
          avgScore: Math.round(
            withSkill.reduce(
              (sum, r) => sum + (r.skillScores.find((s) => s.skillPointId === sp.id)?.score ?? 0),
              0
            ) / withSkill.length
          ),
          sampleSize: withSkill.length,
        });
      }
    }

    // 成员能力明细：技能档位 + 最新得分（能力档案口径）
    const memberAbility = await Promise.all(
      members.map(async (m) => {
        const states = await store.listUserSkillStates(m.id);
        const sessions = await store.listSessions({ userId: m.id });
        const lastCompleted = sessions
          .filter((s) => s.status === 'completed')
          .sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt))[0];
        const lastReport = lastCompleted ? await store.getScoreReportBySession(lastCompleted.id) : undefined;

        const skillDetails = states
          .map((st) => {
            const latest = st.history[st.history.length - 1];
            return {
              skillPointId: st.skillPointId,
              name: nameBySkill.get(st.skillPointId) ?? st.skillPointId,
              level: st.currentLevel ?? null,
              latestScore: latest?.score ?? null,
              historyCount: st.history.length,
            };
          })
          .sort((a, b) => (a.latestScore ?? -1) - (b.latestScore ?? -1));

        const kind = await attentionKind(ctx, m.id);
        return {
          userId: m.id,
          name: m.name,
          teamId: m.teamId ?? null,
          teamName: m.teamId ? (teamNames.get(m.teamId) ?? null) : null,
          attention: kind,
          latestTotalScore: lastReport?.totalScore ?? null,
          avgLevel:
            skillDetails.length > 0
              ? Math.round((skillDetails.reduce((sum, d) => sum + (d.level ?? 0), 0) / skillDetails.length) * 10) / 10
              : null,
          skillDetails,
        };
      })
    );

    // 薄弱技能：全部成员最新得分按技能点取均值，升序前 3
    const weakSkills = skillPoints
      .map((sp) => {
        const scores = memberAbility
          .map((m) => m.skillDetails.find((d) => d.skillPointId === sp.id)?.latestScore ?? null)
          .filter((v): v is number => v !== null);
        if (scores.length === 0) return null;
        return {
          skillPointId: sp.id,
          skillPointName: sp.name,
          avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
          memberCount: scores.length,
        };
      })
      .filter((w): w is NonNullable<typeof w> => w !== null)
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 3);

    const attentionList = memberAbility
      .filter((m) => m.attention !== null)
      .map((m) => ({
        userId: m.userId,
        userName: m.name,
        reason: m.attention === 'consecutive_fail' ? '连续 2 次考核未达标' : '7 天无任何会话',
      }));

    return {
      skillPoints: skillPoints.map((sp) => ({ id: sp.id, name: sp.name })),
      heatmap,
      members: memberAbility,
      weakSkills,
      attention: attentionList,
    };
  });

  // ====== 成员档案（团队能力分析下钻） ======
  // 会话时间线 + 技能明细，按管理者机构范围过滤
  app.get<{ Params: { userId: string } }>(
    '/management/team-ability/member/:userId',
    { preHandler: requireManager },
    async (request, reply) => {
      const scope = await buildManagerScope(ctx, request);
      if (!scope) return reply.code(403).send({ error: '仅管理者可访问' });
      const target = scope.members.find((m) => m.id === request.params.userId);
      if (!target) return reply.code(404).send({ error: '成员不存在或不在你的管理范围内' });

      const sessions = (await store.listSessions({ userId: target.id }))
        .filter((s) => s.status === 'completed')
        .sort((a, b) => (a.endedAt ?? a.startedAt).localeCompare(b.endedAt ?? b.startedAt));
      const timeline = await Promise.all(
        sessions.map(async (s) => {
          const [scenario, report, recordings] = await Promise.all([
            store.getScenario(s.scenarioId),
            store.getScoreReportBySession(s.id),
            store.listSessionRecordings({ sessionId: s.id }),
          ]);
          return {
            sessionId: s.id,
            at: s.endedAt ?? s.startedAt,
            scenarioName: scenario?.name ?? s.scenarioId,
            mode: s.mode,
            totalScore: report?.totalScore ?? null,
            passed: report?.passed ?? null,
            // 录音统计：>0 时管理者可下钻查看回放与评分详情
            recTurns: recordings.length,
            recDurationSec:
              recordings.length > 0
                ? Math.round(recordings.reduce((sum, r) => sum + r.durationSec, 0))
                : null,
          };
        })
      );

      const states = await store.listUserSkillStates(target.id);
      const skillPoints = await store.listSkillPoints(request.tenantId);
      const nameBySkill = new Map(skillPoints.map((sp) => [sp.id, sp.name]));
      const skillDetails = states.map((st) => ({
        skillPointId: st.skillPointId,
        name: nameBySkill.get(st.skillPointId) ?? st.skillPointId,
        level: st.currentLevel ?? null,
        history: st.history,
      }));

      return { userId: target.id, name: target.name, timeline, skillDetails };
    }
  );

  // ====== 成员单次练习详情：录音回放 + 评分报告（管理者下钻查看） ======
  app.get<{ Params: { userId: string; sessionId: string } }>(
    '/management/team-ability/member/:userId/session/:sessionId',
    { preHandler: requireManager },
    async (request, reply) => {
      const scope = await buildManagerScope(ctx, request);
      if (!scope) return reply.code(403).send({ error: '仅管理者可访问' });
      const target = scope.members.find((m) => m.id === request.params.userId);
      if (!target) return reply.code(404).send({ error: '成员不存在或不在你的管理范围内' });

      const session = await store.getSession(request.params.sessionId);
      if (!session || session.userId !== target.id) {
        return reply.code(404).send({ error: '会话不存在' });
      }

      const [scenario, report, recordings] = await Promise.all([
        store.getScenario(session.scenarioId),
        store.getScoreReportBySession(session.id),
        store.listSessionRecordings({ sessionId: session.id }),
      ]);

      // 报告口径与学员复盘页 /sessions/:id/review 保持一致
      let reportWithGoal = null;
      if (report) {
        const deduction = deductionPoints(report.items);
        const baseScore = report.baseScore ?? Math.min(100, report.totalScore + deduction);
        reportWithGoal = {
          ...report,
          baseScore,
          confidenceIndex: report.confidenceIndex ?? confidenceIndexOf(report.items),
          improvementGoal:
            report.improvementGoal ??
            buildImprovementGoal(report.items, await store.listScoreItemDefs(session.tenantId), report.violations, baseScore),
        };
      }

      let prevScore: number | null = null;
      if (session.prevSessionId) {
        prevScore = (await store.getScoreReportBySession(session.prevSessionId))?.totalScore ?? null;
      }

      const sorted = [...recordings].sort((a, b) => a.turnSeq - b.turnSeq);
      return {
        session: {
          id: session.id,
          scenarioName: scenario?.name ?? session.scenarioId,
          mode: session.mode,
          status: session.status,
          at: session.endedAt ?? session.startedAt,
          durationSec: session.endedAt
            ? Math.max(0, Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000))
            : null,
        },
        report: reportWithGoal,
        prevScore,
        recordings: sorted.map((r) => ({
          id: r.id,
          turnSeq: r.turnSeq,
          durationSec: r.durationSec,
          fileSize: r.fileSize,
          createdAt: r.createdAt,
        })),
      };
    }
  );

  // ====== 知识库管理（产品知识库读写，与 /workshop/product-kb 同存储） ======
  app.get('/management/knowledge-base', { preHandler: requireManager }, async (request) => {
    const kb = await store.getProductKB(request.tenantId);
    const entries = kb?.entries ?? [];
    const kindCounts: Record<string, number> = {};
    for (const e of entries) kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
    return {
      kb: kb ?? null,
      kindCounts,
      entries: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.title,
        content: e.content,
        ...(e.frequency !== undefined ? { frequency: e.frequency } : {}),
      })),
    };
  });

  app.put<{
    Body: { name?: string; entries?: Array<Partial<ProductKBEntry>>; expectedVersion?: number };
  }>('/management/knowledge-base', { preHandler: requireManager }, async (request, reply) => {
    const { name, entries, expectedVersion } = request.body ?? {};
    if (!name?.trim()) return reply.code(400).send({ error: 'name 必填' });
    if (!Array.isArray(entries)) return reply.code(400).send({ error: 'entries 必须为数组' });
    const error = validateEntries(entries);
    if (error) return reply.code(400).send({ error });

    const existing = await store.getProductKB(request.tenantId);
    if (expectedVersion !== undefined && expectedVersion !== (existing?.version ?? 0)) {
      return reply.code(409).send({ error: '知识库已被其他用户修改，请刷新后重试', currentVersion: existing?.version ?? 0 });
    }
    const version = (existing?.version ?? 0) + 1;
    const normalized: ProductKBEntry[] = entries.map((e) => ({
      id: e.id ?? randomUUID(),
      kind: e.kind as ProductKBEntry['kind'],
      title: e.title!.trim(),
      content: e.content!.trim(),
      ...(e.frequency !== undefined ? { frequency: e.frequency } : {}),
    }));
    await store.saveProductKB({
      id: existing?.id ?? randomUUID(),
      tenantId: request.tenantId,
      name: name.trim(),
      version,
      entries: normalized,
      effectiveAt: new Date().toISOString(),
    });
    return { success: true, version };
  });

  app.post<{
    Body: { entries?: Array<Partial<ProductKBEntry>> };
  }>('/management/knowledge-base', { preHandler: requireManager }, async (request, reply) => {
    const entries = request.body?.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      return reply.code(400).send({ error: 'entries 必填且非空' });
    }
    const error = validateEntries(entries);
    if (error) return reply.code(400).send({ error });

    const existing = await store.getProductKB(request.tenantId);
    if (!existing) return reply.code(409).send({ error: '知识库不存在，请先整体创建' });
    const byId = new Map(existing.entries.map((e) => [e.id, e]));
    let added = 0;
    let updated = 0;
    for (const e of entries) {
      const id = e.id ?? randomUUID();
      if (byId.has(id)) updated += 1;
      else added += 1;
      byId.set(id, {
        id,
        kind: e.kind as ProductKBEntry['kind'],
        title: e.title!.trim(),
        content: e.content!.trim(),
        ...(e.frequency !== undefined ? { frequency: e.frequency } : {}),
      });
    }
    await store.saveProductKB({
      ...existing,
      version: existing.version + 1,
      entries: [...byId.values()],
      effectiveAt: new Date().toISOString(),
    });
    return reply.code(201).send({ added, updated, total: byId.size, version: existing.version + 1 });
  });
}

const KB_KINDS: ProductKBEntry['kind'][] = ['keypoint', 'redline', 'competitor', 'faq'];

function validateEntries(entries: Array<Partial<ProductKBEntry>>): string | null {
  for (const [i, e] of entries.entries()) {
    if (!e?.kind || !KB_KINDS.includes(e.kind)) {
      return `entries[${i}].kind 须为 keypoint / redline / competitor / faq`;
    }
    if (!e.title?.trim() || !e.content?.trim()) {
      return `entries[${i}] 的 title / content 必填`;
    }
  }
  return null;
}
