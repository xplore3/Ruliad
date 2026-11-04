/**
 * 新增评分标准「跟孩子沟通策略」（地推，权重 5，LLM 文本判定）。
 * 宗旨：简短回应当下话题 → 先给予情感支持 → 用趣味内容让孩子愿意继续玩（方法不唯一）。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node add-child-strategy-standard.mjs
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NAME = '跟孩子沟通策略';
const existing = await prisma.scoreItemDef.findMany({ where: { name: NAME } });
if (existing.length > 0) {
  console.log('标准已存在，跳过（id=', existing[0].id, ')');
  process.exit(0);
}

const data = {
  behaviorAnchor:
    '与孩子沟通要符合真实儿童心理：先简短回应孩子正在谈的事物（如“我陪你一起滑”），让家长看到孩子的话没有被漠视，再自然转回沟通，不需要也不应长时间纠缠这个话题。' +
    '给予孩子情感支持，可以表达对孩子想法和自主选择的尊重，也可以用鼓励、关注、陪伴、蹲下来平视等方式，方法不唯一。' +
    '用搞笑故事、小游戏等趣味内容让孩子开心、好奇、愿意继续玩，再自然引导体验。情感支持和趣味引导缺一不可，但先情感支持还是先讲故事都可以。忽略孩子、命令训斥、持续施压或只干巴巴讲道理都是不合格。',
  judgePrompt:
    '只依据对话记录中销售与孩子的互动评判沟通策略（标注"学员（对孩子说）"的轮次及孩子的回应），按以下三点判断：' +
    '1）孩子提出当下话题（如想玩滑梯）后，是否先简短回应，再自然转回沟通。简短回应主要是让家长看到孩子被倾听和尊重，说一次“我陪你一起滑”已经足够；不得要求销售多聊滑梯，也不得因销售随后岔开话题而扣分。' +
    '2）是否给予情感支持。尊重孩子的想法和自主选择是一种有效方式，但鼓励、关注、陪伴等也可以；可以先给情感支持再讲故事，也可以先讲故事再补情感支持，两种顺序都可以得满分，不得因顺序扣分。' +
    '3）是否用搞笑故事、小游戏等趣味内容让孩子开心、好奇、愿意继续玩，并自然引导后续体验。故事是否好笑要结合孩子反应判断，但不要求孩子必须立刻答应购买。' +
    '情感支持和趣味引导是孩子松动的两个必要条件，缺少任何一个都可能合理抗拒，但先后顺序不限；不得仅因故事好玩就要求孩子忽略情感支持缺失。' +
    '评价学员实际采取的策略，不要把孩子角色是否持续拒绝当作唯一依据，也不要用成年人的逻辑要求低龄孩子持续坚持自己的话题。' +
    '本标准只看沟通策略，不评价语气音高响度（那由「与孩子说话的语气」标准负责），也不评价对家长的话术。' +
    '只要对话记录中没有任何"学员（对孩子说）"轮次，无论是否进入家长问孩子环节，都判 fail 0 分并注明"未与孩子沟通"；未发生本标准要求的行为不能判 pass 50 分。',
  weight: 5,
  levels: [
    {
      key: 'excellent',
      label: '优秀',
      score: 100,
      description: '简短回应孩子的话题，给予情感支持并用搞笑故事或游戏让孩子愿意继续玩，两种方式的先后顺序不限',
    },
    {
      key: 'good',
      label: '良好',
      score: 75,
      description: '简短回应、情感支持和趣味引导基本做到，但个别环节较弱或后续推进不够自然',
    },
    {
      key: 'pass',
      label: '待提升',
      score: 50,
      description: '实际与孩子沟通了，但只做到部分环节，或缺少情感支持或趣味引导',
    },
    {
      key: 'fail',
      label: '不合格',
      score: 0,
      description: '完全没有与孩子沟通，或忽略、命令、训斥、持续施压孩子',
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
