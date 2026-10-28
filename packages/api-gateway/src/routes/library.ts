import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  AnalysisStandard,
  ChatMessage,
  CustomerQuestion,
  GoldenCase,
  RealismStandard,
  ScenarioGuidance,
  ScoreItemDef,
  ScoreLevel,
} from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';

type ExtractTarget = 'scenario' | 'question' | 'score-item' | 'golden-case';

const SCORE_LAYERS = new Set<ScoreItemDef['layer']>(['company', 'team', 'personal']);

/** 校验评分项请求体；返回错误消息，null 表示通过 */
function validateScoreItemBody(body: Partial<ScoreItemDef>): string | null {
  if (!body.skillPointId?.trim()) return 'skillPointId 必填';
  if (!body.name?.trim()) return 'name 必填';
  if (!Array.isArray(body.levels) || body.levels.length === 0) return 'levels 至少一档';
  for (const lv of body.levels) {
    if (!lv?.key?.trim() || !lv?.label?.trim() || typeof lv?.score !== 'number') {
      return '每档的 key / label / score 必填';
    }
  }
  if (body.layer !== undefined && !SCORE_LAYERS.has(body.layer)) {
    return "layer 仅支持 'company' | 'team' | 'personal'";
  }
  return null;
}

/** 校验客户提问请求体；返回错误消息，null 表示通过 */
function validateQuestionBody(body: Partial<CustomerQuestion>): string | null {
  if (!body.category?.trim()) return 'category 必填';
  if (!body.question?.trim()) return 'question 必填';
  if (body.difficulty !== undefined && (!Number.isFinite(body.difficulty) || body.difficulty < 1 || body.difficulty > 3)) {
    return 'difficulty 须为 1-3';
  }
  return null;
}

/** 归一化客户提问：trim 文本、过滤空可选字段 */
function normalizeQuestion(body: Partial<CustomerQuestion>, tenantId: string, id?: string): CustomerQuestion {
  return {
    id: id ?? randomUUID(),
    tenantId,
    category: body.category!.trim(),
    question: body.question!.trim(),
    referenceAnswer: body.referenceAnswer?.trim() || undefined,
    difficulty: body.difficulty ?? undefined,
    skillPointIds: Array.isArray(body.skillPointIds) ? body.skillPointIds : undefined,
    frequency: typeof body.frequency === 'number' ? body.frequency : undefined,
  };
}

/** LLM 返回 JSON 解析：失败时正则兜底 */
function parseExtractResult(content: string): { reply?: string; rows?: Record<string, unknown>[] } {
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    try {
      return m ? JSON.parse(m[0]) : { reply: content, rows: [] };
    } catch {
      return { reply: '提取失败，请换个说法重试', rows: [] };
    }
  }
}

export async function libraryRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway } = ctx;

  // ---- 客户提问问题库 ----
  app.get<{ Querystring: { category?: string } }>('/library/questions', async (request) => ({
    questions: await store.listCustomerQuestions(request.tenantId, request.query.category),
  }));

  app.post<{ Body: Partial<CustomerQuestion> }>('/library/questions', async (request, reply) => {
    const error = validateQuestionBody(request.body ?? {});
    if (error) return reply.code(400).send({ error });
    const q = normalizeQuestion(request.body ?? {}, request.tenantId);
    await store.saveCustomerQuestion(q);
    return reply.code(201).send(q);
  });

  // 批量新建（表格粘贴 / AI 提炼确认后入库）；全量校验，任一不合法整体拒绝
  app.post<{ Body: { items?: Partial<CustomerQuestion>[] } }>(
    '/library/questions/batch',
    async (request, reply) => {
      const items = request.body?.items;
      if (!Array.isArray(items) || items.length === 0) {
        return reply.code(400).send({ error: 'items 必填且非空' });
      }
      for (const [i, item] of items.entries()) {
        const error = validateQuestionBody(item);
        if (error) return reply.code(400).send({ error: `items[${i}]: ${error}` });
      }
      const saved = items.map((item) => normalizeQuestion(item, request.tenantId));
      for (const q of saved) await store.saveCustomerQuestion(q);
      return reply.code(201).send({ count: saved.length, questions: saved });
    }
  );

  app.put<{ Params: { id: string }; Body: Partial<CustomerQuestion> }>(
    '/library/questions/:id',
    async (request, reply) => {
      const existing = await store.getCustomerQuestion(request.params.id);
      if (!existing || existing.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '问题不存在' });
      }
      const body = request.body ?? {};
      const merged: CustomerQuestion = {
        ...existing,
        category: body.category?.trim() ?? existing.category,
        question: body.question?.trim() ?? existing.question,
        referenceAnswer: body.referenceAnswer !== undefined ? body.referenceAnswer?.trim() || undefined : existing.referenceAnswer,
        difficulty: body.difficulty !== undefined ? body.difficulty : existing.difficulty,
        skillPointIds: body.skillPointIds !== undefined ? body.skillPointIds : existing.skillPointIds,
        frequency: body.frequency !== undefined ? body.frequency : existing.frequency,
      };
      const error = validateQuestionBody(merged);
      if (error) return reply.code(400).send({ error });
      await store.saveCustomerQuestion(merged);
      return merged;
    }
  );

  app.delete<{ Params: { id: string } }>('/library/questions/:id', async (request, reply) => {
    const existing = await store.getCustomerQuestion(request.params.id);
    if (!existing || existing.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '问题不存在' });
    }
    await store.deleteCustomerQuestion(request.params.id);
    return { ok: true };
  });

  // ---- 评分项定义 ----
  app.get<{ Querystring: { skillPointId?: string } }>('/library/score-items', async (request) => ({
    items: await store.listScoreItemDefs(request.tenantId, request.query.skillPointId),
  }));

  app.post<{ Body: Partial<ScoreItemDef> }>('/library/score-items', async (request, reply) => {
    const body = request.body ?? {};
    const error = validateScoreItemBody(body);
    if (error) return reply.code(400).send({ error });
    if (!(await store.getSkillPoint(body.skillPointId!))) {
      return reply.code(400).send({ error: `技能点不存在: ${body.skillPointId}` });
    }
    const def: ScoreItemDef = {
      id: randomUUID(),
      tenantId: request.tenantId,
      skillPointId: body.skillPointId!,
      name: body.name!.trim(),
      behaviorAnchor: body.behaviorAnchor ?? '',
      judgePrompt: body.judgePrompt ?? '',
      weight: body.weight ?? 1,
      levels: body.levels!,
      layer: body.layer ?? 'company',
      isObservation: body.isObservation ?? false,
    };
    await store.upsertScoreItemDef(def);
    return reply.code(201).send(def);
  });

  app.put<{ Params: { id: string }; Body: Partial<ScoreItemDef> }>(
    '/library/score-items/:id',
    async (request, reply) => {
      const defs = await store.listScoreItemDefs(request.tenantId);
      const existing = defs.find((d) => d.id === request.params.id);
      if (!existing) return reply.code(404).send({ error: '评分项不存在' });
      const body = request.body ?? {};
      const merged: ScoreItemDef = {
        ...existing,
        skillPointId: body.skillPointId ?? existing.skillPointId,
        name: body.name?.trim() ?? existing.name,
        behaviorAnchor: body.behaviorAnchor ?? existing.behaviorAnchor,
        judgePrompt: body.judgePrompt ?? existing.judgePrompt,
        weight: body.weight ?? existing.weight,
        levels: (body.levels as ScoreLevel[] | undefined) ?? existing.levels,
        layer: body.layer ?? existing.layer,
        isObservation: body.isObservation ?? existing.isObservation,
      };
      const error = validateScoreItemBody(merged);
      if (error) return reply.code(400).send({ error });
      await store.upsertScoreItemDef(merged);
      return merged;
    }
  );

  app.delete<{ Params: { id: string } }>('/library/score-items/:id', async (request, reply) => {
    const defs = await store.listScoreItemDefs(request.tenantId);
    if (!defs.some((d) => d.id === request.params.id)) {
      return reply.code(404).send({ error: '评分项不存在' });
    }
    await store.deleteScoreItemDef(request.params.id);
    return { ok: true };
  });

  // ---- 金标准案例 ----
  app.get('/library/golden-cases', async () => ({
    cases: await store.listGoldenCases(),
  }));

  app.post<{ Body: Partial<GoldenCase> }>('/library/golden-cases', async (request, reply) => {
    const body = request.body ?? {};
    if (!body.name?.trim() || !body.transcript?.length || !body.expected?.length) {
      return reply.code(400).send({ error: 'name / transcript / expected 必填' });
    }
    const goldenCase: GoldenCase = { ...body, id: randomUUID() } as GoldenCase;
    await store.saveGoldenCase(goldenCase);
    return reply.code(201).send(goldenCase);
  });

  app.put<{ Params: { id: string }; Body: Partial<GoldenCase> }>(
    '/library/golden-cases/:id',
    async (request, reply) => {
      const cases = await store.listGoldenCases();
      const existing = cases.find((c) => c.id === request.params.id);
      if (!existing) return reply.code(404).send({ error: '金标准案例不存在' });
      const body = request.body ?? {};
      const updated: GoldenCase = {
        ...existing,
        name: body.name?.trim() ?? existing.name,
        transcript: body.transcript ?? existing.transcript,
        expected: body.expected ?? existing.expected,
      };
      if (!updated.transcript.length || !updated.expected.length) {
        return reply.code(400).send({ error: 'transcript / expected 不能为空' });
      }
      await store.saveGoldenCase(updated);
      return updated;
    }
  );

  app.delete<{ Params: { id: string } }>('/library/golden-cases/:id', async (request, reply) => {
    const cases = await store.listGoldenCases();
    if (!cases.some((c) => c.id === request.params.id)) {
      return reply.code(404).send({ error: '金标准案例不存在' });
    }
    await store.deleteGoldenCase(request.params.id);
    return { ok: true };
  });

  // ---- 分析标准库（场景引导第3步引用） ----
  app.get('/library/analysis-standards', async (request) => ({
    items: await store.listAnalysisStandards(request.tenantId),
  }));

  app.post<{ Body: Partial<AnalysisStandard> }>('/library/analysis-standards', async (request, reply) => {
    const body = request.body ?? {};
    if (!body.name?.trim()) return reply.code(400).send({ error: 'name 必填' });
    if (!body.category?.trim()) return reply.code(400).send({ error: 'category 必填' });
    if (!body.description?.trim()) return reply.code(400).send({ error: 'description 必填' });
    const standard: AnalysisStandard = {
      id: body.id ?? randomUUID(),
      tenantId: request.tenantId,
      name: body.name.trim(),
      category: body.category.trim(),
      description: body.description.trim(),
      example: body.example?.trim() || undefined,
    };
    await store.saveAnalysisStandard(standard);
    return reply.code(201).send(standard);
  });

  app.delete<{ Params: { id: string } }>('/library/analysis-standards/:id', async (request, reply) => {
    const items = await store.listAnalysisStandards(request.tenantId);
    if (!items.some((s) => s.id === request.params.id)) {
      return reply.code(404).send({ error: '分析标准不存在' });
    }
    await store.deleteAnalysisStandard(request.params.id);
    return { ok: true };
  });

  // ---- 真实度标准库（场景引导第4步引用） ----
  app.get('/library/realism-standards', async (request) => ({
    items: await store.listRealismStandards(request.tenantId),
  }));

  app.post<{ Body: Partial<RealismStandard> }>('/library/realism-standards', async (request, reply) => {
    const body = request.body ?? {};
    if (!body.name?.trim()) return reply.code(400).send({ error: 'name 必填' });
    if (!body.category?.trim()) return reply.code(400).send({ error: 'category 必填' });
    if (!body.description?.trim()) return reply.code(400).send({ error: 'description 必填' });
    const standard: RealismStandard = {
      id: body.id ?? randomUUID(),
      tenantId: request.tenantId,
      name: body.name.trim(),
      category: body.category.trim(),
      description: body.description.trim(),
    };
    await store.saveRealismStandard(standard);
    return reply.code(201).send(standard);
  });

  app.delete<{ Params: { id: string } }>('/library/realism-standards/:id', async (request, reply) => {
    const items = await store.listRealismStandards(request.tenantId);
    if (!items.some((s) => s.id === request.params.id)) {
      return reply.code(404).send({ error: '真实度标准不存在' });
    }
    await store.deleteRealismStandard(request.params.id);
    return { ok: true };
  });

  // ---- 场景引导资源包 ----
  app.get('/library/scenario-guidance', async (request) => ({
    items: await store.listScenarioGuidances(request.tenantId),
  }));

  app.post<{ Body: Partial<ScenarioGuidance> }>('/library/scenario-guidance', async (request, reply) => {
    const body = request.body ?? {};
    if (!body.scenarioId?.trim()) return reply.code(400).send({ error: 'scenarioId 必填' });
    if (!body.name?.trim()) return reply.code(400).send({ error: 'name 必填' });
    if (!Array.isArray(body.qualifyQuestions) || body.qualifyQuestions.length === 0) {
      return reply.code(400).send({ error: 'qualifyQuestions 至少一题' });
    }
    const guidance = {
      ...body,
      id: body.id ?? randomUUID(),
      tenantId: request.tenantId,
      demo: body.demo ?? null,
      keyPoints: body.keyPoints ?? [],
      analysisStandardIds: body.analysisStandardIds ?? [],
      realismStandardIds: body.realismStandardIds ?? [],
      difficultyLevels: body.difficultyLevels ?? [],
      defaultDifficulty: body.defaultDifficulty ?? 1,
      scoringFocus: body.scoringFocus ?? [],
    } as ScenarioGuidance;
    await store.saveScenarioGuidance(guidance);
    return reply.code(201).send(guidance);
  });

  app.delete<{ Params: { id: string } }>('/library/scenario-guidance/:id', async (request, reply) => {
    const items = await store.listScenarioGuidances(request.tenantId);
    if (!items.some((g) => g.id === request.params.id)) {
      return reply.code(404).send({ error: '场景引导资源不存在' });
    }
    await store.deleteScenarioGuidance(request.params.id);
    return { ok: true };
  });

  // ---- AI 提炼：整段文字 → 结构化行（不落库，前端表格确认后再保存） ----
  app.post<{ Body: { target?: ExtractTarget; text?: string } }>(
    '/library/extract',
    async (request, reply) => {
      const { target, text } = request.body ?? {};
      if (!target || !['scenario', 'question', 'score-item', 'golden-case'].includes(target)) {
        return reply.code(400).send({ error: "target 仅支持 'scenario' | 'question' | 'score-item' | 'golden-case'" });
      }
      if (!text?.trim()) return reply.code(400).send({ error: 'text 必填' });

      const skillPoints = await store.listSkillPoints(request.tenantId);
      const skillPointNames = skillPoints.map((sp) => sp.name);
      const skillPointHint = skillPointNames.length > 0
        ? `可选技能点名称：${skillPointNames.join('、')}`
        : '当前无技能点，相关字段返回空数组';

      const targetPrompts: Record<ExtractTarget, string> = {
        scenario: [
          '把文本提炼为练习场景，rows 每项字段：',
          '- name: 场景名称（不超过30字）',
          '- sceneType: "drill"（实战训练/自由对练）或 "practical"（实用场景/单点考核）',
          '- difficulty: 难度整数 1-3',
          '- durationMinutes: 时长分钟，整数 8-15',
          '- passScore: 及格分 0-100',
          '- personaName: 客户角色姓名（文本中若提及）',
          '- skillPointNames: 考核技能点名称数组',
          '- methodology: 方法论标签（若提及）',
          '- coverageTopics: 需覆盖的话题点数组',
        ].join('\n'),
        question: [
          '把文本提炼为客户提问（高频异议/问答），rows 每项字段：',
          '- category: 分类（如 价格 / 效果 / 竞品 / 服务 / 资质）',
          '- question: 客户提问原文',
          '- referenceAnswer: 参考应答要点',
          '- difficulty: 难度整数 1-3',
          '- frequency: 出现频率百分比数字（若可推断）',
          '- skillPointNames: 应答涉及的技能点名称数组',
        ].join('\n'),
        'score-item': [
          '把文本提炼为评分项定义（行为锚定评分标准），rows 每项字段：',
          '- name: 评分项名称',
          '- skillPointName: 所属技能点名称',
          '- behaviorAnchor: 行为锚定描述',
          '- judgePrompt: 判定 prompt 模板',
          '- weight: 权重数字',
          '- layer: "company" | "team" | "personal"',
          '- isObservation: 是否观察项（记录不计分），布尔',
          '- levels: 档位数组，每项 { key, label, score, description }，score 为数字，按得分从高到低',
        ].join('\n'),
        'golden-case': [
          '把文本提炼为金标准回归测试案例，rows 每项字段：',
          '- name: 案例名称',
          '- transcript: 对话数组，每项 { seq: 轮次序号, speaker: "trainee"|"persona", text: 内容 }',
          '- expected: 期望判定数组，每项 { itemName: 评分项名称, levelKey: 期望档位 key }',
        ].join('\n'),
      };

      const systemPrompt = [
        '你是销售陪练系统的资源库编辑助手。用户会粘贴一段整段文字（培训材料、会议纪要、话术文档等），',
        '你需要把其中可结构化的内容提炼为资源库条目，可能有多条。',
        '',
        targetPrompts[target],
        '',
        skillPointHint,
        '',
        '严格以 JSON 返回，不要输出任何其他文字，格式为：',
        '{"reply":"给用户的一句话中文摘要","rows":[...]}',
        '文本中无法提炼有效条目时 rows 返回空数组 [] 并在 reply 中说明。',
      ].join('\n');

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text.slice(0, 8000) },
      ];

      const provider = gateway.forTask('extractor');
      const result = await provider.chat(messages, { jsonMode: true, temperature: 0.3 });
      const parsed = parseExtractResult(result.content);
      let rows = Array.isArray(parsed.rows) ? parsed.rows : [];

      // 服务端名称 → id 关联解析：技能点 / 陪练角色 / 评分项；解析不到保留名称供前端人工处理
      const skillByName = new Map(skillPoints.map((sp) => [sp.name, sp.id]));
      const resolveSkillIds = (names: unknown): { ids: string[]; unresolved: string[] } => {
        const ids: string[] = [];
        const unresolved: string[] = [];
        for (const n of Array.isArray(names) ? names : []) {
          const id = skillByName.get(String(n));
          if (id) ids.push(id);
          else unresolved.push(String(n));
        }
        return { ids, unresolved };
      };

      if (target === 'scenario') {
        const personas = await store.listPersonaConfigs(request.tenantId);
        const personaByName = new Map(personas.map((p) => [p.name, p.id]));
        rows = rows.map((r) => {
          const { ids, unresolved } = resolveSkillIds(r.skillPointNames);
          const personaName = r.personaName ? String(r.personaName) : undefined;
          const personaConfigId = personaName ? personaByName.get(personaName) : undefined;
          return {
            ...r,
            skillPointIds: ids,
            ...(unresolved.length > 0 ? { unresolvedSkillPoints: unresolved } : {}),
            ...(personaConfigId ? { personaConfigId } : {}),
            ...(personaName && !personaConfigId ? { unresolvedPersona: personaName } : {}),
          };
        });
      } else if (target === 'question') {
        rows = rows.map((r) => {
          const { ids, unresolved } = resolveSkillIds(r.skillPointNames);
          return {
            ...r,
            skillPointIds: ids,
            ...(unresolved.length > 0 ? { unresolvedSkillPoints: unresolved } : {}),
          };
        });
      } else if (target === 'score-item') {
        rows = rows.map((r) => {
          const skillPointName = r.skillPointName ? String(r.skillPointName) : undefined;
          const skillPointId = skillPointName ? skillByName.get(skillPointName) : undefined;
          return {
            ...r,
            ...(skillPointId ? { skillPointId } : {}),
            ...(skillPointName && !skillPointId ? { unresolvedSkillPoint: skillPointName } : {}),
          };
        });
      } else {
        const defs = await store.listScoreItemDefs(request.tenantId);
        const defByName = new Map(defs.map((d) => [d.name, d.id]));
        rows = rows.map((r) => {
          const expected = Array.isArray(r.expected) ? r.expected : [];
          const unresolvedItems: string[] = [];
          const mapped = expected.map((e) => {
            const item = e as { itemName?: unknown; levelKey?: unknown };
            const itemId = item.itemName ? defByName.get(String(item.itemName)) : undefined;
            if (!itemId && item.itemName) unresolvedItems.push(String(item.itemName));
            return { itemId: itemId ?? String(item.itemName ?? ''), levelKey: String(item.levelKey ?? '') };
          });
          return {
            ...r,
            expected: mapped,
            ...(unresolvedItems.length > 0 ? { unresolvedScoreItems: unresolvedItems } : {}),
          };
        });
      }

      return { reply: parsed.reply ?? '提炼完成。', rows };
    }
  );
}
