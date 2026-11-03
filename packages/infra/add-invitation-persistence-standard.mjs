/**
 * 新增评分标准「坚持销售邀请函」（地推，权重 10，LLM 直接打分）。
 * 联系方式替代与免费试听替代各 50 分：坚持且有情商=满分，坚持但表达生硬=一半，不坚持=0。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node add-invitation-persistence-standard.mjs
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NAME = '坚持销售邀请函';
const existing = await prisma.scoreItemDef.findMany({ where: { name: NAME } });
if (existing.length > 0) {
  console.log('标准已存在，跳过（id=', existing[0].id, ')');
  process.exit(0);
}

const data = {
  behaviorAnchor:
    '客户用替代方案转移销售邀请时，学员应在尊重客户、照顾感受的同时，坚持推进卖邀请函这一当前目标。' +
    '有情商的坚持是先理解或认可客户的想法，再自然说明邀请函的价值并给出明确推进；不能接受替代方案来取代邀请函。' +
    '只礼貌、不坚持不得分；坚持但表达生硬只能得该项一半。',
  judgePrompt:
    '总分100分，只评价客户提出替代方案后，学员是否坚持卖邀请函，以及坚持时的表达技巧与情商。不要评价其他销售环节。' +
    '评分分两项，各50分：A. 联系方式替代——客户提出加微信、留电话、让学员留电话或稍后线上联系等；B. 免费试听替代——客户提出先免费试听、只参加免费体验而不买邀请函等。' +
    '每项独立按以下规则给分：50分=明确坚持卖邀请函，并以有技巧、有情商的方式表达（理解客户、尊重选择、自然说明价值、温和但明确地推进）；25分=明确坚持卖邀请函，但表达生硬、强势、直白催促、缺乏共情或容易让客户不舒服；0分=没有坚持卖邀请函，包括接受加微信/留电话/免费试听来替代邀请函、主动放弃推进，或虽有情商表达却不坚持。' +
    '坚持是得分的必要前提，任何单项只要有情商但不坚持就必须0分，不得给25或50。替代方案可以作为补充，但不能取代购买邀请函；若学员仍明确推进购买邀请函，可视为坚持。' +
    '两种替代方案都出现时总分=A+B。只出现一种时，未出现的一项不扣分，按已出现项折算为百分制：该项50则总分100，25则总分50，0则总分0。两种都未出现时总分0，并注明本场未展示替代方案处理行为。' +
    'score 只能输出按上述规则得到的0、25、50、75、100等整数；dimensions 分别说明A、B是否出现及各自得分；rationale 必须引用客户替代方案和学员回应作为证据，用使用者容易理解的语言，betterScript 只针对坚持或表达方式的不足给一句更优话术。',
  weight: 10,
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
    skillPointId: 'sp-closing',
    name: NAME,
    layer: 'company',
    data: JSON.stringify(data),
  },
});
console.log(`已创建「${NAME}」id=${id}（地推，权重10，两项各50分）`);
await prisma.$disconnect();
