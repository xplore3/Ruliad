/**
 * 用户反馈路由
 *
 * - 提交反馈（文字 / 语音）：所有登录用户
 * - 反馈列表 / 详情 / 回复 / 状态更新 / 删除：仅 admin/platform
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Feedback, FeedbackReply, FeedbackStatus, FeedbackType } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';
import { requireRoles } from '../auth.js';

function formatFromMime(mime: string | undefined): string {
  const f = (mime ?? '').toLowerCase().replace(/^audio\//, '').split(';')[0].trim();
  return f || 'pcm';
}

export async function feedbackRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway, speech } = ctx;
  let audioParserRegistered = false;

  // audio/* raw body 按 Buffer 收下（multipart 由全局 @fastify/multipart 处理）
  if (!audioParserRegistered) {
    app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });
    audioParserRegistered = true;
  }

  // ---- 提交反馈（文字或语音）----
  app.post<{
    Body: {
      type?: FeedbackType;
      content?: string;
      source?: string;
    };
  }>('/feedback', async (request, reply) => {
    const user = await store.getUser(request.userId);
    if (!user) return reply.code(401).send({ error: '用户不存在' });

    let content: string | undefined;
    let source: string | undefined;
    let type: FeedbackType = 'other';

    // 判断请求类型
    const contentType = request.headers['content-type'] ?? '';

    if (contentType.startsWith('multipart/form-data')) {
      // 语音输入（multipart 上传 wav）
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'multipart 请求缺少音频文件字段' });
      const typeField = file.fields['type'];
      const sourceField = file.fields['source'];
      const typeValue = Array.isArray(typeField) ? typeField[0] : typeField;
      const sourceValue = Array.isArray(sourceField) ? sourceField[0] : sourceField;
      if (typeValue && typeValue.type === 'field' && typeof typeValue.value === 'string') {
        type = (typeValue.value as FeedbackType) || 'other';
      }
      if (sourceValue && sourceValue.type === 'field' && typeof sourceValue.value === 'string') {
        source = sourceValue.value;
      }
      const audio = await file.toBuffer();
      content = (await speech.asr.transcribe(audio, formatFromMime(file.mimetype))).trim();
      if (!content) return reply.code(422).send({ error: '未识别到有效语音，请重试' });
    } else if (Buffer.isBuffer(request.body)) {
      // raw audio body
      if (request.body.length === 0) {
        return reply.code(400).send({ error: '缺少音频：raw body 为空' });
      }
      content = (await speech.asr.transcribe(request.body, formatFromMime(contentType))).trim();
      if (!content) return reply.code(422).send({ error: '未识别到有效语音，请重试' });
    } else {
      // 文字输入
      const body = request.body ?? {};
      content = body.content?.trim();
      type = body.type ?? 'other';
      source = body.source?.trim() || undefined;
    }

    if (!content) return reply.code(400).send({ error: '反馈内容不能为空' });

    const feedback: Feedback = {
      id: randomUUID(),
      tenantId: request.tenantId,
      userId: user.id,
      userName: user.name,
      type,
      content,
      source,
      status: 'pending',
      replies: [],
      createdAt: new Date().toISOString(),
    };

    await store.createFeedback(feedback);
    return reply.code(201).send(feedback);
  });

  // ---- 反馈列表（admin/platform）----
  app.get<{
    Querystring: {
      status?: string;
      type?: string;
      userId?: string;
      limit?: string;
      offset?: string;
    };
  }>('/feedback', { preHandler: requireRoles('admin', 'platform') }, async (request) => {
    const { status, type, userId, limit, offset } = request.query ?? {};
    const all = await store.listFeedback({
      tenantId: request.tenantId,
      status,
      type,
      userId,
    });
    // 按创建时间倒序
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = all.length;
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
    const pageOffset = Math.max(0, Number(offset) || 0);
    const items = all.slice(pageOffset, pageOffset + pageSize);

    return { feedbacks: items, total, offset: pageOffset, limit: pageSize };
  });

  // ---- 反馈详情（admin/platform）----
  app.get<{ Params: { id: string } }>(
    '/feedback/:id',
    { preHandler: requireRoles('admin', 'platform') },
    async (request, reply) => {
      const feedback = await store.getFeedback(request.params.id);
      if (!feedback || feedback.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '反馈不存在' });
      }
      return feedback;
    }
  );

  // ---- 回复反馈（admin/platform）----
  app.post<{ Params: { id: string }; Body: { content: string } }>(
    '/feedback/:id/reply',
    { preHandler: requireRoles('admin', 'platform') },
    async (request, reply) => {
      const feedback = await store.getFeedback(request.params.id);
      if (!feedback || feedback.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '反馈不存在' });
      }
      const content = request.body?.content?.trim();
      if (!content) return reply.code(400).send({ error: '回复内容不能为空' });

      const admin = await store.getUser(request.userId);
      const newReply: FeedbackReply = {
        id: randomUUID(),
        feedbackId: feedback.id,
        userId: request.userId,
        userName: admin?.name ?? '管理员',
        content,
        isAdmin: true,
        createdAt: new Date().toISOString(),
      };

      await store.addFeedbackReply(newReply);
      return reply.code(201).send(newReply);
    }
  );

  // ---- 更新反馈状态（admin/platform）----
  app.patch<{ Params: { id: string }; Body: { status: FeedbackStatus } }>(
    '/feedback/:id/status',
    { preHandler: requireRoles('admin', 'platform') },
    async (request, reply) => {
      const feedback = await store.getFeedback(request.params.id);
      if (!feedback || feedback.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '反馈不存在' });
      }
      const status = request.body?.status;
      if (!status || !['pending', 'processing', 'resolved', 'closed'].includes(status)) {
        return reply.code(400).send({ error: '无效的状态值' });
      }
      await store.updateFeedback(feedback.id, { status });
      return store.getFeedback(feedback.id);
    }
  );

  // ---- 删除反馈（admin/platform）----
  app.delete<{ Params: { id: string } }>(
    '/feedback/:id',
    { preHandler: requireRoles('admin', 'platform') },
    async (request, reply) => {
      const feedback = await store.getFeedback(request.params.id);
      if (!feedback || feedback.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '反馈不存在' });
      }
      await store.deleteFeedback(feedback.id);
      return { ok: true };
    }
  );

  // ---- 我的反馈列表（当前登录用户）----
  app.get('/my/feedback', async (request) => {
    const all = await store.listFeedback({
      tenantId: request.tenantId,
      userId: request.userId,
    });
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { feedbacks: all };
  });
}
