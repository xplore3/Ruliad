import type { FastifyInstance } from 'fastify';
import type { RouteContext } from '../ctx.js';

/**
 * 前端维度 key → 后端 skillPointId 映射。
 * 前端 MyAbility 页面使用简写 key，后端使用完整 UUID 风格的 id。
 */
const DIM_KEY_TO_SKILL_POINT: Record<string, string> = {
  need: 'sp-need',
  value: 'sp-value',
  objection: 'sp-objection',
  closing: 'sp-closing',
  empathy: 'sp-empathy',
  clarity: 'sp-clarity',
};

/** 反向映射：skillPointId → 前端维度 key */
const SKILL_POINT_TO_DIM_KEY = new Map(
  Object.entries(DIM_KEY_TO_SKILL_POINT).map(([k, v]) => [v, k])
);

/** 维度 key → 维度中文名 */
const DIM_KEY_TO_NAME: Record<string, string> = {
  need: '需求挖掘',
  value: '价值表达',
  objection: '异议处理',
  closing: '推进成交',
  empathy: '倾听共情',
  clarity: '表达清晰',
};

interface EvidenceItem {
  round: number;
  time: string;
  quote: string;
  role: 'customer' | 'me';
  tag: string;
  tagColor: string;
}

interface GuidanceItem {
  label: string;
  content: string;
}

interface AbilityDetailResponse {
  key: string;
  name: string;
  score: number;
  evidenceList: EvidenceItem[];
  aiRationale: string;
  guidance: GuidanceItem[];
}

/**
 * 计算某个评分项在对话中的时间戳（相对会话开始）。
 * 返回 mm:ss 格式。
 */
function calcTime(turnSeq: number, transcript: { seq: number; at: string }[], startedAt: string): string {
  const turn = transcript.find((t) => t.seq === turnSeq);
  if (!turn?.at) return '';
  const ms = new Date(turn.at).getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 计算对话轮次：将 transcript seq 转换为"第 N 轮"（只计算学员+客户的对话对）。
 */
function calcRound(turnSeq: number, transcript: { seq: number; speaker: string }[]): number {
  const turn = transcript.find((t) => t.seq === turnSeq);
  if (!turn) return 0;
  // 轮次 = 该 turn 之前（含）的 trainee+persona 轮数 / 2（向上取整）
  const dialogueTurns = transcript.filter(
    (t) => t.seq <= turnSeq && (t.speaker === 'trainee' || t.speaker === 'persona')
  );
  // 一轮 = 客户 + 学员各一次
  const traineeTurns = dialogueTurns.filter((t) => t.speaker === 'trainee').length;
  return traineeTurns;
}

export async function abilityDetailRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 专项能力评分证据与指导
  app.get<{ Params: { dimKey: string } }>('/ability-detail/:dimKey', async (request, reply) => {
    const dimKey = request.params.dimKey;
    const skillPointId = DIM_KEY_TO_SKILL_POINT[dimKey];

    if (!skillPointId) {
      return reply.code(404).send({ error: `未知维度: ${dimKey}` });
    }

    const userId = request.userId;
    const name = DIM_KEY_TO_NAME[dimKey] ?? dimKey;

    // 1. 获取用户最近已完成的会话（最多取 5 个，覆盖足够证据）
    const sessions = (await store.listSessions({ userId }))
      .filter((s) => s.status === 'completed')
      .sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt))
      .slice(0, 5);

    if (sessions.length === 0) {
      // 无历史会话时返回空数据
      return {
        key: dimKey,
        name,
        score: 0,
        evidenceList: [],
        aiRationale: '暂无练习记录，完成对练后这里会展示评分证据与改进建议。',
        guidance: [{ label: '提示', content: '完成至少一次对练后，这里会展示具体的对话片段与改进建议。' }],
      } satisfies AbilityDetailResponse;
    }

    // 2. 聚合各会话中该技能点的评分项
    const evidenceList: EvidenceItem[] = [];
    const rationales: string[] = [];
    const betterScripts: string[] = [];
    let totalScore = 0;
    let scoreCount = 0;

    for (const session of sessions) {
      const report = await store.getScoreReportBySession(session.id);
      if (!report) continue;

      // 该技能点的综合得分
      const skillScore = report.skillScores.find((s) => s.skillPointId === skillPointId);
      if (skillScore) {
        totalScore += skillScore.score;
        scoreCount++;
      }

      // 该技能点下的评分项
      const items = report.items.filter((item) => item.skillPointId === skillPointId);

      for (const item of items) {
        // 证据：引用原文
        if (item.quote && item.quoteTurnSeq > 0) {
          const round = calcRound(item.quoteTurnSeq, session.transcript);
          const time = calcTime(item.quoteTurnSeq, session.transcript, session.startedAt);
          const turn = session.transcript.find((t) => t.seq === item.quoteTurnSeq);
          const isTrainee = turn?.speaker === 'trainee';

          // 根据档位判断标签
          const isPositive = item.levelKey === 'excellent' || item.levelKey === 'good' || item.score >= 80;
          const tag = isPositive ? '有效表达' : '待改进';
          const tagColor = isPositive ? '#5DC7A3' : '#E85C62';

          evidenceList.push({
            round,
            time,
            quote: item.quote,
            role: isTrainee ? 'me' : 'customer',
            tag,
            tagColor,
          });
        }

        // 收集 rationale 和 betterScript
        if (item.rationale) {
          rationales.push(item.rationale);
        }
        if (item.betterScript) {
          betterScripts.push(item.betterScript);
        }
      }
    }

    // 3. 计算平均分
    const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;

    // 4. 生成 AI 评分解释
    let aiRationale: string;
    if (evidenceList.length === 0) {
      aiRationale = `暂无"${name}"维度的具体评分证据。完成更多对练后，这里会展示影响评分的关键对话片段。`;
    } else {
      const positiveCount = evidenceList.filter((e) => e.tag === '有效表达').length;
      const improveCount = evidenceList.filter((e) => e.tag === '待改进').length;
      aiRationale = `${name}维度得分 ${avgScore} 分。最近 ${sessions.length} 次对练中，共采集到 ${evidenceList.length} 个评分证据，其中 ${positiveCount} 个表现良好，${improveCount} 个有待改进。${
        rationales.length > 0 ? rationales[0] : ''
      }`;
    }

    // 5. 生成改进指导
    const guidance: GuidanceItem[] = [];
    if (evidenceList.length > 0) {
      const positiveEvidence = evidenceList.filter((e) => e.tag === '有效表达');
      const improveEvidence = evidenceList.filter((e) => e.tag === '待改进');

      if (positiveEvidence.length > 0) {
        const example = positiveEvidence[0];
        guidance.push({
          label: '做得好的',
          content: `第 ${example.round} 轮对话表现较好：「${example.quote}」${
            rationales.length > 0 ? '——' + rationales[0] : ''
          }`,
        });
      }

      if (improveEvidence.length > 0) {
        const example = improveEvidence[0];
        const better = betterScripts.length > 0 ? `建议话术：「${betterScripts[0]}」` : '';
        guidance.push({
          label: '可提升的',
          content: `第 ${example.round} 轮对话中「${example.quote}」还有提升空间。${better}`,
        });
      }
    } else {
      guidance.push({
        label: '提示',
        content: '完成对练后，这里会给出针对性的改进建议。',
      });
    }

    return {
      key: dimKey,
      name,
      score: avgScore,
      evidenceList: evidenceList.slice(0, 10), // 最多返回 10 条证据
      aiRationale,
      guidance,
    } satisfies AbilityDetailResponse;
  });
}
