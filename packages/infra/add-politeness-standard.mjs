/**
 * 新增评分标准「礼貌礼仪」（地推，权重 5，LLM 文本判定）。
 * 购买后致谢、告别时礼貌收口、全程尊重客户；尊重客户的幽默不扣分。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node add-politeness-standard.mjs
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NAME = '礼貌礼仪';
const existing = await prisma.scoreItemDef.findMany({ where: { name: NAME } });
if (existing.length > 0) {
  console.log('标准已存在，跳过（id=', existing[0].id, ')');
  process.exit(0);
}

const data = {
  behaviorAnchor:
    '地推沟通全程应措辞礼貌、尊重客户。客户购买后应自然致谢；告别时应使用“再见”“您慢点”“期待您的光临”等礼貌收尾。' +
    '可以开尊重客户、分寸适当的玩笑，不因幽默、轻松或不够正式扣分；辱骂、嘲讽、轻蔑、威胁、奚落客户等明确不尊重行为不合格。',
  judgePrompt:
    '只评价学员对客户的礼貌礼仪，按实际对话证据选择档位，不评价销售技巧、意向甄别、沟通策略或语音表现。' +
    '先检查是否有辱骂、嘲讽、轻蔑、威胁、奚落等明确不尊重客户的表达，例如“不用你妹呀”；只要有这类表达即判 fail 0 分。' +
    '尊重客户、不冒犯人的玩笑、幽默和轻松表达不属于不礼貌，不得仅因开玩笑或措辞不正式扣分，要注意与冒犯性表达甄别。' +
    '没有不尊重行为时，再检查：1）客户购买后是否说了“谢谢”等自然致谢；2）实际告别时是否说了“再见”“您慢点”“期待您的光临”等等价礼貌收尾；3）整体措辞是否礼貌。' +
    '购买或告别环节未出现时，对应要求不扣分，不得虚构遗漏；整体礼貌且已发生的环节均有礼貌礼仪，判 excellent。' +
    '整体礼貌但遗漏一次已发生环节的致谢或礼貌告别，判 good；没有不尊重行为，但两次都遗漏或整体措辞明显不够礼貌，判 pass。',
  weight: 5,
  levels: [
    {
      key: 'excellent',
      label: '优秀',
      score: 100,
      description: '整体礼貌尊重；购买后致谢、实际告别时礼貌收尾均已做到；尊重客户的幽默不扣分',
    },
    {
      key: 'good',
      label: '良好',
      score: 75,
      description: '整体礼貌且无不尊重行为，但遗漏一次已发生环节的购买致谢或礼貌告别',
    },
    {
      key: 'pass',
      label: '待提升',
      score: 50,
      description: '没有明确不尊重行为，但购买致谢和礼貌告别均遗漏，或整体措辞明显不够礼貌',
    },
    {
      key: 'fail',
      label: '不合格',
      score: 0,
      description: '出现辱骂、嘲讽、轻蔑、威胁、奚落等明确不尊重客户的表达',
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
    skillPointId: 'sp-compliance',
    name: NAME,
    layer: 'company',
    data: JSON.stringify(data),
  },
});
console.log(`已创建「${NAME}」id=${id}（地推，权重5，四档 LLM 判定）`);
await prisma.$disconnect();
