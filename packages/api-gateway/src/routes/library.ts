import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SCORE_CATEGORIES } from '@grasp-mvp/core';
import type {
  BriefingStandard,
  ChatMessage,
  DemoFaq,
  DemoRole,
  DemoScript,
  DrillScript,
  GoldenCase,
  RealismStandard,
  ScenarioGuidance,
  ScoreItemDef,
  ScoreLevel,
} from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';

type ExtractTarget = 'scenario' | 'demo-faq' | 'score-item' | 'golden-case' | 'briefing-standard' | 'realism-standard';

const EXTRACT_TARGETS: ExtractTarget[] = [
  'scenario',
  'demo-faq',
  'score-item',
  'golden-case',
  'briefing-standard',
  'realism-standard',
];

const SCORE_LAYERS = new Set<ScoreItemDef['layer']>(['company', 'team', 'personal']);

const DEMO_ROLES = new Set<DemoRole>(['sales', 'customer', 'child', 'narrator']);

/** 校验示范剧本请求体；返回错误消息，null 表示通过 */
function validateDemoScriptBody(body: Partial<DemoScript>): string | null {
  if (!body.category?.trim()) return 'category 必填';
  if (!body.name?.trim()) return 'name 必填';
  if (!Array.isArray(body.lines) || body.lines.length === 0) return 'lines 必填且非空';
  for (const [i, line] of body.lines.entries()) {
    if (!line || !DEMO_ROLES.has(line.role)) return `lines[${i}] 的 role 仅支持 'sales' | 'customer' | 'child' | 'narrator'`;
    if (!line.text?.trim()) return `lines[${i}] 的 text 必填`;
  }
  if (body.faqPick !== undefined && (!Number.isInteger(body.faqPick) || body.faqPick < 0)) {
    return 'faqPick 须为非负整数';
  }
  return null;
}

/** 校验评分标准请求体；返回错误消息，null 表示通过 */
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
  if (body.category !== undefined && !SCORE_CATEGORIES.includes(body.category)) {
    return `category 仅支持 ${SCORE_CATEGORIES.map((c) => `'${c}'`).join(' | ')}`;
  }
  return null;
}

/** 校验示范问答请求体；返回错误消息，null 表示通过 */
function validateDemoFaqBody(body: Partial<DemoFaq>): string | null {
  if (!body.category?.trim()) return 'category 必填';
  if (!body.question?.trim()) return 'question 必填';
  if (body.difficulty !== undefined && (!Number.isFinite(body.difficulty) || body.difficulty < 1 || body.difficulty > 3)) {
    return 'difficulty 须为 1-3';
  }
  return null;
}

/** 归一化示范问答：trim 文本、过滤空可选字段 */
function normalizeDemoFaq(body: Partial<DemoFaq>, tenantId: string, id?: string): DemoFaq {
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

  /** 示范问答库 —— 新手指引第2步「示范」的 FAQ 池，renderDemoScript 渲染示范剧本时抽取 */
  app.get<{ Querystring: { category?: string } }>('/library/demo-faqs', async (request) => ({
    faqs: await store.listDemoFaqs(request.tenantId, request.query.category),
  }));

  app.post<{ Body: Partial<DemoFaq> }>('/library/demo-faqs', async (request, reply) => {
    const error = validateDemoFaqBody(request.body ?? {});
    if (error) return reply.code(400).send({ error });
    const q = normalizeDemoFaq(request.body ?? {}, request.tenantId);
    await store.saveDemoFaq(q);
    return reply.code(201).send(q);
  });

  // 批量新建（表格粘贴 / AI 提炼确认后入库）；全量校验，任一不合法整体拒绝
  app.post<{ Body: { items?: Partial<DemoFaq>[] } }>(
    '/library/demo-faqs/batch',
    async (request, reply) => {
      const items = request.body?.items;
      if (!Array.isArray(items) || items.length === 0) {
        return reply.code(400).send({ error: 'items 必填且非空' });
      }
      for (const [i, item] of items.entries()) {
        const error = validateDemoFaqBody(item);
        if (error) return reply.code(400).send({ error: `items[${i}]: ${error}` });
      }
      const saved = items.map((item) => normalizeDemoFaq(item, request.tenantId));
      for (const q of saved) await store.saveDemoFaq(q);
      return reply.code(201).send({ count: saved.length, faqs: saved });
    }
  );

  app.put<{ Params: { id: string }; Body: Partial<DemoFaq> }>(
    '/library/demo-faqs/:id',
    async (request, reply) => {
      const existing = await store.getDemoFaq(request.params.id);
      if (!existing || existing.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '示范问答不存在' });
      }
      const body = request.body ?? {};
      const merged: DemoFaq = {
        ...existing,
        category: body.category?.trim() ?? existing.category,
        question: body.question?.trim() ?? existing.question,
        referenceAnswer: body.referenceAnswer !== undefined ? body.referenceAnswer?.trim() || undefined : existing.referenceAnswer,
        difficulty: body.difficulty !== undefined ? body.difficulty : existing.difficulty,
        skillPointIds: body.skillPointIds !== undefined ? body.skillPointIds : existing.skillPointIds,
        frequency: body.frequency !== undefined ? body.frequency : existing.frequency,
      };
      const error = validateDemoFaqBody(merged);
      if (error) return reply.code(400).send({ error });
      await store.saveDemoFaq(merged);
      return merged;
    }
  );

  app.delete<{ Params: { id: string } }>('/library/demo-faqs/:id', async (request, reply) => {
    const existing = await store.getDemoFaq(request.params.id);
    if (!existing || existing.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '示范问答不存在' });
    }
    await store.deleteDemoFaq(request.params.id);
    return { ok: true };
  });

  /** 示范剧本库 —— 新手指引第2步「示范」的双人对戏剧本，demo 路由按 demoScriptId 引用后交给大模型演绎 */
  app.get<{ Querystring: { category?: string } }>('/library/demo-scripts', async (request) => ({
    items: await store.listDemoScripts(request.tenantId, request.query.category),
  }));

  app.post<{ Body: Partial<DemoScript> }>('/library/demo-scripts', async (request, reply) => {
    const body = request.body ?? {};
    const error = validateDemoScriptBody(body);
    if (error) return reply.code(400).send({ error });
    const script: DemoScript = {
      id: body.id ?? randomUUID(),
      tenantId: request.tenantId,
      category: body.category!.trim(),
      name: body.name!.trim(),
      lines: body.lines!,
      variables: body.variables ?? undefined,
      faqPick: body.faqPick ?? undefined,
      faqPoolRef: body.faqPoolRef?.trim() || undefined,
    };
    await store.saveDemoScript(script);
    return reply.code(201).send(script);
  });

  app.put<{ Params: { id: string }; Body: Partial<DemoScript> }>(
    '/library/demo-scripts/:id',
    async (request, reply) => {
      const existing = await store.getDemoScript(request.params.id);
      if (!existing || existing.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '示范剧本不存在' });
      }
      const body = request.body ?? {};
      const merged: DemoScript = {
        ...existing,
        category: body.category?.trim() ?? existing.category,
        name: body.name?.trim() ?? existing.name,
        lines: body.lines ?? existing.lines,
        variables: body.variables !== undefined ? body.variables : existing.variables,
        faqPick: body.faqPick !== undefined ? body.faqPick : existing.faqPick,
        faqPoolRef: body.faqPoolRef !== undefined ? body.faqPoolRef?.trim() || undefined : existing.faqPoolRef,
      };
      const error = validateDemoScriptBody(merged);
      if (error) return reply.code(400).send({ error });
      await store.saveDemoScript(merged);
      return merged;
    }
  );

  app.delete<{ Params: { id: string } }>('/library/demo-scripts/:id', async (request, reply) => {
    const existing = await store.getDemoScript(request.params.id);
    if (!existing || existing.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '示范剧本不存在' });
    }
    await store.deleteDemoScript(request.params.id);
    return { ok: true };
  });

  /** 演练剧本库 —— 模拟演练的剧情参照（整篇文本），演练开始交给 LLM 理解，决定谁先开口、如何回应、何时结束 */
  app.get<{ Querystring: { category?: string } }>('/library/drill-scripts', async (request) => ({
    items: await store.listDrillScripts(request.tenantId, request.query.category?.trim() || undefined),
  }));

  app.post<{ Body: Partial<DrillScript> }>('/library/drill-scripts', async (request, reply) => {
    const body = request.body ?? {};
    if (!body.name?.trim()) return reply.code(400).send({ error: 'name 必填' });
    if (!body.content?.trim()) return reply.code(400).send({ error: 'content 必填' });
    if (!body.category || !SCORE_CATEGORIES.includes(body.category)) {
      return reply.code(400).send({ error: `category 仅支持 ${SCORE_CATEGORIES.map((c) => `'${c}'`).join(' | ')}` });
    }
    const script: DrillScript = {
      id: body.id ?? randomUUID(),
      tenantId: request.tenantId,
      category: body.category,
      name: body.name.trim(),
      content: body.content,
    };
    await store.saveDrillScript(script);
    return reply.code(201).send(script);
  });

  app.put<{ Params: { id: string }; Body: Partial<DrillScript> }>(
    '/library/drill-scripts/:id',
    async (request, reply) => {
      const existing = await store.getDrillScript(request.params.id);
      if (!existing || existing.tenantId !== request.tenantId) {
        return reply.code(404).send({ error: '演练剧本不存在' });
      }
      const body = request.body ?? {};
      const merged: DrillScript = {
        ...existing,
        name: body.name?.trim() ?? existing.name,
        category: body.category ?? existing.category,
        content: body.content ?? existing.content,
      };
      if (!merged.name || !merged.content.trim()) return reply.code(400).send({ error: 'name / content 必填' });
      if (!SCORE_CATEGORIES.includes(merged.category)) {
        return reply.code(400).send({ error: `category 仅支持 ${SCORE_CATEGORIES.map((c) => `'${c}'`).join(' | ')}` });
      }
      await store.saveDrillScript(merged);
      return merged;
    }
  );

  app.delete<{ Params: { id: string } }>('/library/drill-scripts/:id', async (request, reply) => {
    const existing = await store.getDrillScript(request.params.id);
    if (!existing || existing.tenantId !== request.tenantId) {
      return reply.code(404).send({ error: '演练剧本不存在' });
    }
    await store.deleteDrillScript(request.params.id);
    return { ok: true };
  });

  /** 评分标准库 —— 第5步「评分」逐项评分依据；按评分分类（地推/电销/咨询接待/现场成交）分库维护 */
  app.get<{ Querystring: { skillPointId?: string; category?: string } }>('/library/score-items', async (request) => {
    const items = await store.listScoreItemDefs(request.tenantId, request.query.skillPointId);
    const category = request.query.category?.trim();
    return { items: category ? items.filter((d) => d.category === category) : items };
  });

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
      category: body.category,
    };
    await store.upsertScoreItemDef(def);
    return reply.code(201).send(def);
  });

  app.put<{ Params: { id: string }; Body: Partial<ScoreItemDef> }>(
    '/library/score-items/:id',
    async (request, reply) => {
      const defs = await store.listScoreItemDefs(request.tenantId);
      const existing = defs.find((d) => d.id === request.params.id);
      if (!existing) return reply.code(404).send({ error: '评分标准不存在' });
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
        category: body.category ?? existing.category,
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
      return reply.code(404).send({ error: '评分标准不存在' });
    }
    await store.deleteScoreItemDef(request.params.id);
    return { ok: true };
  });

  /** 评分回归案例库 —— 评分引擎回归测试用，不参与实时执行 */
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
      if (!existing) return reply.code(404).send({ error: '评分回归案例不存在' });
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
      return reply.code(404).send({ error: '评分回归案例不存在' });
    }
    await store.deleteGoldenCase(request.params.id);
    return { ok: true };
  });

  /** 讲解标准库 —— 第3步「讲解」口播稿引用（composeBriefing） */
  app.get('/library/briefing-standards', async (request) => ({
    items: await store.listBriefingStandards(request.tenantId),
  }));

  app.post<{ Body: Partial<BriefingStandard> }>('/library/briefing-standards', async (request, reply) => {
    const body = request.body ?? {};
    if (!body.name?.trim()) return reply.code(400).send({ error: 'name 必填' });
    if (!body.category?.trim()) return reply.code(400).send({ error: 'category 必填' });
    if (!body.description?.trim()) return reply.code(400).send({ error: 'description 必填' });
    const standard: BriefingStandard = {
      id: body.id ?? randomUUID(),
      tenantId: request.tenantId,
      name: body.name.trim(),
      category: body.category.trim(),
      description: body.description.trim(),
      example: body.example?.trim() || undefined,
    };
    await store.saveBriefingStandard(standard);
    return reply.code(201).send(standard);
  });

  app.delete<{ Params: { id: string } }>('/library/briefing-standards/:id', async (request, reply) => {
    const items = await store.listBriefingStandards(request.tenantId);
    if (!items.some((s) => s.id === request.params.id)) {
      return reply.code(404).send({ error: '讲解标准不存在' });
    }
    await store.deleteBriefingStandard(request.params.id);
    return { ok: true };
  });

  /** 演练真实度标准库 —— 第4步「演练」AI 客户逼真度要求，runTurn 装配时注入 */
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
      return reply.code(404).send({ error: '演练真实度标准不存在' });
    }
    await store.deleteRealismStandard(request.params.id);
    return { ok: true };
  });

  /** 新手指引流程配置 —— 五步流程（资格提问→示范→讲解→演练→评分）的场景级总配置 */
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
      demoScriptId: body.demoScriptId ?? null,
      keyPoints: body.keyPoints ?? [],
      briefingStandardIds: body.briefingStandardIds ?? [],
      realismStandardIds: body.realismStandardIds ?? [],
      difficultyLevels: body.difficultyLevels ?? [],
      defaultDifficulty: body.defaultDifficulty ?? 1,
      scoringFocus: body.scoringFocus ?? [],
    } as ScenarioGuidance;
    // 每场景只允许一条指引配置（getScenarioGuidance 按 scenarioId 单条取值）
    const existing = await store.getScenarioGuidance(guidance.scenarioId);
    if (existing && existing.id !== guidance.id) {
      return reply.code(409).send({ error: '该场景已有指引配置，请编辑现有记录', existingId: existing.id });
    }
    await store.saveScenarioGuidance(guidance);
    return reply.code(201).send(guidance);
  });

  app.delete<{ Params: { id: string } }>('/library/scenario-guidance/:id', async (request, reply) => {
    const items = await store.listScenarioGuidances(request.tenantId);
    if (!items.some((g) => g.id === request.params.id)) {
      return reply.code(404).send({ error: '新手指引流程配置不存在' });
    }
    await store.deleteScenarioGuidance(request.params.id);
    return { ok: true };
  });

  // ---- AI 提炼：整段文字 → 结构化行（不落库，前端表格确认后再保存） ----
  app.post<{ Body: { target?: ExtractTarget; text?: string } }>(
    '/library/extract',
    async (request, reply) => {
      const { target, text } = request.body ?? {};
      if (!target || !EXTRACT_TARGETS.includes(target)) {
        return reply.code(400).send({ error: `target 仅支持 ${EXTRACT_TARGETS.map((t) => `'${t}'`).join(' | ')}` });
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
        'demo-faq': [
          '把文本提炼为示范问答（新手指引第2步「示范」剧本中客户抛出的高频异议/问答），rows 每项字段：',
          '- category: 分类（如 价格 / 效果 / 竞品 / 服务 / 资质）',
          '- question: 客户提问原文',
          '- referenceAnswer: 参考应答要点',
          '- difficulty: 难度整数 1-3',
          '- frequency: 出现频率百分比数字（若可推断）',
          '- skillPointNames: 应答涉及的技能点名称数组',
        ].join('\n'),
        'score-item': [
          '把文本提炼为评分标准定义（行为锚定），rows 每项字段：',
          '- name: 评分标准名称',
          '- skillPointName: 所属技能点名称',
          '- category: 评分分类，"地推" | "电销" | "咨询接待" | "现场成交"（文本未明确时省略）',
          '- behaviorAnchor: 行为锚定描述',
          '- judgePrompt: 判定 prompt 模板',
          '- weight: 权重数字',
          '- layer: "company" | "team" | "personal"',
          '- isObservation: 是否观察项（记录不计分），布尔',
          '- levels: 档位数组，每项 { key, label, score, description }，score 为数字，按得分从高到低',
        ].join('\n'),
        'golden-case': [
          '把文本提炼为评分回归测试案例，rows 每项字段：',
          '- name: 案例名称',
          '- transcript: 对话数组，每项 { seq: 轮次序号, speaker: "trainee"|"persona", text: 内容 }',
          '- expected: 期望判定数组，每项 { itemName: 评分标准名称, levelKey: 期望档位 key }',
        ].join('\n'),
        'briefing-standard': [
          '把文本提炼为讲解标准（新手指引第3步「讲解」口播稿引用的标准），rows 每项字段：',
          '- name: 标准名称（如 语调标准 / 语速标准 / 关键方法 / 礼仪标准）',
          '- category: "tone"（语调）| "pace"（语速）| "method"（关键方法）| "etiquette"（礼仪）',
          '- description: 标准的具体说明',
          '- example: 示例（若有）',
        ].join('\n'),
        'realism-standard': [
          '把文本提炼为 AI 客户的演练真实度标准（第4步模拟演练的逼真度要求），rows 每项字段：',
          '- name: 标准名称（如 反应自然度 / 拒绝行为 / 拖延行为 / 情绪变化）',
          '- category: "reaction"（反应自然度）| "objection"（拒绝行为）| "stalling"（拖延行为）| "emotion"（情绪变化）',
          '- description: 标准的具体说明',
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

      // 服务端名称 → id 关联解析：技能点 / 陪练角色 / 评分标准；解析不到保留名称供前端人工处理
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
      } else if (target === 'demo-faq') {
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
