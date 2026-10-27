import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RouteContext } from '../ctx.js';
import {
  generateDemoScript,
  judgeDemoChoice,
  judgeExperience,
  QUALIFY_QUESTIONS,
} from '../services/guidance.js';

/** 'audio/wav; codecs=1' → 'wav'；取不到时回退 'pcm'（与 voice.ts 同款） */
function formatFromMime(mime: string | undefined): string {
  const f = (mime ?? '').toLowerCase().replace(/^audio\//, '').split(';')[0].trim();
  return f || 'pcm';
}

/** 从请求中取音频：multipart 文件字段，或 Content-Type: audio/* 的 raw body（与 voice-turn 同款） */
async function extractAudio(request: FastifyRequest): Promise<{ audio?: Buffer; format: string }> {
  if (request.isMultipart()) {
    const file = await request.file();
    if (!file) return { format: 'pcm' };
    return { audio: await file.toBuffer(), format: formatFromMime(file.mimetype) };
  }
  if (Buffer.isBuffer(request.body) && request.body.length > 0) {
    return { audio: request.body, format: formatFromMime(request.headers['content-type']) };
  }
  return { format: 'pcm' };
}

/**
 * 地推引流课新手指引路由（不写入 transcript，不影响评分与复盘）：
 * - POST /sessions/:id/qualify-answer?q=1|2  资格提问的语音回答 → ASR → LLM 判断是否做过
 * - POST /sessions/:id/demo                  生成双 AI 示范对话剧本
 * - POST /sessions/:id/demo-choice           示范后的语音选择 → 再听一版 / 开始练习
 */
export async function guidanceRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway, speech } = ctx;

  // audio/* raw body 按 Buffer 收下（与 voice.ts 同款；解析器按插件封装作用域隔离，需各自注册）
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // 每会话的资格回答暂存（内存态，不落库；刷新后重新走流程即可）
  const qualifyAnswers = new Map<string, string[]>();

  // 资格提问回答：raw PCM → ASR → judgeExperience。q=1 只记录不结论（experienced=null），q=2 给结论
  app.post<{ Params: { id: string }; Querystring: { q?: string } }>(
    '/sessions/:id/qualify-answer',
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session) return reply.code(404).send({ error: '会话不存在' });
      if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

      const q = Number(request.query.q ?? '1');
      if (q !== 1 && q !== 2) return reply.code(400).send({ error: 'q 只能是 1 或 2' });

      const { audio, format } = await extractAudio(request);
      if (!audio || audio.length === 0) {
        return reply.code(400).send({ error: '缺少音频：用 multipart/form-data 上传文件，或以 Content-Type: audio/* 直传' });
      }

      const text = (await speech.asr.transcribe(audio, format)).trim();
      if (!text) return reply.code(422).send({ error: '未识别到有效语音' });

      const answers = qualifyAnswers.get(session.id) ?? [];
      answers[q - 1] = text;
      qualifyAnswers.set(session.id, answers);

      if (q === 1) return { text, experienced: null };

      // q=2：累积两题（第 1 题缺答视为"没做过"，宁可进指导模式）
      const qa: { question: string; answer: string }[] = answers
        .map((answer, i) => ({ question: QUALIFY_QUESTIONS[i] as string, answer }))
        .filter((x) => !!x.answer);
      const experienced = answers[0] ? await judgeExperience(gateway, qa) : false;
      qualifyAnswers.delete(session.id);
      return { text, experienced };
    }
  );

  // 生成示范对话剧本（version 仅作"换个版本"提示注入 prompt）；不落 transcript
  app.post<{ Params: { id: string }; Body: { version?: number } }>(
    '/sessions/:id/demo',
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session) return reply.code(404).send({ error: '会话不存在' });
      if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });
      const scenario = await store.getScenario(session.scenarioId);
      if (!scenario) return reply.code(500).send({ error: '场景缺失' });

      const version = Math.max(1, Math.floor(Number(request.body?.version ?? 1)) || 1);
      const lines = await generateDemoScript(gateway, scenario, version);
      return { lines };
    }
  );

  // 示范后的选择：raw PCM → ASR → judgeDemoChoice
  app.post<{ Params: { id: string } }>('/sessions/:id/demo-choice', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session) return reply.code(404).send({ error: '会话不存在' });
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

    const { audio, format } = await extractAudio(request);
    if (!audio || audio.length === 0) {
      return reply.code(400).send({ error: '缺少音频：用 multipart/form-data 上传文件，或以 Content-Type: audio/* 直传' });
    }

    const text = (await speech.asr.transcribe(audio, format)).trim();
    if (!text) return reply.code(422).send({ error: '未识别到有效语音' });

    const choice = await judgeDemoChoice(gateway, text);
    return { text, choice };
  });
}
