/**
 * 新增评分标准「主动性确定试听时间」（咨询接待，权重 10，LLM 直接打分）。
 * 主动约试听30 + 充分答疑后的时机40 + 假定成交式邀约30；全程未主动约试听=0。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node add-reception-proactive-appointment-standard.mjs
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NAME = '主动性确定试听时间';
const existing = await prisma.scoreItemDef.findMany({ where: { name: NAME } });
if (existing.length > 0) {
  console.log('标准已存在，跳过（id=', existing[0].id, ')');
  process.exit(0);
}

const data = {
  behaviorAnchor:
    '咨询接待客户虽有兴趣，但部分客户只是随口问问，销售必须充分解答问题，并主动了解孩子年龄、学习基础、时间安排等必要情况，再趁热打铁推动确定试听时间。' +
    '假定成交的内核是默认试听这件事已经达成，只与客户讨论何时试听和如何安排，而不是重新询问要不要试听。可以使用“您看孩子什么时候方便，我这边提前安排老师”“您是周中还是周末方便”等各种自然表达，不拘泥固定句式。',
  judgePrompt:
    '总分100分，只评价咨询接待中销售是否主动推动确定试听时间，不评价是否打断客户或一般沟通礼貌。评分由三部分组成：' +
    'A. 主动约试听30分：销售主动提出安排试听、确定试听时间或引导客户选择时间，得30分；全程没有主动表示想约客户试听，则A=0，且总分直接为0，其他部分不再给分。' +
    'B. 信息与时机40分：充分解答咨询者的问题，并主动了解必要背景（例如孩子年龄、学习基础、时间安排等）后再主动邀约，得40分；没有解答主要问题或没有了解必要情况就直接邀约，根据缺少程度给0~20分。不要以“是否打断客户”作为扣分理由，核心是信息是否充分、时机是否成熟。全程未主动邀约则B=0。' +
    'C. 假定成交30分：默认试听已经达成，只推进试听时间和具体安排，得30分。例如“您看孩子什么时候方便，我这边提前安排老师”“您是周中还是周末试听”“周六上午还是下午方便”都符合，不拘泥某一种句式。' +
    '封闭式邀约是一票否决：只要销售问“需要我给您安排试听课吗”“要不要试听”等让客户决定是否试听的问题，就等于邀约失败，总分直接为0。即使随后客户答应或销售再落实时间，也不能给A/B/C任何分数，不能通过后续话术挽救。' +
    '主动提出试听是总分前提，未主动约试听不能仅凭解答问题好或态度亲切给分。不要把“什么时候方便”当作唯一正确答案，也不要把封闭式“需要吗/要不要”误判为假定成交。' +
    'score 输出三部分相加后的0~100整数，且必须严格等于 dimensions 中A+B+C的合计，禁止出现合计不一致的分数。dimensions 分别列出A/B/C得分及证据，rationale 引用学员实际话术说明主动性、信息准备和假定成交内核，betterScript 针对不足给一句自然的邀约。',
  weight: 10,
  levels: [],
  isObservation: false,
  category: '咨询接待',
  scoringMode: 'score',
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
console.log(`已创建「${NAME}」id=${id}（咨询接待，权重10，主动30+时机40+假定成交30）`);
await prisma.$disconnect();
