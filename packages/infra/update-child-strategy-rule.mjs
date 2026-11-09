/**
 * 更新「跟孩子沟通策略」评分标准：支持直接讲故事与完整策略两条路线。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node update-child-strategy-rule.mjs
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NAME = '跟孩子沟通策略';
const item = await prisma.scoreItemDef.findFirst({ where: { name: NAME } });
if (!item) {
  console.log(`未找到「${NAME}」，跳过`);
  process.exit(0);
}

const data = JSON.parse(item.data);
data.behaviorAnchor =
  '与孩子沟通有两种可行路线：' +
  '1. 假定成交路线：不征求孩子意见，直接开始讲有趣故事或做有趣游戏。故事必须实际讲出且有具体内容，能逗孩子开心；讲完后再问孩子是否喜欢或想不想来玩，孩子固定回答喜欢/想来。此路线不要求先给情感支持。' +
  '2. 完整策略路线：先给孩子情感支持（尊重、鼓励、关注、陪伴），再实际讲出能逗孩子开心的故事或做有趣游戏，最后才问孩子是否喜欢或想学。' +
  '如果销售先问“我给你讲个故事好不好”，孩子固定回答“我不想学”，之后必须按完整策略路线执行才能说服；此问句不算封闭式提问。' +
  '缺少铺垫、顺序错误、只有情感支持没有实际有趣故事、故事乏味或策略不合理时，孩子固定回答不喜欢/不想玩。第二次仍无效时家长带孩子离开，记为卖邀请函失败。' +
  '无铺垫直接问“你喜欢吗/想学吗”属于封闭式问题，触发地推忌讳扣分；铺垫充分后提问答案确定，不扣分。';

await prisma.scoreItemDef.update({
  where: { id: item.id },
  data: { data: JSON.stringify(data) },
});
console.log(`已更新「${NAME}」id=${item.id}`);
await prisma.$disconnect();
