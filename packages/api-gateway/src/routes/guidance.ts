import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RouteContext } from '../ctx.js';
import {
  composeBriefing,
  getGuidance,
  judgeDemoChoice,
  judgeExperience,
  renderDemoScript,
  resolveFaqPool,
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
 * 新手指引流程路由（不写入 transcript，不影响评分与复盘）：
 * - GET  /scenarios/:id/guidance        新手指引流程配置（无配置返回 guidance=null）
 * - POST /sessions/:id/qualify-answer?q=N  资格提问的语音回答 → ASR → LLM 判断是否做过（最后一题给结论并落库）
 * - POST /sessions/:id/demo             渲染场景示范对话剧本（无资源时声明无示范，前端跳过该步骤）
 * - POST /sessions/:id/briefing         教练讲解口播稿（keyPoints + 讲解标准库）
 * - POST /sessions/:id/demo-choice      示范后的语音选择 → 再听一版 / 开始练习
 */
export async function guidanceRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway, speech } = ctx;

  // audio/* raw body 按 Buffer 收下（与 voice.ts 同款；解析器按插件封装作用域隔离，需各自注册）
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // 每会话的资格回答暂存（内存态，不落库；刷新后重新走流程即可）
  const qualifyAnswers = new Map<string, string[]>();

  // 新手指引流程配置查询
  app.get<{ Params: { id: string } }>('/scenarios/:id/guidance', async (request) => ({
    guidance: (await getGuidance(store, request.params.id)) ?? null,
  }));

  // 资格提问回答：raw PCM → ASR → judgeExperience。非最后一题只记录不结论（experienced=null），最后一题给结论并落库
  app.post<{ Params: { id: string }; Querystring: { q?: string } }>(
    '/sessions/:id/qualify-answer',
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session) return reply.code(404).send({ error: '会话不存在' });
      if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

      // 问题从指引配置取；无配置回退默认两问
      const guidance = await getGuidance(store, session.scenarioId);
      const questions = guidance?.qualifyQuestions?.length
        ? guidance.qualifyQuestions
        : ([...QUALIFY_QUESTIONS] as string[]);

      const q = Number(request.query.q ?? '1');
      if (!Number.isInteger(q) || q < 1 || q > questions.length) {
        return reply.code(400).send({ error: `q 只能是 1 到 ${questions.length}` });
      }

      const { audio, format } = await extractAudio(request);
      if (!audio || audio.length === 0) {
        return reply.code(400).send({ error: '缺少音频：用 multipart/form-data 上传文件，或以 Content-Type: audio/* 直传' });
      }

      const text = (await speech.asr.transcribe(audio, format)).trim();
      if (!text) return reply.code(422).send({ error: '未识别到有效语音' });

      const answers = qualifyAnswers.get(session.id) ?? [];
      answers[q - 1] = text;
      qualifyAnswers.set(session.id, answers);

      if (q < questions.length) return { text, experienced: null };

      // 最后一题：累积所有题（缺答视为"没做过"，宁可进指导模式）
      const qa: { question: string; answer: string }[] = answers
        .map((answer, i) => ({ question: questions[i] as string, answer }))
        .filter((x) => !!x.answer);
      const experienced = answers[0] ? await judgeExperience(gateway, qa) : false;
      qualifyAnswers.delete(session.id);
      await store.updateSession(session.id, { qualifyResult: { answers, experienced } });
      return { text, experienced };
    }
  );

  // 渲染示范对话剧本：有资源按模板渲染（demo=null 表示无示范模式）；无资源 → 声明无示范，前端跳过该步骤
  app.post<{ Params: { id: string } }>('/sessions/:id/demo', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session) return reply.code(404).send({ error: '会话不存在' });
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

    const guidance = await getGuidance(store, session.scenarioId);
    if (!guidance?.demo) return { lines: [], hasDemo: false };
    const pool = await resolveFaqPool(store, session.tenantId, guidance.demo.faqPoolRef, guidance.demo.faqPick ?? 0);
    return { lines: renderDemoScript(guidance.demo, pool), hasDemo: true };
  });

  // 教练讲解口播稿：keyPoints + 引用的讲解标准库条目；无资源返回空口播
  app.post<{ Params: { id: string } }>('/sessions/:id/briefing', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session) return reply.code(404).send({ error: '会话不存在' });
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

    const guidance = await getGuidance(store, session.scenarioId);
    if (!guidance) return { lines: [] };

    const standards = await store.listBriefingStandards(session.tenantId);
    return { lines: composeBriefing(guidance, standards) };
  });

  // 示范后的选择：raw PCM → ASR → judgeDemoChoice；choice='practice' 即进入第4步演练，响应附带 liveIntro（旁白+目标，无资源为 null）
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
    const guidance = await getGuidance(store, session.scenarioId);
    return { text, choice, liveIntro: guidance?.liveIntro ?? null };
  });
}
