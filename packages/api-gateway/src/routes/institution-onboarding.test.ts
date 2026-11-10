import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { institutionOnboardingRoutes } from './institution-onboarding.js';
import type { RouteContext } from '../ctx.js';

const qa = Array.from({ length: 21 }, (_, index) => ({
  question: `问题 ${index + 1}`,
  answer: `答案 ${index + 1}`,
}));

function multipartPayload(qaItems: typeof qa) {
  const boundary = '----institution-onboarding-test';
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="qa"\r\n\r\n${JSON.stringify(qaItems)}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="revision.pcm"\r\n` +
        'Content-Type: audio/pcm\r\n\r\n'
      ),
      Buffer.from([1, 2, 3, 4]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

async function setup(chat: ReturnType<typeof vi.fn>, role: 'admin' | 'trainee' = 'admin') {
  const app = Fastify();
  await app.register(multipart);
  app.addHook('onRequest', async (request) => {
    request.userRole = role;
    request.tenantId = 'tenant-demo';
  });
  const transcribe = vi.fn(async () => '客户的整段回答');
  const getProductKB = vi.fn(async () => null);
  const saveProductKB = vi.fn(async () => undefined);
  const ctx = {
    gateway: { forTask: () => ({ chat }) },
    speech: { asr: { transcribe } },
    store: {
      getProductKB,
      saveProductKB,
    },
  } as unknown as RouteContext;
  await app.register((instance) => institutionOnboardingRoutes(instance, ctx), { prefix: '/api/v1' });
  return { app, transcribe, getProductKB, saveProductKB };
}

it('整段录音一次整理为固定21条问答', async () => {
  const chat = vi.fn(async (_messages: Array<{ content: string }>) => ({
    model: 'mock',
    content: JSON.stringify({ qa: qa.map((item) => ({ answer: item.answer })) }),
  }));
  const { app, transcribe } = await setup(chat);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/institution-onboarding/answer',
      payload: Buffer.from([1, 2, 3, 4]),
      headers: { 'content-type': 'audio/pcm' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ qa: Array<{ question: string; answer: string }> }>();
    expect(body.qa).toHaveLength(21);
    expect(body.qa[0]).toEqual({ question: '机构的科目内容', answer: '答案 1' });
    expect(body.qa[19]).toEqual({ question: '退费政策如何', answer: '答案 20' });
    expect(body.qa[20]).toEqual({ question: '一个班多少人', answer: '答案 21' });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    const messages = chat.mock.calls[0][0] as Array<{ content: string }>;
    expect(messages[0].content).toContain('客户的整段回答');
    expect(messages[0].content).toContain('20. 退费政策如何');
    expect(messages[0].content).toContain('21. 一个班多少人');
  } finally {
    await app.close();
  }
});

it('语音修改后可再次核对，确认无误才保存资料库', async () => {
  const modifiedQa = qa.map((item, index) => index === 0 ? { ...item, answer: '修改后的答案' } : item);
  const chat = vi.fn()
    .mockResolvedValueOnce({
      model: 'mock',
      content: JSON.stringify({ action: 'modify', qa: modifiedQa, rationale: '已修改第一题' }),
    })
    .mockResolvedValueOnce({
      model: 'mock',
      content: JSON.stringify({ action: 'done', rationale: '已确认' }),
    });
  const { app, saveProductKB } = await setup(chat);
  try {
    const first = multipartPayload(qa);
    const modified = await app.inject({
      method: 'POST',
      url: '/api/v1/institution-onboarding/revise',
      payload: first.payload,
      headers: { 'content-type': first.contentType },
    });
    expect(modified.statusCode).toBe(200);
    expect(modified.json().action).toBe('modify');
    expect(modified.json().qa[0].answer).toBe('修改后的答案');
    expect(saveProductKB).not.toHaveBeenCalled();

    const second = multipartPayload(modified.json().qa);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/v1/institution-onboarding/revise',
      payload: second.payload,
      headers: { 'content-type': second.contentType },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().action).toBe('done');
    expect(saveProductKB).not.toHaveBeenCalled();

    const completed = await app.inject({
      method: 'POST',
      url: '/api/v1/institution-onboarding/complete',
      payload: { qa: confirmed.json().qa },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({ completed: true, entries: 21 });
    expect(saveProductKB).toHaveBeenCalledTimes(1);
    expect(saveProductKB).toHaveBeenCalledWith(expect.objectContaining({
      name: '培训机构定制资料库',
      tenantId: 'tenant-demo',
      entries: expect.arrayContaining([
        expect.objectContaining({ title: '问题 1', content: '修改后的答案' }),
      ]),
    }));
  } finally {
    await app.close();
  }
});

it('普通测试账号可整理录音但不能写入正式资料库', async () => {
  const chat = vi.fn(async () => ({
    model: 'mock',
    content: JSON.stringify({ qa: qa.map((item) => ({ answer: item.answer })) }),
  }));
  const { app, saveProductKB } = await setup(chat, 'trainee');
  try {
    const answered = await app.inject({
      method: 'POST',
      url: '/api/v1/institution-onboarding/answer',
      payload: Buffer.from([1, 2, 3, 4]),
      headers: { 'content-type': 'audio/pcm' },
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json().qa).toHaveLength(21);

    const completed = await app.inject({
      method: 'POST',
      url: '/api/v1/institution-onboarding/complete',
      payload: { qa },
    });
    expect(completed.statusCode).toBe(403);
    expect(saveProductKB).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

it('已提交时返回现有21条问答供修改', async () => {
  const chat = vi.fn();
  const { app, getProductKB } = await setup(chat);
  getProductKB.mockResolvedValue({
    entries: [{ title: '机构的科目内容', content: '少儿围棋课程' }],
  } as any);
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/institution-onboarding/status',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().completed).toBe(true);
    expect(response.json().qa).toHaveLength(21);
    expect(response.json().qa[0]).toEqual({ question: '机构的科目内容', answer: '少儿围棋课程' });
    expect(response.json().qa[1]).toEqual({ question: '适龄年龄', answer: '未提供相关信息' });
  } finally {
    await app.close();
  }
});
