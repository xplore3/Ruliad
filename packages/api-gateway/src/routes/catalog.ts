import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BehaviorBand, ChatMessage, PersonaConfig, Scenario, ScenarioParticipant, ScenarioScript, SceneType, TranscriptTurn } from '@grasp-mvp/core';
import { bandFor, compilePersona, PersonaActor } from '@grasp-mvp/role-engine';
import type { RouteContext } from '../ctx.js';
import { requireRoles } from '../auth.js';

interface PersonaBody {
  name?: string;
  background?: string;
  age?: number;
  occupation?: string;
  elementIds?: string[];
  productKBId?: string | null;
  behaviorBands?: BehaviorBand[];
  knowledgeBoundary?: { mustNotKnow?: string[]; loadedKnowledge?: string[] };
  voiceProfile?: Record<string, unknown>;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** 校验角色配置请求体；返回错误消息，null 表示通过 */
function validatePersonaBody(body: PersonaBody): string | null {
  if (!body.name?.trim()) return 'name 必填';
  if (!body.background?.trim()) return 'background 必填';
  if (body.age !== undefined && (!Number.isFinite(body.age) || body.age <= 0)) {
    return 'age 必须为正数';
  }
  if (!Array.isArray(body.behaviorBands) || body.behaviorBands.length === 0) {
    return 'behaviorBands 至少一档';
  }
  for (const band of body.behaviorBands) {
    if (!band.key?.trim() || !band.instruction?.trim()) return '每档的 key / instruction 必填';
    if (
      !Number.isFinite(band.minArousal) ||
      !Number.isFinite(band.maxArousal) ||
      band.minArousal < 0 ||
      band.maxArousal > 1 ||
      band.minArousal >= band.maxArousal
    ) {
      return `档位 ${band.key} 的 arousal 区间须满足 0<=min<max<=1`;
    }
  }
  if (body.elementIds !== undefined && !Array.isArray(body.elementIds)) {
    return 'elementIds 必须为数组';
  }
  return null;
}

export async function catalogRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway } = ctx;

  // 校验要素引用：存在且对本租户可见（tenant 私有或 industry/platform 共享）
  async function checkElementIds(elementIds: string[], tenantId: string): Promise<string | null> {
    for (const elementId of elementIds) {
      const element = await store.getElement(elementId);
      if (!element) return `要素不存在: ${elementId}`;
      if (element.tenantId !== undefined && element.tenantId !== tenantId) {
        return `要素不属于本租户: ${elementId}`;
      }
    }
    return null;
  }

  // 场景列表（join 角色名/职业与技能点名；methodology/source/practiceCount 随记录透传）
  app.get('/scenarios', async (request) => {
    const scenarios = await store.listScenarios(request.tenantId);
    const items = await Promise.all(
      scenarios.map(async (s) => {
        const persona = await store.getPersonaConfig(s.personaConfigId);
        const skillPoints = await Promise.all(s.skillPointIds.map((id) => store.getSkillPoint(id)));
        return {
          ...s,
          personaName: persona?.name ?? null,
          // 前端展示用角色头衔：优先角色职业，缺省回落到场景自带的一句话设定
          personaTitle: persona?.occupation ?? s.personaTitle ?? null,
          skillPointNames: skillPoints.filter((p) => p !== undefined).map((p) => p.name),
        };
      })
    );
    return { scenarios: items };
  });

  // 创建场景
  app.post<{
    Body: {
      name: string;
      personaConfigId: string;
      skillPointIds: string[];
      passScore: number;
      durationMinutes: number;
      difficulty?: number;
      coverageTopics?: string[];
      description?: string;
      productKBId?: string;
      methodology?: string;
      source?: string;
      sceneType?: SceneType;
      script?: ScenarioScript;
      participants?: ScenarioParticipant[];
    };
  }>('/scenarios', { preHandler: requireRoles('admin') }, async (request, reply) => {
    const { name, personaConfigId, skillPointIds, passScore, durationMinutes, difficulty, coverageTopics, description, productKBId, methodology, source, sceneType, script, participants } =
      request.body ?? {};
    if (!name || !personaConfigId || !Array.isArray(skillPointIds) || skillPointIds.length === 0) {
      return reply.code(400).send({ error: 'name / personaConfigId / skillPointIds 必填' });
    }
    if (sceneType !== undefined && sceneType !== 'drill' && sceneType !== 'practical') {
      return reply.code(400).send({ error: "sceneType 仅支持 'drill' | 'practical'" });
    }
    if (typeof passScore !== 'number' || typeof durationMinutes !== 'number') {
      return reply.code(400).send({ error: 'passScore / durationMinutes 必须为数字' });
    }
    if (difficulty !== undefined && typeof difficulty !== 'number') {
      return reply.code(400).send({ error: 'difficulty 必须为数字' });
    }
    if (coverageTopics !== undefined && !isStringArray(coverageTopics)) {
      return reply.code(400).send({ error: 'coverageTopics 必须为字符串数组' });
    }
    const persona = await store.getPersonaConfig(personaConfigId);
    if (!persona) return reply.code(400).send({ error: 'personaConfigId 不存在' });
    if (persona.tenantId !== request.tenantId) {
      return reply.code(400).send({ error: 'personaConfigId 不属于本租户' });
    }
    for (const spId of skillPointIds) {
      const sp = await store.getSkillPoint(spId);
      if (!sp) return reply.code(400).send({ error: `技能点不存在: ${spId}` });
      if (sp.tenantId !== request.tenantId) {
        return reply.code(400).send({ error: `技能点不属于本租户: ${spId}` });
      }
    }

    const scenario: Scenario = {
      id: randomUUID(),
      tenantId: request.tenantId,
      name,
      personaConfigId,
      productKBId: productKBId || undefined,
      skillPointIds,
      successCriteria: { passScore },
      durationMinutes,
      difficulty: difficulty ?? 1,
      coverageTopics,
      description,
      methodology,
      source,
      sceneType,
      script,
      participants,
    };
    await store.saveScenario(scenario);
    return reply.code(201).send(scenario);
  });

  // 更新场景（部分字段更新，仅传需要改的字段；admin 专属）
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      personaConfigId?: string;
      skillPointIds?: string[];
      passScore?: number;
      durationMinutes?: number;
      difficulty?: number;
      coverageTopics?: string[];
      description?: string | null;
      productKBId?: string | null;
      methodology?: string;
      source?: string;
      sceneType?: SceneType;
      script?: ScenarioScript | null;
      participants?: ScenarioParticipant[] | null;
    };
  }>('/scenarios/:id', { preHandler: requireRoles('admin') }, async (request, reply) => {
    const existing = await store.getScenario(request.params.id);
    if (!existing || existing.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '场景不存在' });
    }
    const body = request.body ?? {};
    const scenario: Scenario = { ...existing };
    if (body.name !== undefined) scenario.name = body.name;
    if (body.personaConfigId !== undefined) {
      const persona = await store.getPersonaConfig(body.personaConfigId);
      if (!persona) return reply.code(400).send({ error: 'personaConfigId 不存在' });
      if (persona.tenantId !== request.tenantId) {
        return reply.code(400).send({ error: 'personaConfigId 不属于本租户' });
      }
      scenario.personaConfigId = body.personaConfigId;
    }
    if (body.skillPointIds !== undefined) {
      if (!Array.isArray(body.skillPointIds) || body.skillPointIds.length === 0) {
        return reply.code(400).send({ error: 'skillPointIds 必须为非空数组' });
      }
      for (const spId of body.skillPointIds) {
        const sp = await store.getSkillPoint(spId);
        if (!sp) return reply.code(400).send({ error: `技能点不存在: ${spId}` });
        if (sp.tenantId !== request.tenantId) {
          return reply.code(400).send({ error: `技能点不属于本租户: ${spId}` });
        }
      }
      scenario.skillPointIds = body.skillPointIds;
    }
    if (body.passScore !== undefined) {
      if (typeof body.passScore !== 'number') {
        return reply.code(400).send({ error: 'passScore 必须为数字' });
      }
      scenario.successCriteria = { ...existing.successCriteria, passScore: body.passScore };
    }
    if (body.durationMinutes !== undefined) {
      if (typeof body.durationMinutes !== 'number') {
        return reply.code(400).send({ error: 'durationMinutes 必须为数字' });
      }
      scenario.durationMinutes = body.durationMinutes;
    }
    if (body.difficulty !== undefined) {
      if (typeof body.difficulty !== 'number') {
        return reply.code(400).send({ error: 'difficulty 必须为数字' });
      }
      scenario.difficulty = body.difficulty;
    }
    if (body.coverageTopics !== undefined) {
      if (!isStringArray(body.coverageTopics)) {
        return reply.code(400).send({ error: 'coverageTopics 必须为字符串数组' });
      }
      scenario.coverageTopics = body.coverageTopics;
    }
    if (body.description !== undefined) scenario.description = body.description ?? undefined;
    if (body.productKBId !== undefined) scenario.productKBId = body.productKBId || undefined;
    if (body.methodology !== undefined) scenario.methodology = body.methodology;
    if (body.source !== undefined) scenario.source = body.source;
    if (body.sceneType !== undefined) {
      if (body.sceneType !== 'drill' && body.sceneType !== 'practical') {
        return reply.code(400).send({ error: "sceneType 仅支持 'drill' | 'practical'" });
      }
      scenario.sceneType = body.sceneType;
    }
    if (body.script !== undefined) scenario.script = body.script ?? undefined;
    if (body.participants !== undefined) scenario.participants = body.participants ?? undefined;
    await store.saveScenario(scenario);
    return scenario;
  });

  // 删除场景（admin 专属）
  app.delete<{ Params: { id: string } }>(
    '/scenarios/:id',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const existing = await store.getScenario(request.params.id);
      if (!existing || existing.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '场景不存在' });
      }
      await store.deleteScenario(request.params.id);
      return { ok: true };
    }
  );

  app.get('/persona-configs', async (request) => ({
    personaConfigs: await store.listPersonaConfigs(request.tenantId),
  }));

  app.get<{ Params: { id: string } }>('/persona-configs/:id', async (request, reply) => {
    const persona = await store.getPersonaConfig(request.params.id);
    if (!persona || persona.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '角色不存在' });
    }
    return persona;
  });

  // 创建角色配置
  app.post<{ Body: PersonaBody }>(
    '/persona-configs',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
    const body = request.body ?? {};
    const error = validatePersonaBody(body);
    if (error) return reply.code(400).send({ error });
    const elementError = await checkElementIds(body.elementIds ?? [], request.tenantId);
    if (elementError) return reply.code(400).send({ error: elementError });
    const persona: PersonaConfig = {
      id: randomUUID(),
      tenantId: request.tenantId,
      name: body.name!.trim(),
      background: body.background!.trim(),
      age: body.age,
      occupation: body.occupation?.trim() || undefined,
      elementIds: body.elementIds ?? [],
      productKBId: body.productKBId ?? undefined,
      behaviorBands: body.behaviorBands!,
      knowledgeBoundary: {
        mustNotKnow: body.knowledgeBoundary?.mustNotKnow ?? [],
        loadedKnowledge: body.knowledgeBoundary?.loadedKnowledge ?? [],
      },
      voiceProfile: body.voiceProfile,
      version: 1,
    };
    await store.savePersonaConfig(persona);
    return reply.code(201).send(persona);
    }
  );

  // 更新角色配置（version 自增）
  app.put<{ Params: { id: string }; Body: PersonaBody }>(
    '/persona-configs/:id',
    { preHandler: requireRoles('admin') },
    async (request, reply) => {
      const existing = await store.getPersonaConfig(request.params.id);
      if (!existing || existing.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '角色不存在' });
      }
      const body = request.body ?? {};
      // 部分更新（patch 语义）：只校验出现的字段，未传字段保留原值，
      // 避免管理端只传部分字段时清空 elementIds/age/knowledgeBoundary 等
      if (body.name !== undefined && !body.name.trim()) {
        return reply.code(400).send({ error: 'name 不能为空' });
      }
      if (body.background !== undefined && !body.background.trim()) {
        return reply.code(400).send({ error: 'background 不能为空' });
      }
      if (body.age !== undefined && (!Number.isFinite(body.age) || body.age <= 0)) {
        return reply.code(400).send({ error: 'age 必须为正数' });
      }
      if (body.behaviorBands !== undefined) {
        const bandError = validatePersonaBody({
          name: 'x',
          background: 'x',
          behaviorBands: body.behaviorBands,
        });
        if (bandError) return reply.code(400).send({ error: bandError });
      }
      if (body.elementIds !== undefined && !Array.isArray(body.elementIds)) {
        return reply.code(400).send({ error: 'elementIds 必须为数组' });
      }
      const elementError = await checkElementIds(body.elementIds ?? [], request.tenantId);
      if (elementError) return reply.code(400).send({ error: elementError });
      const persona: PersonaConfig = {
        ...existing,
        name: body.name?.trim() ?? existing.name,
        background: body.background?.trim() ?? existing.background,
        age: body.age ?? existing.age,
        occupation:
          body.occupation !== undefined ? body.occupation.trim() || undefined : existing.occupation,
        elementIds: body.elementIds ?? existing.elementIds,
        productKBId: body.productKBId !== undefined ? (body.productKBId || undefined) : existing.productKBId,
        behaviorBands: body.behaviorBands ?? existing.behaviorBands,
        knowledgeBoundary: body.knowledgeBoundary
          ? {
              mustNotKnow: body.knowledgeBoundary.mustNotKnow ?? existing.knowledgeBoundary.mustNotKnow,
              loadedKnowledge:
                body.knowledgeBoundary.loadedKnowledge ?? existing.knowledgeBoundary.loadedKnowledge,
            }
          : existing.knowledgeBoundary,
        voiceProfile: body.voiceProfile ?? existing.voiceProfile,
        version: existing.version + 1,
      };
    await store.savePersonaConfig(persona);
    return persona;
    }
  );

  // 角色试玩：不落库的试聊（编译运行时包 + actor 单轮回复，不创建会话/评分）
  // history 由前端维护，形如 [{role:'user'|'assistant', content}]，只取最近 10 条
  app.post<{
    Params: { id: string };
    Body: { text?: string; history?: { role: 'user' | 'assistant'; content: string }[] };
  }>('/persona-configs/:id/trial-chat', async (request, reply) => {
    const persona = await store.getPersonaConfig(request.params.id);
    if (!persona || persona.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '角色不存在' });
    }
    const text = request.body?.text?.trim();
    if (!text) return reply.code(400).send({ error: 'text 必填' });

    const elements = await store.listElements({});
    // 加载产品知识库：陪练员级 productKBId 或租户默认 KB
    const kb = persona.productKBId
      ? await store.getProductKBById(persona.productKBId)
      : await store.getProductKB(persona.tenantId);
    const bundle = compilePersona(persona, elements, kb);
    const band = bandFor(bundle.dynamics.baseArousal, bundle.behaviorBands);
    const now = new Date().toISOString();
    const history = (request.body?.history ?? []).slice(-10);
    const transcript: TranscriptTurn[] = [
      ...history.map((h, i) => ({
        seq: i + 1,
        speaker: (h.role === 'user' ? 'trainee' : 'persona') as TranscriptTurn['speaker'],
        text: h.content,
        at: now,
      })),
      { seq: history.length + 1, speaker: 'trainee' as const, text, at: now },
    ];

    const actor = new PersonaActor(gateway.forTask('actor'));
    const replyText = await actor.reply(bundle, band, transcript);
    return { reply: replyText };
  });

  // ---- 角色画像自定义（普通用户可调用） ----

  /** 保存自定义画像特征（沟通风格、核心顾虑、挑战强度、行业偏好、知识边界等） */
  app.patch<{ Params: { id: string }; Body: {
    style?: string[];
    concerns?: string[];
    difficulty?: string;
    industryPreference?: string;
    knowledgeBoundaryExtra?: { mustNotKnow?: string[]; loadedKnowledge?: string[] };
    background?: string;
    occupation?: string;
    avatar?: string;
  } }>('/persona-configs/:id/customize', async (request, reply) => {
    const persona = await store.getPersonaConfig(request.params.id);
    if (!persona || persona.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '角色不存在' });
    }
    const body = request.body ?? {};
    const updated: PersonaConfig = {
      ...persona,
      avatar: body.avatar?.trim() || persona.avatar,
      background: body.background?.trim() || persona.background,
      occupation: body.occupation?.trim() || persona.occupation,
      knowledgeBoundary: {
        mustNotKnow: [
          ...persona.knowledgeBoundary.mustNotKnow,
          ...(body.knowledgeBoundaryExtra?.mustNotKnow ?? []),
        ],
        loadedKnowledge: [
          ...persona.knowledgeBoundary.loadedKnowledge,
          ...(body.knowledgeBoundaryExtra?.loadedKnowledge ?? []),
        ],
      },
      version: persona.version + 1,
    };
    // 将自定义特征编码到 background 中（前端可见、角色扮演时作为提示）
    const customParts: string[] = [];
    if (body.style?.length) customParts.push(`沟通风格：${body.style.join('、')}`);
    if (body.concerns?.length) customParts.push(`核心顾虑：${body.concerns.join('、')}`);
    if (body.difficulty) customParts.push(`挑战强度：${body.difficulty}`);
    if (body.industryPreference) customParts.push(`行业偏好：${body.industryPreference}`);
    if (customParts.length > 0) {
      const customTag = `\n【自定义特征】${customParts.join('；')}。`;
      if (!updated.background.includes('【自定义特征】')) {
        updated.background = updated.background + customTag;
      } else {
        updated.background = updated.background.replace(/\n【自定义特征】.*$/, customTag);
      }
    }
    await store.savePersonaConfig(updated);
    return { persona: updated, message: '画像已保存' };
  });

  /**
   * 上传自定义头像（multipart/form-data，字段名 file）
   * 返回 { avatar: dataUrl }
   * 限制 2MB，仅接受图片类型
   */
  app.post<{ Params: { id: string } }>('/persona-configs/:id/avatar', async (request, reply) => {
    const persona = await store.getPersonaConfig(request.params.id);
    if (!persona || persona.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '角色不存在' });
    }
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: '请用 multipart/form-data 上传文件' });
    }
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: '缺少 file 字段' });
    }
    const buf = await file.toBuffer();
    if (buf.length > 2 * 1024 * 1024) {
      return reply.code(413).send({ error: '图片大小不能超过 2MB' });
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      return reply.code(415).send({ error: '仅支持 JPG / PNG / WebP / GIF 格式' });
    }
    const dataUrl = `data:${file.mimetype};base64,${buf.toString('base64')}`;
    const updated: PersonaConfig = { ...persona, avatar: dataUrl, version: persona.version + 1 };
    await store.savePersonaConfig(updated);
    return { avatar: dataUrl, message: '头像已更新' };
  });

  /**
   * AI 对话式修改画像：用户用自然语言描述想怎么改，AI 理解意图后返回修改建议（JSON），
   * 前端可预览后再确认保存。支持文字和语音（语音走 voice-turn 同一 ASR 链路）。
   * body.text = 用户输入的文字（或 ASR 识别结果）
   * body.history = 对话历史 [{role, content}]
   * 返回 { reply, suggestedChanges }
   */
  app.post<{ Params: { id: string }; Body: {
    text?: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
    apply?: boolean;
  } }>('/persona-configs/:id/chat-customize', async (request, reply) => {
    const persona = await store.getPersonaConfig(request.params.id);
    if (!persona || persona.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '角色不存在' });
    }
    const text = request.body?.text?.trim();
    if (!text) return reply.code(400).send({ error: 'text 必填' });

    const history = (request.body?.history ?? []).slice(-10);
    const apply = request.body?.apply ?? false;

    // 构造系统提示：让 AI 充当画像编辑助手
    const systemPrompt = [
      '你是角色画像编辑助手。用户想通过对话修改角色画像，你需要理解用户的意图，',
      '给出友好的回复，并返回结构化的修改建议。',
      '',
      `当前角色画像：`,
      `姓名：${persona.name}`,
      `背景：${persona.background}`,
      persona.occupation ? `职业：${persona.occupation}` : '',
      `版本：v${persona.version}`,
      '',
      '你可以修改以下字段：',
      '- background: 背景描述',
      '- occupation: 职业',
      '- style: 沟通风格（数组，如 ["理性", "直接"]）',
      '- concerns: 核心顾虑（数组，如 ["价格", "风险"]）',
      '- difficulty: 挑战强度（如 "进阶 · 更深入地追问价值"）',
      '- industryPreference: 行业偏好',
      '- mustNotKnow: 不该知道的信息（数组）',
      '- loadedKnowledge: 额外知识（数组）',
      '',
      '请以 JSON 格式返回修改建议，格式为：',
      '{"reply":"给用户的回复","changes":{...修改的字段...}}',
      '如果用户只是闲聊或提问，changes 返回空对象 {}。',
      '注意 reply 字段用中文，语气亲切。',
    ].filter(Boolean).join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((h) => ({
        role: h.role === 'user' ? 'user' as const : 'assistant' as const,
        content: h.content,
      })),
      { role: 'user', content: text },
    ];

    const provider = gateway.forTask('actor');
    const result = await provider.chat(messages, { jsonMode: true, temperature: 0.3 });

    let parsed: { reply?: string; changes?: Record<string, unknown> };
    try {
      parsed = JSON.parse(result.content);
    } catch {
      parsed = { reply: result.content, changes: {} };
    }

    const replyText = parsed.reply ?? '好的，我理解了您的需求。';
    const changes = parsed.changes ?? {};

    // 如果 apply=true 且有修改，直接落库
    let savedPersona: PersonaConfig | null = null;
    if (apply && changes && Object.keys(changes).length > 0) {
      const updated: PersonaConfig = { ...persona, version: persona.version + 1 };
      if (typeof changes.background === 'string') updated.background = changes.background;
      if (typeof changes.occupation === 'string') updated.occupation = changes.occupation;
      if (Array.isArray(changes.mustNotKnow) || Array.isArray(changes.loadedKnowledge)) {
        updated.knowledgeBoundary = {
          mustNotKnow: Array.isArray(changes.mustNotKnow)
            ? [...persona.knowledgeBoundary.mustNotKnow, ...(changes.mustNotKnow as string[])]
            : persona.knowledgeBoundary.mustNotKnow,
          loadedKnowledge: Array.isArray(changes.loadedKnowledge)
            ? [...persona.knowledgeBoundary.loadedKnowledge, ...(changes.loadedKnowledge as string[])]
            : persona.knowledgeBoundary.loadedKnowledge,
        };
      }
      // style / concerns / difficulty / industryPreference 编码到 background
      const customParts: string[] = [];
      if (Array.isArray(changes.style)) customParts.push(`沟通风格：${(changes.style as string[]).join('、')}`);
      if (Array.isArray(changes.concerns)) customParts.push(`核心顾虑：${(changes.concerns as string[]).join('、')}`);
      if (typeof changes.difficulty === 'string') customParts.push(`挑战强度：${changes.difficulty}`);
      if (typeof changes.industryPreference === 'string') customParts.push(`行业偏好：${changes.industryPreference}`);
      if (customParts.length > 0) {
        const customTag = `\n【自定义特征】${customParts.join('；')}。`;
        if (!updated.background.includes('【自定义特征】')) {
          updated.background = updated.background + customTag;
        } else {
          updated.background = updated.background.replace(/\n【自定义特征】.*$/, customTag);
        }
      }
      await store.savePersonaConfig(updated);
      savedPersona = updated;
    }

    return {
      reply: replyText,
      changes,
      applied: apply && Object.keys(changes).length > 0,
      persona: savedPersona,
    };
  });

  /**
   * 导入资料到画像：用户上传文件内容或粘贴聊天记录，
   * AI 自动提取客户特征并生成画像修改建议。
   * body.source = 'file' | 'chat-record'
   * body.content = 文本内容
   * body.apply = 是否直接落库
   * 返回 { extracted, reply, changes, applied, persona }
   */
  app.post<{ Params: { id: string }; Body: {
    source: 'file' | 'chat-record';
    content?: string;
    fileName?: string;
    apply?: boolean;
  } }>('/persona-configs/:id/import', async (request, reply) => {
    const persona = await store.getPersonaConfig(request.params.id);
    if (!persona || persona.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '角色不存在' });
    }
    const { source, content, fileName, apply } = request.body ?? {};
    if (!content?.trim()) return reply.code(400).send({ error: 'content 必填' });

    // 构造系统提示：让 AI 从资料中提取画像特征
    const sourceLabel = source === 'file' ? `文件${fileName ? `「${fileName}」` : ''}` : '聊天记录';
    const systemPrompt = [
      '你是角色画像分析师。用户会提供一段资料（文件内容或聊天记录），',
      '你需要从中提取客户/陪练员的画像特征，用于丰富或更新角色画像。',
      '',
      `当前角色画像：`,
      `姓名：${persona.name}`,
      `背景：${persona.background}`,
      persona.occupation ? `职业：${persona.occupation}` : '',
      '',
      `资料来源：${sourceLabel}`,
      `资料内容：`,
      content.slice(0, 8000),
      '',
      '请分析资料，提取以下信息（有则填，无则省略）：',
      '- background: 更新后的背景描述（保留原有信息，补充新发现）',
      '- occupation: 职业/职位',
      '- style: 沟通风格（数组，如 ["理性", "直接"]）',
      '- concerns: 核心顾虑（数组）',
      '- difficulty: 挑战强度',
      '- industryPreference: 行业偏好',
      '- mustNotKnow: 不该知道的信息（数组）',
      '- loadedKnowledge: 额外知识（数组）',
      '',
      '请以 JSON 格式返回，格式为：',
      '{"reply":"给用户的分析摘要（中文，1-3句话）","changes":{...提取的字段...}}',
      '如果资料中无法提取有效画像信息，changes 返回空对象 {}。',
    ].filter(Boolean).join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请分析这段${sourceLabel}并提取画像特征。` },
    ];

    const provider = gateway.forTask('actor');
    const result = await provider.chat(messages, { jsonMode: true, temperature: 0.3 });

    let parsed: { reply?: string; changes?: Record<string, unknown> };
    try {
      parsed = JSON.parse(result.content);
    } catch {
      parsed = { reply: result.content, changes: {} };
    }

    const replyText = parsed.reply ?? '分析完成。';
    const changes = parsed.changes ?? {};

    // 如果 apply=true 且有修改，直接落库
    let savedPersona: PersonaConfig | null = null;
    if (apply && changes && Object.keys(changes).length > 0) {
      const updated: PersonaConfig = { ...persona, version: persona.version + 1 };
      if (typeof changes.background === 'string') updated.background = changes.background;
      if (typeof changes.occupation === 'string') updated.occupation = changes.occupation;
      if (Array.isArray(changes.mustNotKnow) || Array.isArray(changes.loadedKnowledge)) {
        updated.knowledgeBoundary = {
          mustNotKnow: Array.isArray(changes.mustNotKnow)
            ? [...persona.knowledgeBoundary.mustNotKnow, ...(changes.mustNotKnow as string[])]
            : persona.knowledgeBoundary.mustNotKnow,
          loadedKnowledge: Array.isArray(changes.loadedKnowledge)
            ? [...persona.knowledgeBoundary.loadedKnowledge, ...(changes.loadedKnowledge as string[])]
            : persona.knowledgeBoundary.loadedKnowledge,
        };
      }
      // style / concerns / difficulty / industryPreference 编码到 background
      const customParts: string[] = [];
      if (Array.isArray(changes.style)) customParts.push(`沟通风格：${(changes.style as string[]).join('、')}`);
      if (Array.isArray(changes.concerns)) customParts.push(`核心顾虑：${(changes.concerns as string[]).join('、')}`);
      if (typeof changes.difficulty === 'string') customParts.push(`挑战强度：${changes.difficulty}`);
      if (typeof changes.industryPreference === 'string') customParts.push(`行业偏好：${changes.industryPreference}`);
      if (customParts.length > 0) {
        const customTag = `\n【自定义特征】${customParts.join('；')}。`;
        if (!updated.background.includes('【自定义特征】')) {
          updated.background = updated.background + customTag;
        } else {
          updated.background = updated.background.replace(/\n【自定义特征】.*$/, customTag);
        }
      }
      await store.savePersonaConfig(updated);
      savedPersona = updated;
    }

    return {
      reply: replyText,
      changes,
      applied: apply && Object.keys(changes).length > 0,
      persona: savedPersona,
    };
  });

  // 要素列表（角色编辑器的要素多选器数据源；含 tenant 私有 + industry/platform 共享要素）
  app.get<{
    Querystring: { type?: string; layer?: string };
  }>('/elements', async (request) => {
    const all = await store.listElements({
      type: request.query.type,
      layer: request.query.layer,
    });
    return {
      elements: all.filter((e) => e.tenantId === undefined || e.tenantId === request.tenantId),
    };
  });

  app.get('/skill-points', async (request) => ({
    skillPoints: await store.listSkillPoints(request.tenantId),
  }));

  // ── 陪练员卡片列表（首页探探式滑动用） ──
  // 合并 persona-configs + scenarios，返回 RoleCard 格式
  app.get('/role-cards', async (request) => {
    const personas = await store.listPersonaConfigs(request.tenantId);
    const scenarios = await store.listScenarios(request.tenantId);

    // 行业 / 角色推断辅助
    const inferIndustry = (p: PersonaConfig): string => {
      const text = `${p.background} ${p.occupation ?? ''}`;
      if (/医院|医药|科室|临床|降糖/.test(text)) return '医药';
      if (/金融|理财|CFO|融资|投资/.test(text)) return '金融';
      if (/软件|CTO|IT|SaaS|技术/.test(text)) return '企业软件';
      if (/地产|房|购房|物业|办公/.test(text)) return '地产';
      if (/教育|家长|课程|升学/.test(text)) return '教育';
      if (/电商|天猫|拼多多|跨境|直播/.test(text)) return '电商';
      if (/保险|重疾|保费|保障/.test(text)) return '保险';
      return '综合';
    };
    const inferRole = (p: PersonaConfig): string => {
      const occ = p.occupation ?? '';
      if (/主任|医生/.test(occ)) return '医生';
      if (/采购/.test(occ)) return '采购';
      if (/CTO|技术/.test(occ)) return '技术负责人';
      if (/CFO|财务/.test(occ)) return '企业客户';
      if (/家长/.test(occ)) return '家长';
      if (/商家|卖家/.test(occ)) return '商家';
      if (/购房|行政/.test(occ)) return '客户';
      if (/理财|保险/.test(occ)) return '个人客户';
      return '客户';
    };
    const inferDifficulty = (p: PersonaConfig): '入门' | '进阶' | '高压' => {
      const count = p.sourceMeta?.practiceCount ?? 0;
      if (count < 200) return '入门';
      if (count < 600) return '进阶';
      return '高压';
    };
    const inferTags = (p: PersonaConfig): string[] => {
      const text = `${p.background} ${p.occupation ?? ''}`;
      const tags: string[] = [];
      if (/价格敏感|预算|成本|费率/.test(text)) tags.push('价格敏感');
      if (/学术|数据|循证|严谨/.test(text)) tags.push('数据驱动');
      if (/时间紧张|效率|快速|快/.test(text)) tags.push('时间紧张');
      if (/安全|合规|流程|资质/.test(text)) tags.push('合规导向');
      if (/灵活|多变|善变/.test(text)) tags.push('灵活多变');
      if (tags.length === 0) tags.push('通用型');
      return tags.slice(0, 3);
    };
    const inferTarget = (p: PersonaConfig): string => {
      const text = `${p.background} ${p.occupation ?? ''}`;
      if (/价格|预算|成本/.test(text)) return '用价值回应价格异议';
      if (/学术|数据|循证/.test(text)) return '用数据与证据建立信任';
      if (/安全|合规/.test(text)) return '用合规与安全保障打动客户';
      if (/效率|时间|快/.test(text)) return '用高效沟通赢得时间';
      if (/灵活|多变/.test(text)) return '用确定性化解客户犹豫';
      return '通过专业沟通提升成单率';
    };

    // personaId → scenario 映射（如有）
    const personaToScenario = new Map<string, Scenario>();
    for (const s of scenarios) {
      if (!personaToScenario.has(s.personaConfigId)) {
        personaToScenario.set(s.personaConfigId, s);
      }
    }

    // ── 为每个陪练员生成唯一头像 SVG data URL ──
    // 基于 persona id 的哈希 → 唯一渐变色 + 姓名首字
    const AVATAR_COLORS: Array<[string, string]> = [
      ['#E85C62', '#D04A52'], ['#5DC7A3', '#3BA882'], ['#6C8AE4', '#4A6BC4'],
      ['#F0996A', '#D9774A'], ['#A78BE0', '#8566C0'], ['#E0A050', '#C08030'],
      ['#5BB5C9', '#3A95A9'], ['#D46BA0', '#B04B80'], ['#7DA850', '#5D8830'],
      ['#C97A5D', '#A95A3D'], ['#5A9FCB', '#3A7FAB'], ['#E87D9A', '#C85D7A'],
    ];
    function hashStr(s: string): number {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      return Math.abs(h);
    }
    function genAvatar(p: PersonaConfig): string {
      const h = hashStr(p.id);
      const [c1, c2] = AVATAR_COLORS[h % AVATAR_COLORS.length];
      const initial = p.name.charAt(0);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><defs><linearGradient id="g${h}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="200" height="200" rx="16" fill="url(#g${h})"/><text x="100" y="135" font-size="80" font-weight="bold" text-anchor="middle" fill="white" font-family="PingFang SC,Microsoft YaHei,sans-serif">${initial}</text></svg>`;
      return `data:image/svg+xml,${encodeURIComponent(svg)}`;
    }

    const cards = personas.map((p) => {
      const scenario = personaToScenario.get(p.id);
      const difficulty = inferDifficulty(p);
      return {
        id: p.id,
        scenarioId: scenario?.id ?? null,
        name: p.name,
        title: `${p.occupation ?? '客户'} · ${inferIndustry(p)} · 陪练员`,
        tags: inferTags(p),
        target: inferTarget(p),
        source: `案例库 v${p.version}`,
        difficulty,
        industry: inferIndustry(p),
        role: inferRole(p),
        avatar: genAvatar(p),
      };
    });

    return { cards };
  });
}
