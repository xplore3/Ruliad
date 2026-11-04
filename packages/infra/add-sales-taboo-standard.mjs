/**
 * 新增评分标准「销售忌讳」（地推，权重 10，只扣分不加分）。
 * 当前忌讳：不能确定肯定答案时问封闭式问题，每发生一次扣 10 分。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node add-sales-taboo-standard.mjs
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NAME = '销售忌讳';
const existing = await prisma.scoreItemDef.findMany({ where: { name: NAME } });
if (existing.length > 0) {
  console.log('标准已存在，跳过（id=', existing[0].id, ')');
  process.exit(0);
}

const data = {
  behaviorAnchor:
    '销售忌讳清单（独立扣分项，只扣分不加分，不参与加权平均）：' +
    '1. 不能确定答案是肯定时，向客户或孩子提出封闭式问题。例如“您让孩子学围棋吗”，或没有给孩子情感支持和好玩故事就直接问“小朋友你喜欢吗”。每发生一次从整场最终总分扣10分。' +
    '如果发生在首次明确介绍或递出邀请函之前，演练会被强制中止，但仍只按发生次数从最终总分扣10分，不额外加重。',
  judgePrompt:
    '本标准是独立扣分项，只扣分不加分，不参与加权平均。只检查“销售忌讳”清单中列出的行为，不得把其他销售问题纳入本项。' +
    '当前唯一忌讳：销售在不能确定答案肯定时，向客户或孩子提出封闭式问题。典型例子包括“您让孩子学围棋吗”，以及没有先给孩子情感支持和好玩故事就直接问“小朋友你喜欢吗/想学吗”。' +
    '每出现一次从整场最终总分扣10分。score 直接输出本项应扣减的金额：score=10×实际发生次数，未发生则score=0；不要输出100减分后的结果。相同或近似的忌讳问句重复出现也按每次实际发生分别计数。' +
    '只有结合上下文能够明确知道答案肯定时才允许封闭式问题，不得仅因销售自己期待肯定答案就豁免。开放式提问、陈述行动推进不属于本忌讳。' +
    '问题发生在邀请函介绍前还是中后段，都只按每次扣10分计算；开场前触发强制中止也不额外多扣。' +
    'dimensions 必须列出忌讳行为及每次扣分；rationale 引用具体问句和最终扣分计算，用使用者容易理解的语言。betterScript 给一个更合适的开放式提问或明确行动推进示例。',
  weight: 0,
  deductionOnly: true,
  levels: [],
  isObservation: false,
  category: '地推',
  scoringMode: 'score',
};

const id = randomUUID();
await prisma.scoreItemDef.create({
  data: {
    id,
    tenantId: 'tenant-demo',
    skillPointId: 'sp-compliance',
    name: NAME,
    layer: 'company',
    data: JSON.stringify(data),
  },
});
console.log(`已创建「${NAME}」id=${id}（地推，权重10，每项忌讳扣10分）`);
await prisma.$disconnect();
