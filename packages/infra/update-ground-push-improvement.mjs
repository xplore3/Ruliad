/**
 * 更新「地推主动性」：改进建议需说明快速筛选推进的原因，以及家长拿卡后的正确介绍步骤。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node update-ground-push-improvement.mjs
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const item = await prisma.scoreItemDef.findFirst({ where: { name: '地推主动性' } });
if (!item) {
  console.log('未找到「地推主动性」，跳过');
  process.exit(0);
}

const data = JSON.parse(item.data);
data.judgePrompt =
  '只评价地推主动推进，score按以下固定结构直接累加，最高100分。' +
  'A. 递邀请函筛选20分：学员说明试听邀请并明确让家长拿上或接过邀请函才得20；只有活动邀请没有递卡动作、客户自己拿卡或完全没有，均得0。' +
  'B. 介绍并售卖邀请函50分：家长拿上邀请函后，学员先介绍体验课、学校地址、销售电话和姓名、邀请函定价，再主动引导客户购买得50；直接售卖而缺少上述介绍、只有介绍未主动提出购买、或等待客户表态，得0；如果已有明确售卖意图但行动不够完整，最多给25，必须说明依据。' +
  'C. 确定试听时间并填写用户信息30分：学员主动约定具体试听时间得15，主动引导填写姓名、电话等用户信息得15，两项都有得30；客户主动提出不能算学员得分。' +
  '客户的中性回应、客户主动问试听流程或下一步均不得给学员加分。score=A+B+C的整数总分，rationale必须按A/B/C逐项列出得分并引用学员原话，不能只凭热情打分。' +
  'betterScript不要只给话术，必须向学员解释错误原因和正确做法：地推要快速筛选和推进，因为学校放学只有几分钟，家长人群集中但时间窗口极短，销售必须迅速判断意向并推进成交，不能在无意向家长身上消耗时间，否则错失其他潜在家长；家长拿上邀请函后，应先介绍体验课、学校地址、销售电话和姓名、邀请函定价，再引导购买，而不是直接售卖。' +
  '若客户已给最后机会仍无实质推进，直接score=0并说明本场未完成。';

await prisma.scoreItemDef.update({ where: { id: item.id }, data: { data: JSON.stringify(data) } });
console.log(`已更新「地推主动性」id=${item.id}`);
await prisma.$disconnect();
