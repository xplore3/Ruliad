import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ProductKBEntry } from '@grasp-mvp/core';
import { requireRoles } from '../auth.js';
import type { RouteContext } from '../ctx.js';

const QUESTIONS = [
  '机构的科目内容',
  '适龄年龄',
  '收费标准，有没有试听当天报名的优惠政策，有没有其他的优惠政策，具体力度是什么',
  '机构是否有内部教材和课程体系',
  '科目多久考级一次，孩子学多久可以考级',
  '对于新报名的学生，一周上几次课？一次多长时间，跟年龄有关系吗',
  '机构的地址在哪里',
  '这个科目每天练习的时间需要多久，是否需要家长陪同练',
  '培训机构最大的特色或优势是什么',
  '报名以后排班流程是什么',
  '上课的简单流程',
  '根据年龄如何分班',
  '男孩学的多还是女孩学的多，分别有什么优势',
  '介绍师资力量，尤其是入门班的师资',
  '附近都有什么同行，比起他们我们的优势是什么',
  '缺课怎么补课',
  '招聘老师的标准',
  '试听课老师和上课老师是否是一样的',
  '寒暑假的集训课程如何设置',
  '退费政策如何',
] as const;

interface QaItem {
  question: string;
  answer: string;
}

function parseQa(content: string): QaItem[] {
  const parsed = JSON.parse(content) as { qa?: QaItem[] };
  if (!Array.isArray(parsed.qa)) throw new Error('问答库格式不正确');
  return parsed.qa
    .filter((item) => typeof item.question === 'string' && typeof item.answer === 'string')
    .map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
    .filter((item) => item.question && item.answer);
}

async function audioText(request: FastifyRequest, ctx: RouteContext): Promise<string> {
  if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw new Error('缺少音频');
  request.log.info({ audioBytes: request.body.length }, '机构问答：开始语音识别');
  const text = (await ctx.speech.asr.transcribe(request.body, 'pcm')).trim();
  request.log.info({ textLength: text.length }, '机构问答：语音识别完成');
  return text;
}

export async function institutionOnboardingRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.get('/institution-onboarding/status', async (request) => {
    const kb = await ctx.store.getProductKB(request.tenantId);
    const entries = kb?.entries ?? [];
    return {
      completed: entries.length > 0,
      questionCount: QUESTIONS.length,
      qa: QUESTIONS.map((question) => ({
        question,
        answer: entries.find((entry) => entry.title === question)?.content ?? '未提供相关信息',
      })),
    };
  });

  app.post('/institution-onboarding/answer', { bodyLimit: 64 * 1024 * 1024 }, async (request, reply) => {
    const text = await audioText(request, ctx);
    if (!text) return reply.code(422).send({ error: '未识别到有效语音' });
    const result = await ctx.gateway.forTask('judge').chat([{
      role: 'user',
      content: [
        `客户对照以下 ${QUESTIONS.length} 个问题，用一整段语音依次作了回答：`,
        QUESTIONS.map((question, index) => `${index + 1}. ${question}`).join('\n'),
        `语音识别文本：${text}`,
        `请整理成 ${QUESTIONS.length} 条一问一答的机构资料。必须按原顺序逐条对应，使用原问题，不得合并或拆分。保留客户提供的全部事实、数字、政策和细节，表达准确、清晰、自然，不得补充客户没说过的信息；没有明确回答的问题，答案写“未提供相关信息”。`,
        '只输出 JSON：{"qa":[{"question":"问题","answer":"整理后的答案"}]}',
      ].join('\n'),
    }], { jsonMode: true, maxTokens: 8000 });
    const parsed = JSON.parse(result.content) as { qa?: Array<{ answer?: unknown }> };
    if (!Array.isArray(parsed.qa)) return reply.code(502).send({ error: '问答整理失败，请重试' });
    return {
      qa: QUESTIONS.map((question, index) => {
        const answer = parsed.qa?.[index]?.answer;
        return {
          question,
          answer: typeof answer === 'string' && answer.trim() ? answer.trim() : '未提供相关信息',
        };
      }),
    };
  });

  app.post('/institution-onboarding/revise', async (request, reply) => {
    if (!request.isMultipart()) return reply.code(400).send({ error: '请上传问答库和修改语音' });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: '缺少修改语音' });
    const qaField = file.fields.qa;
    const qaValue = Array.isArray(qaField) ? qaField[0] : qaField;
    const qa = qaValue?.type === 'field' ? JSON.parse(String(qaValue.value)) as QaItem[] : [];
    if (qa.length === 0) return reply.code(400).send({ error: '问答库不能为空' });
    const audio = await file.toBuffer();
    if (audio.length === 0) return reply.code(400).send({ error: '缺少修改语音' });
    const instruction = (await ctx.speech.asr.transcribe(audio, 'pcm')).trim();
    if (!instruction) return reply.code(422).send({ error: '未识别到有效语音' });
    const result = await ctx.gateway.forTask('judge').chat([{
      role: 'user',
      content: [
        '客户正在确认机构问答库。请判断客户是要修改内容，还是确认没有修改。',
        `现有问答库：${JSON.stringify(qa)}`,
        `客户语音：${instruction}`,
        '如果客户要求修改，请按客户意思更新对应问答，保留其他条目和事实，不要自行补充。如果客户表示没有修改、可以了、确认或入库，则 action=done，qa原样返回。',
        '只输出 JSON：{"action":"modify|done","qa":[{"question":"问题","answer":"答案"}],"rationale":"处理说明"}',
      ].join('\n'),
    }], { jsonMode: true });
    const parsed = JSON.parse(result.content) as { action?: string; rationale?: string };
    return {
      action: parsed.action === 'modify' ? 'modify' : 'done',
      qa: parsed.action === 'modify' ? parseQa(result.content) : qa,
      rationale: String(parsed.rationale ?? (parsed.action === 'modify' ? '已按语音修改' : '已确认')),
    };
  });

  app.post<{ Body: { qa?: QaItem[] } }>('/institution-onboarding/complete', {
    preHandler: requireRoles('admin', 'platform'),
  }, async (request, reply) => {
    const qa = request.body?.qa ?? [];
    if (qa.length === 0) return reply.code(400).send({ error: '问答库不能为空' });
    const existing = await ctx.store.getProductKB(request.tenantId);
    const entries: ProductKBEntry[] = qa.map((item, index) => ({
      id: `institution-faq-${String(index + 1).padStart(2, '0')}`,
      kind: 'faq',
      title: item.question,
      content: item.answer,
    }));
    await ctx.store.saveProductKB({
      id: existing?.id ?? 'kb-institution-custom',
      tenantId: request.tenantId,
      name: '培训机构定制资料库',
      version: (existing?.version ?? 0) + 1,
      entries,
      effectiveAt: new Date().toISOString(),
    });
    return { completed: true, entries: entries.length };
  });
}
