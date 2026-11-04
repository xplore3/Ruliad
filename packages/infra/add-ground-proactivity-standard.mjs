/**
 * 新增评分标准「地推范主动性」（地推，权重 5，LLM 文本判定）。
 * 核心：销售要主动引导客户完成明确的下一步行动，不能等客户推动销售进程。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node add-ground-proactivity-standard.mjs
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NAME = '地推范主动性';
const existing = await prisma.scoreItemDef.findMany({ where: { name: NAME } });
if (existing.length > 0) {
  console.log('标准已存在，跳过（id=', existing[0].id, ')');
  process.exit(0);
}

const data = {
  behaviorAnchor:
    '地推必须发挥主动性，由销售引导销售进程，不能指望客户替销售推动下一步。' +
    '优秀的推进不仅有介绍，还会伴随明确、可执行的行动指引，例如“来，您拿上”让客户接过邀请函、“来，您在这边填一下”引导填写信息、“您是微信还是现金”引导完成支付选择。' +
    '行动推进应自然、清楚，让客户知道现在该做什么；只介绍产品、回答问题或等待客户表态，不属于主动推进。',
  judgePrompt:
    '只评价学员在地推过程中是否主动引导客户完成明确的下一步行动，不评价声音、礼貌、产品知识或其他销售技巧。' +
    '逐步检查学员的发言：除了介绍和回应，是否给出了清楚、自然、可执行的行动推进，例如递出并让客户接过邀请函、引导填写姓名电话、引导确认活动时间、引导选择支付方式。' +
    '关键不是语气是否热情，而是客户听完后是否知道“现在要做什么”。客户不配合或拒绝不等于学员不主动，仍只根据学员实际说了什么判断。' +
    'excellent：多个关键环节都有明确行动推进，销售主动引导进程，客户清楚下一步；' +
    'good：整体主动，有明确行动推进，但部分环节引导不够连续或不够清楚；' +
    'pass：主要是介绍、解释或回应，只有少量行动推进，或行动指引模糊，仍较多依赖客户接话和决定下一步；' +
    'fail：完全被动，只做介绍、回答或等待客户表态，没有任何明确行动推进，客户不知道下一步该做什么。' +
    'rationale 必须引用学员是否有行动推进的具体原话，用使用者容易理解的语言说明，不得只凭“很积极”“很热情”等印象打分。betterScript 针对缺少行动推进的环节，给一句自然明确的行动指引。',
  weight: 5,
  levels: [
    {
      key: 'excellent',
      label: '优秀',
      score: 100,
      description: '多个关键环节都有明确、自然的行动推进，主动引导客户完成下一步',
    },
    {
      key: 'good',
      label: '良好',
      score: 75,
      description: '有明确行动推进，但部分环节的引导不够连续或不够清楚',
    },
    {
      key: 'pass',
      label: '待提升',
      score: 50,
      description: '以介绍和回应为主，行动推进较少或模糊，较多依赖客户推动进程',
    },
    {
      key: 'fail',
      label: '不合格',
      score: 0,
      description: '完全被动，没有明确行动推进，客户不知道下一步该做什么',
    },
  ],
  isObservation: false,
  category: '地推',
};

const id = randomUUID();
await prisma.scoreItemDef.create({
  data: {
    id,
    tenantId: 'tenant-demo',
    skillPointId: 'sp-closing',
    name: NAME,
    layer: 'company',
    data: JSON.stringify(data),
  },
});
console.log(`已创建「${NAME}」id=${id}（地推，权重5，四档 LLM 判定）`);
await prisma.$disconnect();
