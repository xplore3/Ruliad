import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  ExtractionProject,
  GoldenCase,
  ProductKB,
  ProductKBEntry,
  QuizQuestion,
  QuizType,
  QuizTrigger,
  RegressionRun,
  ScoreItemDef,
  Session,
} from '@grasp-mvp/core';
import { scoreSession } from '@grasp-mvp/scoring-engine';
import type { RouteContext } from '../ctx.js';

/** 萃取项目阶段机：素材收集 → 差异分析 → 要素编码 → 试打校验 → 完成 */
const STAGE_ORDER: ExtractionProject['status'][] = [
  'collecting',
  'analyzing',
  'encoding',
  'validating',
  'done',
];

const GATE_THRESHOLD = 0.8;

const KB_KINDS = new Set<ProductKBEntry['kind']>(['keypoint', 'redline', 'competitor', 'faq']);

/** 校验 KB 条目数组；返回错误消息，null 表示通过 */
function validateKBEntries(entries: Partial<ProductKBEntry>[]): string | null {
  for (const [i, e] of entries.entries()) {
    if (!e?.kind || !KB_KINDS.has(e.kind)) {
      return `entries[${i}].kind 须为 keypoint / redline / competitor / faq`;
    }
    if (!e.title?.trim() || !e.content?.trim()) {
      return `entries[${i}] 的 title / content 必填`;
    }
  }
  return null;
}

/** 条目归一化：补 id、trim 文本 */
function normalizeKBEntry(e: Partial<ProductKBEntry>): ProductKBEntry {
  return {
    id: e.id ?? randomUUID(),
    kind: e.kind!,
    title: e.title!.trim(),
    content: e.content!.trim(),
    ...(e.frequency !== undefined ? { frequency: e.frequency } : {}),
  };
}

export async function workshopRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway } = ctx;

  // ---- 产品知识库（每租户一份） ----
  app.get('/workshop/product-kb', async (request) => ({
    kb: (await store.getProductKB(request.tenantId)) ?? null,
  }));

  // 整体创建/替换（版本自增）
  app.put<{ Body: { name?: string; entries?: Partial<ProductKBEntry>[] } }>(
    '/workshop/product-kb',
    async (request, reply) => {
      const { name, entries } = request.body ?? {};
      if (!name?.trim()) return reply.code(400).send({ error: 'name 必填' });
      if (!Array.isArray(entries)) return reply.code(400).send({ error: 'entries 必须为数组' });
      const error = validateKBEntries(entries);
      if (error) return reply.code(400).send({ error });

      const existing = await store.getProductKB(request.tenantId);
      const kb: ProductKB = {
        id: existing?.id ?? randomUUID(),
        tenantId: request.tenantId,
        name: name.trim(),
        version: (existing?.version ?? 0) + 1,
        entries: entries.map(normalizeKBEntry),
        effectiveAt: new Date().toISOString(),
      };
      await store.saveProductKB(kb);
      return kb;
    }
  );

  // 批量导入条目：带 id 覆盖同 id 条目，无 id 追加（版本自增）
  app.post<{ Body: { entries?: Partial<ProductKBEntry>[] } }>(
    '/workshop/product-kb/entries',
    async (request, reply) => {
      const entries = request.body?.entries;
      if (!Array.isArray(entries) || entries.length === 0) {
        return reply.code(400).send({ error: 'entries 必填且非空' });
      }
      const error = validateKBEntries(entries);
      if (error) return reply.code(400).send({ error });

      const existing = await store.getProductKB(request.tenantId);
      if (!existing) {
        return reply.code(409).send({ error: '知识库不存在，请先 PUT /workshop/product-kb 创建' });
      }
      const byId = new Map(existing.entries.map((e) => [e.id, e]));
      let added = 0;
      let updated = 0;
      for (const e of entries) {
        const normalized = normalizeKBEntry(e);
        if (byId.has(normalized.id)) updated += 1;
        else added += 1;
        byId.set(normalized.id, normalized);
      }
      const kb: ProductKB = {
        ...existing,
        version: existing.version + 1,
        entries: [...byId.values()],
        effectiveAt: new Date().toISOString(),
      };
      await store.saveProductKB(kb);
      return reply.code(201).send({ added, updated, total: kb.entries.length, version: kb.version });
    }
  );

  // ---- 考题 ----
  app.get<{ Querystring: { scenarioId?: string } }>('/workshop/quiz-questions', async (request) => ({
    questions: await store.listQuizQuestions(request.tenantId, request.query.scenarioId),
  }));

  app.post<{ Body: Partial<QuizQuestion> }>('/workshop/quiz-questions', async (request, reply) => {
    const body = request.body ?? {};
    if (!body.prompt?.trim()) return reply.code(400).send({ error: 'prompt 必填' });
    if (!body.type) return reply.code(400).send({ error: 'type 必填' });
    const validTypes: QuizType[] = ['single_choice', 'multi_choice', 'true_false', 'short_answer', 'scenario_pick'];
    if (!validTypes.includes(body.type)) return reply.code(400).send({ error: 'type 无效' });
    const q: QuizQuestion = {
      id: body.id ?? randomUUID(),
      tenantId: request.tenantId,
      scenarioId: body.scenarioId || undefined,
      skillPointId: body.skillPointId || undefined,
      productKBEntryId: body.productKBEntryId || undefined,
      type: body.type,
      prompt: body.prompt.trim(),
      options: body.options ?? [],
      correctAnswer: body.correctAnswer ?? [],
      referencePoints: body.referencePoints ?? [],
      explanation: body.explanation?.trim() ?? '',
      score: body.score ?? 10,
      trigger: (body.trigger as QuizTrigger) ?? { kind: 'manual' },
      required: body.required ?? false,
    };
    await store.saveQuizQuestion(q);
    return reply.code(201).send(q);
  });

  app.put<{ Params: { id: string }; Body: Partial<QuizQuestion> }>(
    '/workshop/quiz-questions/:id',
    async (request, reply) => {
      const questions = await store.listQuizQuestions(request.tenantId);
      const existing = questions.find((q) => q.id === request.params.id);
      if (!existing) return reply.code(404).send({ error: '考题不存在' });
      const body = request.body ?? {};
      const updated: QuizQuestion = {
        ...existing,
        scenarioId: body.scenarioId !== undefined ? (body.scenarioId || undefined) : existing.scenarioId,
        skillPointId: body.skillPointId !== undefined ? (body.skillPointId || undefined) : existing.skillPointId,
        productKBEntryId: body.productKBEntryId !== undefined ? (body.productKBEntryId || undefined) : existing.productKBEntryId,
        type: body.type ?? existing.type,
        prompt: body.prompt?.trim() ?? existing.prompt,
        options: body.options ?? existing.options,
        correctAnswer: body.correctAnswer ?? existing.correctAnswer,
        referencePoints: body.referencePoints ?? existing.referencePoints,
        explanation: body.explanation?.trim() ?? existing.explanation,
        score: body.score ?? existing.score,
        trigger: (body.trigger as QuizTrigger) ?? existing.trigger,
        required: body.required ?? existing.required,
      };
      await store.saveQuizQuestion(updated);
      return updated;
    }
  );

  app.delete<{ Params: { id: string } }>('/workshop/quiz-questions/:id', async (request, reply) => {
    await store.deleteQuizQuestion(request.params.id);
    return reply.code(204).send();
  });

  // ---- 销冠萃取项目 ----
  app.get('/workshop/extraction-projects', async (request) => ({
    projects: await store.listExtractionProjects(request.tenantId),
  }));

  app.post<{
    Body: { name: string; recordingRefs?: string[] };
  }>('/workshop/extraction-projects', async (request, reply) => {
    const { name, recordingRefs } = request.body ?? {};
    if (!name) return reply.code(400).send({ error: 'name 必填' });
    const project: ExtractionProject = {
      id: randomUUID(),
      tenantId: request.tenantId,
      name,
      recordingRefs: recordingRefs ?? [],
      diffFindings: [],
      interviewNotes: [],
      status: 'collecting',
      createdAt: new Date().toISOString(),
    };
    await store.upsertExtractionProject(project);
    return reply.code(201).send(project);
  });

  // 推进一个阶段；进入「要素编码」时用 extractor 生成要素草稿写回项目
  app.post<{ Params: { id: string } }>(
    '/workshop/extraction-projects/:id/advance',
    async (request, reply) => {
      const projects = await store.listExtractionProjects(request.tenantId);
      const project = projects.find((p) => p.id === request.params.id);
      if (!project) return reply.code(404).send({ error: '萃取项目不存在' });
      const idx = STAGE_ORDER.indexOf(project.status);
      if (idx < 0 || idx >= STAGE_ORDER.length - 1) {
        return reply.code(409).send({ error: '项目已完成，无法继续推进' });
      }
      const nextStatus = STAGE_ORDER[idx + 1];
      const updated: ExtractionProject = { ...project, status: nextStatus };

      if (nextStatus === 'encoding') {
        const result = await gateway.forTask('extractor').chat([
          {
            role: 'user',
            content: `你是销冠经验萃取专家。基于项目「${project.name}」的录音（${project.recordingRefs.join('、') || '无'}），输出可编码为评分要素的话术要点草稿（3-5 条，每条一行）。`,
          },
        ]);
        updated.interviewNotes = [
          ...project.interviewNotes,
          `【AI 要素草稿】${result.content}`,
        ];
      }

      await store.upsertExtractionProject(updated);
      return updated;
    }
  );

  // ---- 评分项定义 ----
  app.get<{ Querystring: { skillPointId?: string } }>('/workshop/score-items', async (request) => ({
    items: await store.listScoreItemDefs(request.tenantId, request.query.skillPointId),
  }));

  app.post<{ Body: ScoreItemDef }>('/workshop/score-items', async (request, reply) => {
    const def = request.body;
    if (!def?.id || !def.skillPointId || !def.name || !def.levels?.length) {
      return reply.code(400).send({ error: 'id / skillPointId / name / levels 必填' });
    }
    await store.upsertScoreItemDef({ ...def, tenantId: def.tenantId ?? request.tenantId });
    return reply.code(201).send(def);
  });

  // ---- 金标准案例 ----
  app.get('/workshop/golden-cases', async () => ({
    cases: await store.listGoldenCases(),
  }));

  app.post<{ Body: GoldenCase }>('/workshop/golden-cases', async (request, reply) => {
    const body = request.body;
    if (!body?.name || !body.transcript?.length || !body.expected?.length) {
      return reply.code(400).send({ error: 'name / transcript / expected 必填' });
    }
    const goldenCase: GoldenCase = { ...body, id: body.id ?? randomUUID() };
    await store.saveGoldenCase(goldenCase);
    return reply.code(201).send(goldenCase);
  });

  // ---- 回归测试 ----
  app.post<{ Body: { scenarioId?: string } }>(
    '/workshop/regression-runs/run',
    async (request, reply) => {
      const scenarioId = request.body?.scenarioId ?? 'scenario-first-visit';
      const scenario = await store.getScenario(scenarioId);
      if (!scenario) return reply.code(404).send({ error: '场景不存在' });
      const defs = await store.listScoreItemDefs(scenario.tenantId);
      const cases = await store.listGoldenCases();

      const details: RegressionRun['details'] = [];
      for (const c of cases) {
        const now = new Date().toISOString();
        const session: Session = {
          id: randomUUID(),
          tenantId: scenario.tenantId,
          userId: 'regression-bot',
          scenarioId: scenario.id,
          mode: 'practice',
          status: 'completed',
          transcript: c.transcript.map((t) => ({ ...t, at: now })),
          emotionTrace: [],
          hintsUsed: 0,
          startedAt: now,
          endedAt: now,
        };
        const report = await scoreSession(session, scenario, defs, gateway);
        for (const exp of c.expected) {
          const item = report.items.find((i) => i.itemId === exp.itemId);
          details.push({
            caseId: c.id,
            itemId: exp.itemId,
            expected: exp.levelKey,
            actual: item?.levelKey ?? 'missing',
            match: item?.levelKey === exp.levelKey,
          });
        }
      }

      const matched = details.filter((d) => d.match).length;
      const passRate = details.length > 0 ? matched / details.length : 0;
      const run: RegressionRun = {
        id: randomUUID(),
        at: new Date().toISOString(),
        totalCases: cases.length,
        matched,
        errorRate: details.length > 0 ? 1 - passRate : 0,
        passed: passRate >= GATE_THRESHOLD,
        details,
      };
      await store.saveRegressionRun(run);
      return { run, gatePassed: run.passed };
    }
  );

  app.get('/workshop/regression-runs', async () => ({
    runs: await store.listRegressionRuns(),
  }));

  // ---- 观察项聚合：供校准会议裁决 ----
  app.get('/workshop/observations', async (request) => {
    const sessions = await store.listSessions({ tenantId: request.tenantId });
    const byItem = new Map<
      string,
      { itemId: string; itemName: string; scores: number[]; passFlags: boolean[] }
    >();
    for (const s of sessions) {
      if (s.status !== 'completed') continue;
      const report = await store.getScoreReportBySession(s.id);
      if (!report) continue;
      for (const item of report.items) {
        if (!item.isObservation) continue;
        const entry = byItem.get(item.itemId) ?? {
          itemId: item.itemId,
          itemName: item.itemName,
          scores: [],
          passFlags: [],
        };
        entry.scores.push(item.score);
        entry.passFlags.push(report.passed);
        byItem.set(item.itemId, entry);
      }
    }
    const observations = [...byItem.values()].map((e) => ({
      itemId: e.itemId,
      itemName: e.itemName,
      occurrences: e.scores.length,
      avgScoreWhenPresent: Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length),
      overallPassRate: e.passFlags.filter(Boolean).length / e.passFlags.length,
      note: '观察项不计分，供校准会议裁决',
    }));
    return { observations };
  });
}
