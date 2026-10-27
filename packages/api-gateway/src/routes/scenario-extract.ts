import type { FastifyInstance } from 'fastify';
import type { ChatMessage } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';

const CATEGORIES = ['电话销售', '客户主动咨询', '成交谈判', '地推破冰'];
const PERSONALITY_TAGS = ['谨慎', '重数据', '爱压价', '爽快', '强势', '善拖延', '话多', '戒备'];
const DECISION_STYLES = [
  '凭感觉快速拍板',
  '理性比较，需要数据佐证',
  '向上汇报，本人不拍板',
  '多方询价，拖到最后',
];
const DIMENSION_KEYS = [
  'discovery（需求挖掘）',
  'presentation（价值表达）',
  'objection（异议处理）',
  'closing（流程推进）',
  'rhythm（沟通节奏）',
  'compliance（专业合规）',
];

/** 'audio/wav; codecs=1' → 'wav'；取不到时回退 'pcm' */
function formatFromMime(mime: string | undefined): string {
  const f = (mime ?? '').toLowerCase().replace(/^audio\//, '').split(';')[0].trim();
  return f || 'pcm';
}

/**
 * 场景编辑器语音/文字输入：描述 → LLM 提取场景维度（不落库，前端预览确认后填表单）。
 * 所有登录用户可用（保存场景仍由场景 CRUD 的权限控制）。
 * - JSON body: { text, current? }  current 为当前表单快照，存在时表示增量修改
 * - audio/* raw body: 先 ASR 转写再提取（全量模式，返回 transcript）
 * - multipart: 音频文件 + 可选 current 字段（JSON 字符串），语音也可增量修改
 */
export async function scenarioExtractRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway, speech } = ctx;

  // audio/* raw body 按 Buffer 收下（multipart 由全局 @fastify/multipart 处理）
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post<{ Body: { text?: string; current?: Record<string, unknown> } }>(
    '/scenarios/extract',
    async (request, reply) => {
      // 1. 取文本：JSON 直传，或音频先 ASR
      let text: string | undefined;
      let transcript: string | undefined;
      let current: Record<string, unknown> | undefined;

      if (request.isMultipart()) {
        const file = await request.file();
        if (!file) return reply.code(400).send({ error: 'multipart 请求缺少音频文件字段' });
        // multipart 可携带 current 字段（JSON 字符串，需先于文件字段 append），用于语音增量修改
        const currentField = file.fields['current'];
        const currentValue = Array.isArray(currentField) ? currentField[0] : currentField;
        if (currentValue && currentValue.type === 'field' && typeof currentValue.value === 'string') {
          try {
            current = JSON.parse(currentValue.value) as Record<string, unknown>;
          } catch {
            /* 非法 JSON 忽略，按全量提取处理 */
          }
        }
        const audio = await file.toBuffer();
        transcript = (await speech.asr.transcribe(audio, formatFromMime(file.mimetype))).trim();
        if (!transcript) return reply.code(422).send({ error: '未识别到有效语音' });
        text = transcript;
      } else if (Buffer.isBuffer(request.body)) {
        if (request.body.length === 0) {
          return reply.code(400).send({ error: '缺少音频：raw body 为空' });
        }
        transcript = (await speech.asr.transcribe(request.body, formatFromMime(request.headers['content-type']))).trim();
        if (!transcript) return reply.code(422).send({ error: '未识别到有效语音' });
        text = transcript;
      } else {
        text = request.body?.text?.trim();
        current = request.body?.current;
        if (!text) return reply.code(400).send({ error: 'text 必填' });
      }

      // 2. 技能点列表供 LLM 选择
      const skillPoints = await store.listSkillPoints(request.tenantId);
      const skillPointNames = skillPoints.map((sp) => sp.name);

      // 3. LLM 结构化提取
      const systemPrompt = [
        '你是销售陪练场景的编辑助手。用户用自然语言描述想要创建或修改的练习场景，',
        '你需要把描述提取为结构化的场景配置字段。',
        '',
        '可提取的字段及取值域：',
        `- name: 场景标题（不超过30字）`,
        `- category: 场景类别，只能是：${CATEGORIES.join(' / ')}`,
        '- description: 场景描述（不超过200字）',
        '- difficulty: 难度，整数 1（初级）/ 2（进阶）/ 3（挑战）',
        '- duration: 预计时长（分钟），整数 1-60',
        '- goal: 我方练习目标',
        '- successCriteria: 及格分，0-100 的数字',
        '- doNot: 禁止事项',
        '- roleName / roleTitle / roleIndustry: 角色姓名 / 职位 / 行业',
        `- personalities: 性格标签数组，只能从以下选：${PERSONALITY_TAGS.join('、')}`,
        `- decisionStyle: 决策风格，只能是：${DECISION_STYLES.join(' / ')}`,
        '- objections: 典型异议（多条用分号分隔）',
        '- hiddenInfo: 禁止透露内容',
        '- speechRate: 语速，整数 1（慢）/ 2（标准）/ 3（快）',
        '- challenge: 挑战强度，整数 1-5',
        '- interruptLevel: 打断频率，只能是 off / weak / strong',
        skillPointNames.length > 0
          ? `- skillPointNames: 考核技能点名称数组，只能从以下选：${skillPointNames.join('、')}`
          : '- skillPointNames: 考核技能点名称数组，无候选时返回空数组',
        `- dimensionWeights: 六维权重对象，key 只能是 ${DIMENSION_KEYS.join('、')}，值为整数百分比，六项合计必须为 100`,
        '',
        current
          ? `当前场景配置（JSON）：\n${JSON.stringify(current)}\n\n用户是在修改现有场景：未提及的字段必须保持当前值原样输出，只修改用户明确提到的部分。`
          : '用户是在创建新场景：描述中未提及的字段给出合理默认值（性格/权重等按常见销售场景推断）。',
        '',
        '严格以 JSON 返回，不要输出任何其他文字，格式为：',
        '{"reply":"给用户的一句话中文摘要","fields":{...上述字段的子集...}}',
        '如果描述完全无法提取场景信息，fields 返回空对象 {} 并在 reply 中说明。',
      ].join('\n');

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text!.slice(0, 4000) },
      ];

      const provider = gateway.forTask('extractor');
      const result = await provider.chat(messages, { jsonMode: true, temperature: 0.3 });

      let parsed: { reply?: string; fields?: Record<string, unknown> };
      try {
        parsed = JSON.parse(result.content);
      } catch {
        const m = result.content.match(/\{[\s\S]*\}/);
        try {
          parsed = m ? JSON.parse(m[0]) : { reply: result.content, fields: {} };
        } catch {
          parsed = { reply: '提取失败，请换个说法重试', fields: {} };
        }
      }

      return {
        transcript,
        reply: parsed.reply ?? '提取完成。',
        fields: parsed.fields ?? {},
      };
    }
  );
}
