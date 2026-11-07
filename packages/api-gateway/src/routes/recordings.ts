/**
 * 录音管理路由（admin）：查看/回放/删除全部用户的练习录音
 *
 * - recordingsRoutes       —— 列表/详情/删除，注册时整组挂 requireRoles('admin', 'platform')
 * - recordingAudioRoutes   —— 音频回放流，注册到无角色守卫的组；浏览器 <audio> 标签无法带
 *                              Authorization 头，token 经 query 传入，路由内用 verifyToken 自校验
 */
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { SessionRecording, UserRole } from '@grasp-mvp/core';
import type { RecordingFilter } from '@grasp-mvp/infra';
import type { RouteContext } from '../ctx.js';
import { tokenFailReason, verifyToken } from '../auth.js';
import { deleteRecordingFile } from '../services/recording.js';
import { MANAGER_ROLES } from './management.js';

/** 录音列表项：录音元数据 + join 后的用户/场景名称 */
export interface RecordingItem {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  scenarioId: string;
  scenarioName: string;
  mode: 'practice' | 'exam';
  turnSeq: number;
  durationSec: number;
  fileSize: number;
  createdAt: string;
}

/** 会话分组：同一场练习会话的全部录音，按说话顺序（turnSeq 升序）排列 */
export interface RecordingGroup {
  sessionId: string;
  userId: string;
  userName: string;
  scenarioId: string;
  scenarioName: string;
  mode: 'practice' | 'exam';
  /** 会话内录音条数 */
  turnCount: number;
  /** 会话内最早一条录音时间 */
  startedAt: string;
  /** 会话内最近一条录音时间 */
  lastAt: string;
  items: RecordingItem[];
}

const DEFAULT_GROUPS_PER_PAGE = 20;
const MAX_GROUPS_PER_PAGE = 50;

/** join 用户/场景名称（简单数据量下逐条查询即可；场景删除后回退显示 id） */
async function joinNames(
  ctx: RouteContext,
  rows: SessionRecording[]
): Promise<RecordingItem[]> {
  const { store } = ctx;
  return Promise.all(
    rows.map(async (r) => {
      const [user, scenario] = await Promise.all([
        store.getUser(r.userId),
        store.getScenario(r.scenarioId),
      ]);
      return {
        id: r.id,
        sessionId: r.sessionId,
        userId: r.userId,
        userName: user?.name ?? r.userId,
        scenarioId: r.scenarioId,
        scenarioName: scenario?.name ?? r.scenarioId,
        mode: r.mode,
        turnSeq: r.turnSeq,
        durationSec: r.durationSec,
        fileSize: r.fileSize,
        createdAt: r.createdAt,
      };
    })
  );
}

export async function recordingsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 录音列表（全部用户）：按练习会话分组——组内按说话顺序（turnSeq 升序），
  // 会话之间按最近录音时间倒序；支持按用户/会话/场景/模式/关键字过滤
  app.get<{
    Querystring: {
      userId?: string;
      sessionId?: string;
      scenarioId?: string;
      mode?: string;
      keyword?: string;
      limit?: string;
      offset?: string;
    };
  }>('/recordings', async (request, reply) => {
    const { userId, sessionId, scenarioId, mode, keyword, limit, offset } = request.query ?? {};
    if (mode !== undefined && mode !== 'practice' && mode !== 'exam') {
      return reply.code(400).send({ error: 'mode 只能是 practice / exam' });
    }

    const filter: RecordingFilter = { tenantId: request.tenantId };
    if (userId) filter.userId = userId;
    if (sessionId) filter.sessionId = sessionId;
    if (scenarioId) filter.scenarioId = scenarioId;
    if (mode) filter.mode = mode;

    let all: SessionRecording[];
    try {
      all = await store.listSessionRecordings(filter);
    } catch (e) {
      // 缺表：线上忘了执行迁移时给出可操作提示，而不是裸 500
      if ((e as { code?: string })?.code === 'P2021') {
        request.log.error({ err: e }, 'SessionRecording 表不存在，请先执行 pnpm db:deploy');
        return reply.code(503).send({
          error:
            '录音数据表尚未创建。请在服务器数据库所在目录执行：' +
            'set -a && source packages/api-gateway/.env && set +a && pnpm db:deploy',
        });
      }
      throw e;
    }

    // 关键字搜索（用户名 / 用户ID / 场景名 / 场景ID / 会话ID）需 join 名称后再过滤，
    // 因此先 join 全量再分组分页：录音为低频查询场景，数据量可控
    const joined = await joinNames(ctx, all);
    const kw = (keyword ?? '').trim().toLowerCase();
    const matched = kw
      ? joined.filter((r) =>
          [r.userName, r.userId, r.scenarioName, r.scenarioId, r.sessionId].some((v) =>
            v.toLowerCase().includes(kw)
          )
        )
      : joined;

    // 按会话分组（同一场练习），组内按回合升序 = 说话顺序
    const bySession = new Map<string, RecordingItem[]>();
    for (const r of matched) {
      const arr = bySession.get(r.sessionId);
      if (arr) arr.push(r);
      else bySession.set(r.sessionId, [r]);
    }
    const groups: RecordingGroup[] = [...bySession.values()].map((items) => {
      const sorted = [...items].sort((a, b) => a.turnSeq - b.turnSeq);
      const startedAt = sorted.reduce(
        (min, r) => (r.createdAt < min ? r.createdAt : min),
        sorted[0].createdAt
      );
      const lastAt = sorted.reduce(
        (max, r) => (r.createdAt > max ? r.createdAt : max),
        sorted[0].createdAt
      );
      return {
        sessionId: sorted[0].sessionId,
        userId: sorted[0].userId,
        userName: sorted[0].userName,
        scenarioId: sorted[0].scenarioId,
        scenarioName: sorted[0].scenarioName,
        mode: sorted[0].mode,
        turnCount: sorted.length,
        startedAt,
        lastAt,
        items: sorted,
      };
    });
    // 会话之间：最近有录音的会话排在前面
    groups.sort((a, b) => b.lastAt.localeCompare(a.lastAt));

    const totalItems = matched.length;
    const total = groups.length;
    const pageSize = Math.min(
      MAX_GROUPS_PER_PAGE,
      Math.max(1, Number(limit) || DEFAULT_GROUPS_PER_PAGE)
    );
    const pageOffset = Math.max(0, Number(offset) || 0);
    const page = groups.slice(pageOffset, pageOffset + pageSize);

    return { groups: page, totalItems, total, offset: pageOffset, limit: pageSize };
  });

  // 录音详情
  app.get<{ Params: { id: string } }>('/recordings/:id', async (request, reply) => {
    const rec = await store.getSessionRecording(request.params.id);
    if (!rec || rec.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '录音不存在' });
    }
    const [items, fileExists] = await Promise.all([
      joinNames(ctx, [rec]),
      Promise.resolve(existsSync(path.resolve(process.cwd(), rec.filePath))),
    ]);
    return { ...items[0], fileExists };
  });

  // 删除录音（记录 + 文件）
  app.delete<{ Params: { id: string } }>('/recordings/:id', async (request, reply) => {
    const rec = await store.getSessionRecording(request.params.id);
    if (!rec || rec.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '录音不存在' });
    }
    await store.deleteSessionRecording(rec.id);
    deleteRecordingFile(rec.filePath);
    return { ok: true };
  });
}

/**
 * 音频回放：返回 WAV 文件流（audio/wav），供浏览器 <audio controls> 直接加载。
 * 仅管理者可访问；其中 supervisor/executive 只能回放本机构成员的录音（机构管理员查看团队成员）。
 * 文件不存在时 404。
 */
export async function recordingAudioRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/recordings/:id/audio',
    async (request, reply) => {
      const token = request.query.token;
      const payload = token ? verifyToken(token) : null;
      if (!payload) {
        request.log.warn(
          {
            id: request.params.id,
            hasToken: !!token,
            tokenFailReason: token ? tokenFailReason(token) : '缺少 token',
          },
          '录音回放鉴权失败'
        );
        return reply.code(401).send({ error: '未登录或登录已过期' });
      }
      const role = payload.role as UserRole;
      if (!MANAGER_ROLES.includes(role)) {
        return reply.code(403).send({ error: '无权访问' });
      }

      const rec = await ctx.store.getSessionRecording(request.params.id);
      if (!rec || rec.tenantId !== payload.tenantId) {
        return reply.code(404).send({ error: '录音不存在' });
      }

      // 机构管理者（supervisor/executive）仅能回放本机构成员的录音；admin/platform 维持全量权限
      if (role === 'supervisor' || role === 'executive') {
        const [owner, me] = await Promise.all([
          ctx.store.getUser(rec.userId),
          ctx.store.getUser(payload.userId),
        ]);
        if (!owner || !me || !me.orgId || owner.orgId !== me.orgId) {
          return reply.code(403).send({ error: '无权访问其他机构的录音' });
        }
      }
      const abs = path.resolve(process.cwd(), rec.filePath);
      if (!existsSync(abs)) {
        return reply.code(404).send({ error: '录音文件不存在' });
      }
      request.log.info({ id: rec.id, sessionId: rec.sessionId, userId: payload.userId }, '录音回放');
      reply.type('audio/wav');
      reply.header('Accept-Ranges', 'bytes');
      return reply.send(createReadStream(abs));
    }
  );
}
