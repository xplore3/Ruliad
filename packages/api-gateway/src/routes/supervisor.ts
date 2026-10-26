import type { FastifyInstance } from 'fastify';
import type { ScoreReport, SkillHeatmapCell } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 拉取一组用户的全部考核报告（completed exam 会话）；
 * baselineOnly=true 时只统计不挂考核窗口的基线测评会话（组织/团队热力图口径，
 * 避免名单窗口的小样本集中考核扭曲组织基线） */
export async function examReportsForUsers(
  ctx: RouteContext,
  userIds: string[],
  opts?: { baselineOnly?: boolean }
): Promise<Array<{ userId: string; report: ScoreReport }>> {
  const { store } = ctx;
  const out: Array<{ userId: string; report: ScoreReport }> = [];
  for (const userId of userIds) {
    const sessions = await store.listSessions({ userId, mode: 'exam' });
    for (const s of sessions) {
      if (s.status !== 'completed') continue;
      if (opts?.baselineOnly && s.examWindowId !== undefined) continue;
      const report = await store.getScoreReportBySession(s.id);
      if (report) out.push({ userId, report });
    }
  }
  return out;
}

/** 需关注判定：连续 2 次考核未达标 或 7 天无任何会话（overview 与 members 共用） */
async function attentionKind(
  ctx: RouteContext,
  userId: string
): Promise<'consecutive_fail' | 'inactive' | null> {
  const { store } = ctx;
  const certs = (await store.listCertRecords({ userId })).sort((a, b) =>
    b.issuedAt.localeCompare(a.issuedAt)
  );
  if (certs.length >= 2 && !certs[0].passed && !certs[1].passed) return 'consecutive_fail';
  const sessions = await store.listSessions({ userId });
  const lastAt = sessions
    .map((s) => s.endedAt ?? s.startedAt)
    .sort()
    .pop();
  if (!lastAt || Date.now() - new Date(lastAt).getTime() > WEEK_MS) return 'inactive';
  return null;
}

export async function supervisorRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 主管看板：技能热力图 + 需关注学员 + 薄弱技能 + 辅导建议
  app.get('/supervisor/overview', async (request) => {
    const tenantId = request.tenantId;
    const orgs = await store.listOrganizations(tenantId);
    const teams = (await Promise.all(orgs.map((o) => store.listTeams(o.id)))).flat();
    const users = await store.listUsers(tenantId, 'trainee');
    const skillPoints = await store.listSkillPoints(tenantId);

    // 热力图：teamId × skillPointId，只用基线考核报告（不含窗口内集中考核）
    const heatmap: SkillHeatmapCell[] = [];
    const teamReports = new Map<string, ScoreReport[]>();
    for (const team of teams) {
      const memberIds = users.filter((u) => u.teamId === team.id).map((u) => u.id);
      const reports = (await examReportsForUsers(ctx, memberIds, { baselineOnly: true })).map(
        (r) => r.report
      );
      teamReports.set(team.id, reports);
      for (const sp of skillPoints) {
        const withSkill = reports.filter((r) => r.skillScores.some((s) => s.skillPointId === sp.id));
        if (withSkill.length === 0) continue;
        heatmap.push({
          teamId: team.id,
          skillPointId: sp.id,
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

    // 需关注：连续 2 次考核未达标 或 7 天无任何会话
    const attention: Array<{ userId: string; userName: string; reason: string }> = [];
    for (const user of users) {
      const kind = await attentionKind(ctx, user.id);
      if (kind === 'consecutive_fail') {
        attention.push({ userId: user.id, userName: user.name, reason: '连续 2 次考核未达标' });
      } else if (kind === 'inactive') {
        attention.push({ userId: user.id, userName: user.name, reason: '7 天无任何会话' });
      }
    }

    // 薄弱技能：全部团队 exam 报告按技能点平均分，升序前 3
    const allReports = [...teamReports.values()].flat();
    const weakSkills = skillPoints
      .map((sp) => {
        const withSkill = allReports.filter((r) =>
          r.skillScores.some((s) => s.skillPointId === sp.id)
        );
        if (withSkill.length === 0) return null;
        return {
          skillPointId: sp.id,
          skillPointName: sp.name,
          avgScore: Math.round(
            withSkill.reduce(
              (sum, r) => sum + (r.skillScores.find((s) => s.skillPointId === sp.id)?.score ?? 0),
              0
            ) / withSkill.length
          ),
        };
      })
      .filter((w) => w !== null)
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 3);

    const coachingTopics = weakSkills.map(
      (w) => `「${w.skillPointName}」平均 ${w.avgScore} 分，建议安排专项辅导与情景复训`
    );

    return { heatmap, attention, weakSkills, coachingTopics };
  });

  // 主管名下团队成员列表（admin 无 teamId 时返回本租户全部 trainee）
  // 每项附：认证状态 / 最弱技能点 / 考核次数 / 关注标记（与 overview 的 attention 同规则）
  app.get('/supervisor/members', async (request) => {
    const me = await store.getUser(request.userId);
    const trainees = await store.listUsers(request.tenantId, 'trainee');
    const members = me?.teamId ? trainees.filter((u) => u.teamId === me.teamId) : trainees;

    const certLevelOf = async (examWindowId: string): Promise<string> => {
      const window = await store.getExamWindow(examWindowId);
      const match = window?.name.match(/L\d/);
      return match ? match[0] : '';
    };

    return Promise.all(
      members.map(async (u) => {
        const certs = (await store.listCertRecords({ userId: u.id })).sort((a, b) =>
          b.issuedAt.localeCompare(a.issuedAt)
        );
        const latest = certs[0];

        let certStatus: string;
        if (!latest) {
          certStatus = '未开始';
        } else if (latest.passed) {
          const level = await certLevelOf(latest.examWindowId);
          certStatus = level ? `已认证 ${level}` : '已认证';
        } else {
          certStatus = '未通过';
        }

        // 最弱技能点：最新一张证书的 skillDetail 最低分
        let weakestSkillName: string | null = null;
        if (latest && Object.keys(latest.skillDetail).length > 0) {
          const [weakestId] = Object.entries(latest.skillDetail).sort((a, b) => a[1] - b[1])[0];
          weakestSkillName = (await store.getSkillPoint(weakestId))?.name ?? weakestId;
        }

        const kind = await attentionKind(ctx, u.id);
        const attention =
          kind === 'consecutive_fail' ? '连续未达标' : kind === 'inactive' ? '本周未开练' : null;

        return {
          id: u.id,
          name: u.name,
          teamId: u.teamId ?? null,
          certStatus,
          weakestSkillName,
          examCount: certs.length,
          attention,
        };
      })
    );
  });

  // 学员个人档案：时间线 + 技能明细（刻意不含对话原文）
  app.get<{ Params: { userId: string } }>('/supervisor/members/:userId', async (request, reply) => {
    const user = await store.getUser(request.params.userId);
    if (!user) return reply.code(404).send({ error: '用户不存在' });

    const sessions = (await store.listSessions({ userId: user.id }))
      .filter((s) => s.status === 'completed')
      .sort((a, b) => (a.endedAt ?? a.startedAt).localeCompare(b.endedAt ?? b.startedAt));
    const timeline = await Promise.all(
      sessions.map(async (s) => {
        const scenario = await store.getScenario(s.scenarioId);
        const report = await store.getScoreReportBySession(s.id);
        return {
          sessionId: s.id,
          at: s.endedAt ?? s.startedAt,
          scenarioName: scenario?.name ?? s.scenarioId,
          totalScore: report?.totalScore ?? null,
          passed: report?.passed ?? null,
        };
      })
    );

    const states = await store.listUserSkillStates(user.id);
    const skillDetails = await Promise.all(
      states.map(async (st) => {
        const sp = await store.getSkillPoint(st.skillPointId);
        const latest = st.history[st.history.length - 1];
        return {
          skillPointId: st.skillPointId,
          name: sp?.name ?? st.skillPointId,
          latestScore: latest?.score ?? null,
          level: st.currentLevel,
        };
      })
    );

    // 个性化辅导建议：取该成员最新一张 cert 的 skillDetail，找分数最低的 2 个技能点
    const certs = (await store.listCertRecords({ userId: user.id })).sort((a, b) =>
      b.issuedAt.localeCompare(a.issuedAt)
    );
    const latestDetail = certs[0]?.skillDetail ?? {};
    const coachingTopics = await Promise.all(
      Object.entries(latestDetail)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2)
        .map(async ([skillPointId, score]) => {
          const sp = await store.getSkillPoint(skillPointId);
          return `重点辅导：${sp?.name ?? skillPointId}（最近考核 ${score} 分）`;
        })
    );

    const { passwordHash: _passwordHash, ...safeUser } = user;
    return { user: safeUser, timeline, skillDetails, coachingTopics };
  });
}
