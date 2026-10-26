import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from '../ctx.js';
import { verifyToken } from '../auth.js';
import {
  frameFileName,
  saveFrameFile,
  saveVideoFile,
  videoDir,
  videoFileName,
} from '../services/video-store.js';

const VIDEO_EXTS = ['webm', 'mp4'] as const;

/** session id 拼进文件名，防路径穿越 */
const SAFE_ID = /^[\w-]+$/;

/**
 * 对练录像路由：
 * - POST /sessions/:id/video               上传整场录像 + 评分关键帧（multipart）
 * - GET  /sessions/:id/video               录像回放（支持 Range，token 经 query 传入，同语音 WS 模式）
 * - GET  /sessions/:id/video/frames/:n     关键帧图片
 */
export async function videoRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 上传整场对练录像 + 评分用关键帧（multipart：video 文件 + frame_N 文件 + frameAtMs JSON）
  app.post<{ Params: { id: string } }>('/sessions/:id/video', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session) return reply.code(404).send({ error: '会话不存在' });
    if (!SAFE_ID.test(session.id)) return reply.code(400).send({ error: '会话 id 非法' });

    let savedExt: string | null = null;
    const frameIndexes: number[] = [];
    let frameAtMs: number[] = [];

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'video') {
          const ext = part.mimetype.includes('mp4') ? 'mp4' : 'webm';
          await saveVideoFile(session.id, ext, await part.toBuffer());
          savedExt = ext;
        } else if (/^frame_\d+$/.test(part.fieldname)) {
          const index = Number(part.fieldname.slice('frame_'.length));
          await saveFrameFile(session.id, index, await part.toBuffer());
          frameIndexes.push(index);
        } else {
          // 未知文件字段：消费掉防流悬挂
          await part.toBuffer();
        }
      } else if (part.fieldname === 'frameAtMs' && typeof part.value === 'string') {
        try {
          const parsed: unknown = JSON.parse(part.value);
          if (Array.isArray(parsed)) frameAtMs = parsed.map((v) => Number(v) || 0);
        } catch {
          // 非法 JSON 忽略，帧时间退化为 0
        }
      }
    }

    if (!savedExt) return reply.code(400).send({ error: 'multipart 请求缺少 video 文件字段' });

    frameIndexes.sort((a, b) => a - b);
    const videoUrl = `/api/v1/sessions/${session.id}/video`;
    const videoFrames = frameIndexes.map((index, i) => ({
      url: `/api/v1/sessions/${session.id}/video/frames/${index}`,
      atMs: frameAtMs[i] ?? 0,
    }));
    await store.updateSession(session.id, { videoUrl, videoFrames });
    return { videoUrl };
  });

  // 录像回放：<video> 标签无法带 Authorization header，token 经 query 传入（与语音 WS 同一套 verifyToken）
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/sessions/:id/video',
    async (request, reply) => {
      const payload = request.query.token ? verifyToken(request.query.token) : null;
      if (!payload) return reply.code(401).send({ error: '未登录或登录已过期' });
      if (!SAFE_ID.test(request.params.id)) return reply.code(400).send({ error: '会话 id 非法' });
      const session = await store.getSession(request.params.id);
      if (!session?.videoUrl) return reply.code(404).send({ error: '录像不存在' });

      const dir = videoDir();
      for (const ext of VIDEO_EXTS) {
        const file = path.join(dir, videoFileName(session.id, ext));
        try {
          const { size } = await stat(file);
          reply.header('Content-Type', ext === 'mp4' ? 'video/mp4' : 'video/webm');
          reply.header('Accept-Ranges', 'bytes');

          // 手动支持 Range：<video> 拖动进度条依赖 206 分段响应
          const m = request.headers.range ? /^bytes=(\d*)-(\d*)$/.exec(request.headers.range) : null;
          if (m && (m[1] || m[2])) {
            const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
            const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
            if (start >= size || start > end) {
              return reply.code(416).header('Content-Range', `bytes */${size}`).send();
            }
            reply.code(206);
            reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
            reply.header('Content-Length', end - start + 1);
            return reply.send(createReadStream(file, { start, end }));
          }

          reply.header('Content-Length', size);
          return reply.send(createReadStream(file));
        } catch {
          // 该扩展名不存在，尝试下一个
        }
      }
      return reply.code(404).send({ error: '录像文件缺失' });
    }
  );

  // 关键帧图片
  app.get<{ Params: { id: string; n: string }; Querystring: { token?: string } }>(
    '/sessions/:id/video/frames/:n',
    async (request, reply) => {
      const payload = request.query.token ? verifyToken(request.query.token) : null;
      if (!payload) return reply.code(401).send({ error: '未登录或登录已过期' });
      if (!SAFE_ID.test(request.params.id)) return reply.code(400).send({ error: '会话 id 非法' });
      const index = Number(request.params.n);
      if (!Number.isInteger(index) || index < 0) return reply.code(400).send({ error: '帧序号非法' });

      const file = path.join(videoDir(), frameFileName(request.params.id, index));
      try {
        const { size } = await stat(file);
        reply.header('Content-Type', 'image/jpeg');
        reply.header('Content-Length', size);
        return reply.send(createReadStream(file));
      } catch {
        return reply.code(404).send({ error: '帧不存在' });
      }
    }
  );
}
