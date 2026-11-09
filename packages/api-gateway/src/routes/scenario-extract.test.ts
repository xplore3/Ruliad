import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { MemoryStore } from '@grasp-mvp/infra';
import { scenarioExtractRoutes } from './scenario-extract.js';
import type { RouteContext } from '../ctx.js';

it('场景创建向导记录全部命令，通用问题直接进入待处理队列', async () => {
  const store = new MemoryStore();
  const chat = vi.fn(async () => ({
    model: 'mock',
    content: JSON.stringify({
      reply: '这是通用能力建议', fields: { description: '统一所有场景的表达规范' },
      general: true, generalReason: '需要统一的公共表达规范',
    }),
  }));
  const app = Fastify();
  await app.register(multipart);
  app.addHook('onRequest', async (request) => {
    request.userId = 'user-1';
    request.tenantId = 'tenant-demo';
    request.userRole = 'trainee';
  });
  const ctx = { store, gateway: { forTask: () => ({ chat }) } } as unknown as RouteContext;
  await app.register((instance) => scenarioExtractRoutes(instance, ctx), { prefix: '/api/v1' });
  try {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/scenarios/extract',
      payload: { text: '希望所有场景统一表达规范', current: { scenarioId: 'scenario-1' } },
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ commandId: string; general: boolean }>();
    expect(body.general).toBe(true);
    const command = await store.getVoiceEditCommand(body.commandId);
    expect(command?.status).toBe('pending_review');
    expect(command?.resourceId).toBe('scenario-1');
    expect(command?.text).toBe('希望所有场景统一表达规范');
    expect(command?.patch).toEqual({ description: '统一所有场景的表达规范' });
  } finally { await app.close(); }
});
