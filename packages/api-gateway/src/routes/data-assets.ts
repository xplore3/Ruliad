import type { FastifyInstance } from 'fastify';
import type { RouteContext } from '../ctx.js';
import { buildMonthlyTrend } from './executive.js';

/** 资产健康度口径：lastCalibrated（'YYYY-MM'）超过 6 个月视为未校准 */
function isStaleCalibration(lastCalibrated: string | undefined, staleFlag: boolean | undefined): boolean {
  if (staleFlag) return true;
  if (!lastCalibrated) return false;
  const [y, m] = lastCalibrated.split('-').map(Number);
  if (!y || !m) return false;
  const ageMonths = (Date.now() - new Date(y, m - 1).getTime()) / (30 * 24 * 3600 * 1000);
  return ageMonths > 6;
}

export async function dataAssetsRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // 资产中心：概览（计数 + Top5 + 健康度）/ 客户认知库 / 高频异议库 / 年度趋势
  // 页头四卡与健康度全部由 store 真实数据计算，不使用经营口径常量
  app.get('/admin/data-assets', async (request) => {
    const tenantId = request.tenantId;

    const skillPoints = await store.listSkillPoints(tenantId);
    const personaConfigs = await store.listPersonaConfigs(tenantId);
    const kb = await store.getProductKB(tenantId);
    const failedCerts = (await store.listCertRecords({ tenantId })).filter((c) => !c.passed);

    // 页头四卡：打法资产 = 技能点；客户认知 = 客户角色卡；产品知识 = 知识库条目；失败知识 = 未通过考核复盘
    const authors = new Set(skillPoints.map((sp) => sp.author).filter(Boolean));
    const archetypes = new Set(
      personaConfigs.map((p) => p.sourceMeta?.archetype ?? p.occupation ?? p.name)
    );
    const stats = [
      {
        key: 'tactics',
        label: '打法资产',
        value: skillPoints.length,
        desc: authors.size > 0 ? `来自 ${authors.size} 位销冠萃取` : '来自内容工坊',
      },
      {
        key: 'customer',
        label: '客户认知',
        value: personaConfigs.length,
        desc: `覆盖 ${archetypes.size} 类客户画像`,
      },
      {
        key: 'product',
        label: '产品知识',
        value: kb?.entries.length ?? 0,
        desc: kb ? `${kb.name} v${kb.version}` : '尚未配置产品知识库',
      },
      {
        key: 'failure',
        label: '失败知识',
        value: failedCerts.length,
        desc: '来自未通过考核的复盘',
      },
    ];

    // 资产健康度：观察中打法 / 超 6 个月未校准客户认知 / 样本不足技能点
    const health = [
      { label: '待复审条目', count: skillPoints.filter((sp) => sp.badge === '观察中').length },
      {
        label: '超 6 个月未校准的客户认知',
        count: personaConfigs.filter((p) =>
          isStaleCalibration(p.sourceMeta?.lastCalibrated, p.sourceMeta?.stale)
        ).length,
      },
      {
        label: '样本不足无法验证',
        count: skillPoints.filter((sp) => sp.achievementRate === undefined).length,
      },
    ];

    // 打法资产 Top5：技能点按引用次数（practiceCount）降序
    const topAssets = [...skillPoints]
      .sort((a, b) => (b.practiceCount ?? 0) - (a.practiceCount ?? 0))
      .slice(0, 5)
      .map((sp) => ({
        skillPointId: sp.id,
        name: sp.assetName ?? sp.name,
        author: sp.author ?? null,
        citations: sp.practiceCount ?? 0,
        achievementRate: sp.achievementRate ?? null,
        note: sp.achievementRate === undefined ? '样本不足' : null,
        badge: sp.badge ?? '观察中',
      }));

    // 客户角色卡：personaConfigs 的 sourceMeta
    const personas = personaConfigs.map((p) => ({
      id: p.id,
      name: p.name,
      archetype: p.sourceMeta?.archetype ?? p.occupation ?? p.name,
      recordings: p.sourceMeta?.recordings ?? 0,
      recordingsKind: p.sourceMeta?.recordingsKind ?? '真实录音',
      lastCalibrated: p.sourceMeta?.lastCalibrated ?? null,
      practiceCount: p.sourceMeta?.practiceCount ?? 0,
      stale: isStaleCalibration(p.sourceMeta?.lastCalibrated, p.sourceMeta?.stale),
      calibrationStatus: p.sourceMeta?.calibrationStatus ?? null,
    }));

    // 高频异议库：产品知识库 FAQ 条目按实战频率降序
    const objections = (kb?.entries ?? [])
      .filter((e) => e.kind === 'faq')
      .sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0))
      .map((e) => ({ quote: e.title, answer: e.content, frequency: e.frequency ?? null }));

    // 年度资产报告：复用月度达标率趋势
    const trend = await buildMonthlyTrend(ctx, tenantId);

    return {
      overview: {
        stats,
        topAssets,
        health,
      },
      customerInsights: {
        personas,
        objections,
      },
      annual: { trend },
    };
  });
}
