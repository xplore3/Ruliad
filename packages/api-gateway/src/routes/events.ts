import type { FastifyInstance } from 'fastify';
import { EventTypes, type EventType } from '@grasp-mvp/core';
import { mkEvent } from '../events.js';
import type { RouteContext } from '../ctx.js';

/** 前端允许上报的事件类型（防止客户端伪造领域事件污染事件流） */
const UI_EVENT_TYPES = new Set<string>([
  EventTypes.UI_PAGE_VIEW,
  EventTypes.UI_PAGE_STAY,
  EventTypes.UI_ACTION,
]);

export async function eventsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 前端埋点入口：页面浏览 / 停留时长 / 关键动作（重练点击、求提示、申诉提交等）
  app.post<{
    Body: { type?: string; sessionId?: string; payload?: Record<string, unknown> };
  }>('/events', async (request, reply) => {
    const { type, sessionId, payload } = request.body ?? {};
    if (!type || !UI_EVENT_TYPES.has(type)) {
      return reply.code(400).send({ error: '非法事件类型' });
    }
    await store.appendEvent(
      mkEvent(type as EventType, {
        tenantId: request.tenantId,
        userId: request.userId,
        sessionId,
        payload,
      })
    );
    return reply.code(204).send();
  });
}
