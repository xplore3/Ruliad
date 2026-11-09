import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ASRStream } from '@grasp-mvp/speech-gateway';
import type { RouteContext } from '../ctx.js';
import { tokenFailReason, verifyToken } from '../auth.js';
import {
  composeBriefing,
  getGuidance,
  judgeDemoChoice,
  judgeExperience,
  performDemoScript,
  resolveFaqPool,
  resolveQualifyQuestions,
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
 * - POST /sessions/:id/qualify-answer?q=N  资格提问的语音回答 → ASR → LLM 判断是否做过（最后一题给结论并落库）；
 *   也接受 JSON {text}（流式识别已出文本时跳过 ASR）
 * - POST /sessions/:id/demo             示范剧本交给大模型理解演绎成双人对话（无资源时声明无示范，前端跳过该步骤）
 * - POST /sessions/:id/briefing         教练讲解口播稿（keyPoints + 讲解标准库 → 大模型理解改写，不照念原文）
 * - POST /sessions/:id/demo-choice      示范后的语音选择 → 再听一版 / 开始练习；也接受 JSON {text}
 * - GET  /sessions/:id/asr-stream       流式识别通道（WebSocket）：边说边识别，实时出 partial
 */

/** JSON 文本直传（客户端已走流式识别）时取文本；否则返回空串走音频 ASR */
function textFromBody(request: FastifyRequest): string {
  const body = request.body;
  if (!request.isMultipart() && body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    const text = (body as { text?: unknown }).text;
    if (typeof text === 'string') return text.trim();
  }
  return '';
}
export async function guidanceRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway, speech } = ctx;

  // audio/* raw body 按 Buffer 收下（与 voice.ts 同款；解析器按插件封装作用域隔离，需各自注册）
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // 每会话的资格回答暂存（内存态，不落库；刷新后重新走流程即可）
  const qualifyAnswers = new Map<string, string[]>();
  // 每题识别完成即并行发起"是否有经验"判定，最后一题只等聚合，不再串行等全部 LLM 判定
  const qualifyJudgments = new Map<string, Promise<boolean>[]>();

  // 新手指引流程配置查询
  app.get<{ Params: { id: string } }>('/scenarios/:id/guidance', async (request, reply) => {
    const scenario = await store.getScenario(request.params.id);
    if (!scenario || scenario.tenantId !== request.tenantId) return reply.code(404).send({ error: '场景不存在' });
    const guidance = await getGuidance(store, scenario.id);
    return { guidance: guidance?.tenantId === request.tenantId ? guidance : null };
  });

  // 资格提问回答：raw PCM → ASR → judgeExperience。非最后一题只记录不结论（experienced=null），最后一题给结论并落库
  app.post<{ Params: { id: string }; Querystring: { q?: string } }>(
    '/sessions/:id/qualify-answer',
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) return reply.code(404).send({ error: '会话不存在' });
      if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

      // 问题从指引配置取；无配置时仅地推类场景回退默认两问，其他场景无资格提问
      const guidance = await getGuidance(store, session.scenarioId, session.tenantId);
      const scenario = await store.getScenario(session.scenarioId);
      const questions = resolveQualifyQuestions(guidance, scenario);
      if (questions.length === 0) {
        return reply.code(400).send({ error: '该场景没有资格提问' });
      }

      const q = Number(request.query.q ?? '1');
      if (!Number.isInteger(q) || q < 1 || q > questions.length) {
        return reply.code(400).send({ error: `q 只能是 1 到 ${questions.length}` });
      }

      const directText = textFromBody(request);
      let text = directText;
      if (!text) {
        const { audio, format } = await extractAudio(request);
        if (!audio || audio.length === 0) {
          return reply.code(400).send({ error: '缺少音频：用 multipart/form-data 上传文件、以 Content-Type: audio/* 直传，或以 JSON 传 {text}' });
        }
        text = (await speech.asr.transcribe(audio, format)).trim();
      }
      if (!text) return reply.code(422).send({ error: '未识别到有效语音' });

      const answers = qualifyAnswers.get(session.id) ?? [];
      answers[q - 1] = text;
      qualifyAnswers.set(session.id, answers);

      // 该题判定立即并行发起（judgeExperience 单题语义与批量 every() 判定等价）
      const judgments = qualifyJudgments.get(session.id) ?? [];
      judgments[q - 1] = judgeExperience(gateway, [{ question: questions[q - 1] as string, answer: text }]);
      qualifyJudgments.set(session.id, judgments);

      if (q < questions.length) return { text, experienced: null };

      // 最后一题：聚合各题已并行完成的判定（缺答视为"没做过"，宁可进指导模式）
      const results = await Promise.all(questions.map((_, i) => judgments[i] ?? Promise.resolve(false)));
      const experienced = answers[0] ? results.every(Boolean) : false;
      qualifyAnswers.delete(session.id);
      qualifyJudgments.delete(session.id);
      await store.updateSession(session.id, { qualifyResult: { answers, experienced } });
      return { text, experienced };
    }
  );

  // 示范对话演绎：示范剧本库按 demoScriptId 引用取剧本，渲染参照稿后交给大模型理解演绎成自然双人对话
  // （无引用或剧本已被删除 → 声明无示范，前端跳过该步骤；version>1 表示"再听一版"，LLM 换风格演绎）
  app.post<{ Params: { id: string }; Body: { version?: number } }>('/sessions/:id/demo', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) return reply.code(404).send({ error: '会话不存在' });
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

    const guidance = await getGuidance(store, session.scenarioId, session.tenantId);
    if (!guidance?.demoScriptId || guidance.tenantId !== session.tenantId) return { lines: [], hasDemo: false };
    const script = await store.getDemoScript(guidance.demoScriptId);
    if (!script || script.tenantId !== session.tenantId) return { lines: [], hasDemo: false };
    const pool = await resolveFaqPool(store, session.tenantId, script.faqPoolRef, script.faqPick ?? 0);
    const version = Math.max(1, Math.floor(Number(request.body?.version ?? 1)) || 1);
    return { lines: await performDemoScript(gateway, script, pool, version), hasDemo: true };
  });

  // 教练讲解口播稿：keyPoints + 引用的讲解标准库条目渲染成参照稿后，交给大模型理解改写成自然口播
  // （不照念资源库原文；LLM 失败回退参照稿）；无资源返回空口播
  app.post<{ Params: { id: string } }>('/sessions/:id/briefing', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) return reply.code(404).send({ error: '会话不存在' });
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

    const guidance = await getGuidance(store, session.scenarioId, session.tenantId);
    if (!guidance) return { lines: [] };

    const standards = await store.listBriefingStandards(session.tenantId);
    return { lines: await composeBriefing(gateway, guidance, standards) };
  });

  // 示范后的选择：raw PCM → ASR → judgeDemoChoice；choice='practice' 即进入第4步演练，响应附带 liveIntro（旁白+目标，无资源为 null）
  app.post<{ Params: { id: string } }>('/sessions/:id/demo-choice', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) return reply.code(404).send({ error: '会话不存在' });
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

    const directText = textFromBody(request);
    let text = directText;
    if (!text) {
      const { audio, format } = await extractAudio(request);
      if (!audio || audio.length === 0) {
        return reply.code(400).send({ error: '缺少音频：用 multipart/form-data 上传文件、以 Content-Type: audio/* 直传，或以 JSON 传 {text}' });
      }
      text = (await speech.asr.transcribe(audio, format)).trim();
    }
    if (!text) return reply.code(422).send({ error: '未识别到有效语音' });

    const choice = await judgeDemoChoice(gateway, text);
    const guidance = await getGuidance(store, session.scenarioId, session.tenantId);
    return { text, choice, liveIntro: guidance?.liveIntro ?? null };
  });

  // 流式识别通道（WebSocket）：资格提问/示范选择的边说边识别，替代整段上传批量识别。
  // 客户端发 PCM16 二进制帧；'start' 开新一轮、'finish' 收尾出 asr_final、'cancel' 丢弃本轮。
  // token 经 query 传入（浏览器 WS 无法带 header），与 voice 路由同款校验
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/sessions/:id/asr-stream',
    { websocket: true },
    async (socket, req) => {
      const token = req.query.token;
      const payload = token ? verifyToken(token) : null;
      if (!payload) {
        req.log.warn(
          {
            sessionId: req.params.id,
            hasToken: !!token,
            tokenFailReason: token ? tokenFailReason(token) : '缺少 token',
          },
          'asr-stream WS 鉴权失败，关闭连接（4401）'
        );
        socket.close(4401, '未登录或登录已过期');
        return;
      }
      const sessionId = req.params.id;
      const session = await store.getSession(sessionId);
      if (!session || session.userId !== payload.userId || session.tenantId !== payload.tenantId) {
        socket.close(4404, '会话不存在');
        return;
      }
      req.log.info({ sessionId, userId: payload.userId, provider: speech.asr.name }, 'asr-stream WS 已建立');

      // 每连接只允许一轮未完成的识别：round 单调递增，过期轮次的异步回调一律丢弃
      let round = 0;
      let asrStream: ASRStream | null = null;
      let latestText = '';
      let latestIsFinal = false;
      let finishRequested = false;

      const send = (msg: Record<string, unknown>) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      };

      const closeStream = () => {
        if (asrStream) {
          asrStream.close();
          asrStream = null;
        }
      };

      const complete = (myRound: number) => {
        if (myRound !== round) return;
        send({ type: 'asr_final', text: latestText });
        finishRequested = false;
        closeStream();
      };

      const startRound = () => {
        round++;
        const myRound = round;
        closeStream();
        latestText = '';
        latestIsFinal = false;
        finishRequested = false;
        asrStream = speech.asr.createStream({
          onPartial: (text) => {
            if (myRound !== round) return;
            latestText = text;
            latestIsFinal = false;
            send({ type: 'asr_partial', text });
          },
          // paraformer 句末会多次回调（累计文本）：只刷新字幕，客户端 finish 后才出 asr_final
          onFinal: (text) => {
            if (myRound !== round) return;
            latestText = text;
            latestIsFinal = true;
            send({ type: 'asr_partial', text });
            if (finishRequested) complete(myRound);
          },
          onFinished: () => {
            if (myRound === round && finishRequested) complete(myRound);
          },
          onError: (err) => {
            if (myRound !== round) return;
            req.log.warn({ sessionId, err: err.message, provider: speech.asr.name }, 'asr-stream ASR 流错误');
            send({ type: 'error', message: `ASR：${err.message}` });
          },
        });
      };

      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          // 首个音频帧自动开轮（兼容未显式发 start 的客户端）
          if (!asrStream) startRound();
          asrStream?.write(data);
          return;
        }
        let msg: { type?: string };
        try {
          msg = JSON.parse(data.toString());
        } catch {
          send({ type: 'error', message: '无法解析的消息（期望 JSON 文本帧或二进制音频帧）' });
          return;
        }
        switch (msg.type) {
          case 'start':
            startRound();
            break;
          case 'finish':
            finishRequested = true;
            if (!asrStream) {
              finishRequested = false;
              send({ type: 'asr_final', text: latestText });
            } else if (latestIsFinal) {
              // 句末已确认且之后没有阶段文本，无需等待 task-finished
              complete(round);
            } else {
              asrStream.finish();
            }
            break;
          case 'cancel':
            round++;
            finishRequested = false;
            closeStream();
            break;
          default:
            send({ type: 'error', message: `未知消息类型: ${msg.type ?? '(空)'}` });
        }
      });

      socket.on('close', () => {
        req.log.info({ sessionId }, 'asr-stream WS 关闭');
        round++;
        closeStream();
      });
      socket.on('error', (err: Error) => {
        req.log.warn({ sessionId, err: err.message }, 'asr-stream WS 错误');
        round++;
        closeStream();
      });
    }
  );
}
