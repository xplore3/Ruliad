/**
 * 新增评分标准「跟孩子沟通策略」（地推，权重 5，LLM 文本判定）。
 * 宗旨：情感先行 → 理性说服 → 借孩子的同意影响家长（方法不唯一）。
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
    '与孩子沟通的策略宗旨：先情感后理性——先给孩子情感上的支持与尊重（如"我非常尊重你"、鼓励、讲故事、玩游戏、蹲下来平视），再做事理上的说服；最后要用孩子的同意去说动家长（如让孩子大声回答"想学"、让孩子把笔递给家长、让孩子向家长表达自己的意愿）。' +
    '具体方法不唯一，凡符合"情感先行→理性说服→借孩子同意影响家长"这一顺序与宗旨的策略都算优秀；' +
    '反过来——忽略孩子、命令/训斥/施压孩子、或只干巴巴讲道理而没有情感铺垫——都是不合格。',
  judgePrompt:
    '只依据对话记录中销售与孩子的互动评判沟通策略（标注"学员（对孩子说）"的轮次及孩子的回应）。' +
    '依次检查三件事：1）是否先给情感支持/尊重再讲道理（顺序不能反）；2）是否有实际的说服推进；3）是否借孩子的同意去影响家长（让孩子表态、大声回答、递笔等）。' +
    '本标准只看沟通策略，不评价语气音高响度（那由「与孩子说话的语气」标准负责），也不评价对家长的话术。' +
    '只要对话记录中没有任何"学员（对孩子说）"轮次，无论是否进入家长问孩子环节，都判 fail 0 分并注明"未与孩子沟通"；未发生本标准要求的行为不能判 pass 50 分。',
  weight: 5,
  levels: [
    {
      key: 'excellent',
      label: '优秀',
      score: 100,
      description: '情感支持/尊重在先，理性说服在后，并借孩子的同意（大声表态/递笔/向家长表达想学）去影响家长',
    },
    {
      key: 'good',
      label: '良好',
      score: 75,
      description: '有情感铺垫也有说服推进，但没有借孩子的同意去影响家长',
    },
    {
      key: 'pass',
      label: '待提升',
      score: 50,
      description: '实际与孩子沟通了，但只做了其中一环（只哄孩子没有说服推进，或只讲道理缺情感铺垫）',
    },
    {
      key: 'fail',
      label: '不合格',
      score: 0,
      description: '完全没有与孩子沟通，或沟通时命令/训斥/施压孩子',
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
