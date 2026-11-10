import type {
  LLMGateway,
  QuantitativeRule,
  Scenario,
  ScoreItemDef,
  ScoreLevel,
  ScoreReport,
  Session,
  VoiceConfigDiagnosis,
} from '@grasp-mvp/core';
import { analyzeReceptionFluency } from '@grasp-mvp/scoring-engine';
import type { Store } from '@grasp-mvp/infra';

export class VoiceConfigAnalysisError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export interface PreparedVoiceConfigAnalysis {
  current: ScoreItemDef;
  scenario: Scenario;
  patch: Record<string, unknown>;
  needsBinding: boolean;
  diagnosis: VoiceConfigDiagnosis;
}

interface AnalysisResponse {
  scoreItemId?: string;
  summary?: string;
  reasons?: unknown;
  evidence?: unknown;
  behaviorAnchorAddition?: unknown;
  judgePromptAddition?: unknown;
  levelAdditions?: unknown;
  quantitativeRule?: unknown;
}

const QUANT_METRICS = new Set([
  'pitchVarSemitones', 'loudnessRangeDb', 'speechRateCpm', 'avgLoudnessDbfs', 'medianF0Hz',
  'f0LiftSemitones', 'loudnessLiftDb', 'fluencyScore',
]);

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

function matchesName(name: string, query: string): boolean {
  const n = normalize(name);
  const q = normalize(query);
  return !!n && !!q && (n === q || n.includes(q) || q.includes(n));
}

function clip(value: unknown, max = 1000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function stringList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, limit).map((item) => item.trim());
}

function parseResponse(content: string): AnalysisResponse {
  try {
    return JSON.parse(content) as AnalysisResponse;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as AnalysisResponse; } catch { /* 落到统一错误 */ }
    }
    throw new VoiceConfigAnalysisError(422, '评分诊断结果格式无效，请重试');
  }
}

async function latestSession(args: {
  store: Store;
  tenantId: string;
  userId: string;
  admin: boolean;
  category?: string;
  scenarioName?: string;
}): Promise<{ session: Session; scenario: Scenario }> {
  const sessions = await args.store.listSessions(args.admin ? { tenantId: args.tenantId } : { tenantId: args.tenantId, userId: args.userId });
  const candidates: Array<{ session: Session; scenario: Scenario }> = [];
  for (const session of sessions) {
    if (session.status !== 'completed') continue;
    const scenario = await args.store.getScenario(session.scenarioId);
    if (scenario?.tenantId !== args.tenantId) continue;
    if (args.category && scenario.category !== args.category) continue;
    if (args.scenarioName && !matchesName(scenario.name, args.scenarioName)) continue;
    candidates.push({ session, scenario });
  }
  candidates.sort((a, b) =>
    (b.session.endedAt ?? b.session.startedAt).localeCompare(a.session.endedAt ?? a.session.startedAt)
  );
  const latest = candidates[0];
  if (!latest) {
    const target = args.scenarioName ? `场景“${args.scenarioName}”` : `${args.category ?? ''}演练`;
    throw new VoiceConfigAnalysisError(404, `未找到已完成的${target}，无法确定要诊断的历史记录`);
  }
  return latest;
}

function compactReport(report: ScoreReport) {
  return {
    totalScore: report.totalScore,
    baseScore: report.baseScore,
    confidenceIndex: report.confidenceIndex,
    passed: report.passed,
    completionStatus: report.completionStatus,
    completionReason: report.completionReason,
    items: report.items.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      score: item.score,
      levelLabel: item.levelLabel,
      quote: clip(item.quote, 240),
      rationale: clip(item.rationale, 800),
      betterScript: clip(item.betterScript, 240),
      improvementCandidates: item.improvementCandidates,
    })),
    violations: report.violations,
    ruleStats: report.ruleStats,
    summary: clip(report.summary, 800),
    improvementGoal: report.improvementGoal,
  };
}

function compactTranscript(session: Session): string {
  const lines = session.transcript.map((turn) => `[${turn.seq}] ${turn.speaker}：${clip(turn.text, 500)}`);
  const selected: string[] = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (size + lines[index].length > 16_000 && selected.length) break;
    selected.unshift(lines[index]);
    size += lines[index].length;
    if (selected.length >= 80) break;
  }
  return selected.join('\n');
}

function compactCandidate(item: ScoreItemDef) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    skillPointId: item.skillPointId,
    scoringMode: item.scoringMode ?? 'levels',
    deductionOnly: item.deductionOnly,
    behaviorAnchor: clip(item.behaviorAnchor, 5000),
    judgePrompt: clip(item.judgePrompt, 5000),
    levels: item.levels,
    quantitativeRule: item.quantitativeRule,
  };
}

function appendClause(existing: string, addition: string): string {
  if (!addition || existing.includes(addition)) return existing;
  return [existing.trim(), addition].filter(Boolean).join('\n');
}

function appendLevels(current: ScoreLevel[], value: unknown): ScoreLevel[] {
  if (value === undefined) return current;
  if (!Array.isArray(value)) throw new VoiceConfigAnalysisError(422, '新增评分档位格式无效');
  const existingKeys = new Set(current.map((level) => level.key));
  const additions = value.map((raw) => {
    const level = raw as Partial<ScoreLevel>;
    if (!clip(level.key, 80) || existingKeys.has(String(level.key))) {
      throw new VoiceConfigAnalysisError(422, '新增评分档位缺少唯一 key');
    }
    if (!clip(level.label, 120) || typeof level.score !== 'number' || !Number.isFinite(level.score) || level.score < 0 || level.score > 100) {
      throw new VoiceConfigAnalysisError(422, '新增评分档位的名称或分值无效');
    }
    existingKeys.add(String(level.key));
    return { key: String(level.key), label: String(level.label), score: level.score, description: clip(level.description, 2000) };
  });
  return [...current, ...additions];
}

function validateQuantitativeRule(current: QuantitativeRule, value: unknown): QuantitativeRule {
  const next = value as QuantitativeRule;
  if (!next || !Array.isArray(next.blocks) || !next.blocks.length || next.blocks.length > 30) {
    throw new VoiceConfigAnalysisError(422, '定量评分标准必须返回完整的 quantitativeRule');
  }
  let totalScore = 0;
  for (const block of next.blocks) {
    if (!clip(block?.label, 120) || typeof block.maxScore !== 'number' || !Number.isFinite(block.maxScore) || block.maxScore < 0 || block.maxScore > 100 || !Array.isArray(block.metrics) || !block.metrics.length) {
      throw new VoiceConfigAnalysisError(422, '定量规则的计分块或分值无效');
    }
    totalScore += block.maxScore;
    for (const metric of block.metrics) {
      if (!QUANT_METRICS.has(metric.metric) || (!metric.bands?.length && !metric.points?.length)) {
        throw new VoiceConfigAnalysisError(422, `定量规则包含无效指标：${String(metric.metric)}`);
      }
      for (const band of metric.bands ?? []) {
        if (typeof band.score !== 'number' || band.score < 0 || band.score > 100 || (band.min !== undefined && typeof band.min !== 'number') || (band.max !== undefined && typeof band.max !== 'number')) {
          throw new VoiceConfigAnalysisError(422, '定量规则的计分区间无效');
        }
      }
      for (const point of metric.points ?? []) {
        if (typeof point.value !== 'number' || !Number.isFinite(point.value) || typeof point.score !== 'number' || point.score < 0 || point.score > 100) {
          throw new VoiceConfigAnalysisError(422, '定量规则的计分锚点无效');
        }
      }
    }
  }
  if (totalScore > 100) throw new VoiceConfigAnalysisError(422, '定量规则各计分块总分不能超过 100');
  for (const oldBlock of current.blocks) {
    const nextBlock = next.blocks.find((block) => block.label === oldBlock.label);
    if (!nextBlock) throw new VoiceConfigAnalysisError(422, `定量规则不能删除原计分块“${oldBlock.label}”`);
    for (const oldMetric of oldBlock.metrics) {
      if (!nextBlock.metrics.some((metric) => metric.metric === oldMetric.metric)) {
        throw new VoiceConfigAnalysisError(422, `定量规则不能删除原指标“${oldMetric.metric}”`);
      }
    }
  }
  return next;
}

function isFluencyAspect(aspect: string): boolean {
  return /fluency|磕磕绊绊|磕绊|不流畅|填充词|口头禅|重复断句/i.test(aspect);
}

export async function prepareScoreItemAnalysis(args: {
  store: Store;
  gateway: LLMGateway;
  tenantId: string;
  userId: string;
  admin: boolean;
  subject: string;
  question: string;
  category?: string;
  scenarioName?: string;
  aspect: string;
}): Promise<PreparedVoiceConfigAnalysis> {
  const { store, tenantId } = args;
  const { session, scenario } = await latestSession(args);
  const report = await store.getScoreReportBySession(session.id);
  if (!report) throw new VoiceConfigAnalysisError(422, `最近一次演练“${scenario.name}”没有评分报告，无法诊断评分原因`);

  const all = await store.listScoreItemDefs(tenantId);
  const effective = scenario.scoreItemIds !== undefined
    ? all.filter((item) => scenario.scoreItemIds!.includes(item.id))
    : all.filter((item) => !item.category || item.category === scenario.category);
  const candidates = all.filter((item) => !item.category || !scenario.category || item.category === scenario.category);
  if (!candidates.length) throw new VoiceConfigAnalysisError(404, '没有找到与该场景分类兼容的评分标准');

  const named = candidates.find((item) => normalize(item.name) === normalize(args.subject))
    ?? candidates.find((item) => matchesName(item.name, args.subject));
  const prompt = [
    '你是销售陪练系统的评分配置诊断助手。用户要求根据一次历史演练，分析某个评分维度未被参考的原因，并修改现有评分标准。',
    '只能依据提供的评分报告、对话转写、规则统计和候选标准作答，不得编造历史事实。历史报告没有配置快照时，要明确这一限制。',
    '从候选标准中选择最合适的一项：优先用户明确点名的标准，其次与目标维度语义最相关且适合该场景的标准。scoreItemId 必须原样取自候选列表。',
    'behaviorAnchorAddition 和 judgePromptAddition 只写需要追加的片段，不要重复或改写原文；追加内容必须明确目标维度、判定证据和计分口径。',
    '如需新增档位，用 levelAdditions 返回完整新档位；已有档位不要返回。',
    '若选中的标准已有 quantitativeRule，必须返回完整且有效的 quantitativeRule，保留原计分块和原指标，可调整分值并加入新指标；否则只改文案不会改变定量得分。',
    '若该标准已有固定系统规则，追加说明要避免 LLM 与固定规则重复扣分。',
    '严格返回 JSON：{"scoreItemId":"...","summary":"一句话诊断","reasons":["..."],"evidence":["..."],"behaviorAnchorAddition":"...","judgePromptAddition":"...","levelAdditions":[],"quantitativeRule":null}',
    `【目标评分维度】${args.aspect}`,
    `【历史场景】${scenario.name}；分类=${scenario.category ?? '未设置'}；当前绑定评分标准ID=${JSON.stringify(scenario.scoreItemIds ?? '按分类默认')}`,
    `【评分报告】${JSON.stringify(compactReport(report))}`,
    `【对话转写】\n${compactTranscript(session)}`,
    `【候选评分标准】${JSON.stringify(candidates.map(compactCandidate))}`,
    named ? `【用户名称匹配参考】${named.id}（仍需根据完整证据判断是否合适）` : '',
  ].join('\n');
  const result = await args.gateway.forTask('extractor').chat([
    { role: 'system', content: prompt },
    { role: 'user', content: args.question.slice(0, 6000) },
  ], { jsonMode: true, temperature: 0.2 });
  const response = parseResponse(result.content);
  const selectedId = clip(response.scoreItemId, 200);
  const current = candidates.find((item) => item.id === selectedId) ?? named;
  if (!current) throw new VoiceConfigAnalysisError(422, '未能从候选评分标准中确定修改对象，请明确评分标准名称后重试');
  if (selectedId && current.id !== selectedId) throw new VoiceConfigAnalysisError(422, '诊断返回了候选范围之外的评分标准，请重试');

  const behaviorAnchorAddition = clip(response.behaviorAnchorAddition, 4000);
  const judgePromptAddition = clip(response.judgePromptAddition, 4000);
  const patch: Record<string, unknown> = {};
  const behaviorAnchor = appendClause(current.behaviorAnchor, behaviorAnchorAddition);
  const judgePrompt = appendClause(current.judgePrompt, judgePromptAddition);
  if (behaviorAnchor !== current.behaviorAnchor) patch.behaviorAnchor = behaviorAnchor;
  if (judgePrompt !== current.judgePrompt) patch.judgePrompt = judgePrompt;
  const levels = appendLevels(current.levels, response.levelAdditions);
  if (levels !== current.levels) patch.levels = levels;
  if (current.quantitativeRule) {
    const quantitativeRule = validateQuantitativeRule(current.quantitativeRule, response.quantitativeRule);
    if (JSON.stringify(quantitativeRule) !== JSON.stringify(current.quantitativeRule)) patch.quantitativeRule = quantitativeRule;
  } else if (response.quantitativeRule) {
    throw new VoiceConfigAnalysisError(422, '非定量评分标准不能新增 quantitativeRule，请选择其他标准或仅追加判定说明');
  }

  const needsBinding = !effective.some((item) => item.id === current.id);
  if (!Object.keys(patch).length && !needsBinding) {
    throw new VoiceConfigAnalysisError(422, '诊断已完成，但没有生成新的评分规则或场景绑定，请补充希望加入的具体判定口径');
  }

  const reportItem = report.items.find((item) => item.itemId === current.id);
  const reasons = [
    ...(needsBinding ? [`场景“${scenario.name}”当前未绑定“${current.name}”，该标准不会进入场景评分`] : []),
    ...(!reportItem ? ['上次评分报告中没有该评分项的结果；报告未保存评分标准快照，无法排除评分后配置发生变化'] : []),
    ...stringList(response.reasons),
  ];
  const evidence = [
    `最近演练：${scenario.name}（${session.endedAt ?? session.startedAt}）`,
    ...(reportItem ? [`历史评分项“${current.name}”得分/扣减参数：${reportItem.score}`] : []),
    ...stringList(response.evidence),
  ];
  if (isFluencyAspect(args.aspect)) {
    const fluency = analyzeReceptionFluency(session);
    evidence.splice(1, 0, `当前规则检测：填充词 ${fluency.fillerCount} 次，重复字词或断句 ${fluency.repetitionCount} 次，句中明显停顿 ${fluency.disruptedPauseCount} 处`);
    evidence.push(...fluency.evidence.slice(0, 3));
    if (!fluency.triggered) reasons.push('按当前固定规则重新分析，本场磕绊未达到扣分阈值；个别语气词、重复或自然停顿不会被扣分');
  }

  const proposedChanges: string[] = [];
  if (behaviorAnchorAddition && patch.behaviorAnchor) proposedChanges.push(`行为锚定追加：${behaviorAnchorAddition}`);
  if (judgePromptAddition && patch.judgePrompt) proposedChanges.push(`判定说明追加：${judgePromptAddition}`);
  if (patch.levels) proposedChanges.push(`新增 ${levels.length - current.levels.length} 个评分档位，保留原有档位`);
  if (patch.quantitativeRule) proposedChanges.push('更新定量计分规则，保留原有计分块与指标');
  if (needsBinding) proposedChanges.push(`将“${current.name}”追加到场景“${scenario.name}”的评分标准绑定，保留原有绑定`);

  return {
    current,
    scenario,
    patch,
    needsBinding,
    diagnosis: {
      kind: 'score-item-analysis',
      aspect: args.aspect,
      session: {
        id: session.id,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        endedAt: session.endedAt,
      },
      scoreItem: { id: current.id, name: current.name },
      summary: clip(response.summary, 500) || `已完成“${args.aspect}”的历史评分诊断，并生成增量修改预览`,
      reasons,
      evidence,
      proposedChanges,
    },
  };
}
