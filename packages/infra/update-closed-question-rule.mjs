/**
 * 更新「地推销售忌讳」「咨询接待忌讳事项」：新增第八条——非邀约场景的封闭式推进提问扣分。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node update-closed-question-rule.mjs
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const RULE_ANCHOR =
  '8. 除邀约封闭式问题外，销售在沟通过程中不应使用答案不确定的封闭式提问推进对话，例如“你是不是要了解一下”“你要不要听我介绍一下”“您需要吗”“您感兴趣吗”。' +
  '只要不能确定客户会给出肯定答案，向客户提问进行推进都属于封闭式问题，每次扣5分。' +
  '应改为直接陈述价值或开放式提问，例如“我直接给您介绍一下我们课程的核心优势，您听听看是否适合孩子”。' +
  '邀约类封闭式问题仍按第6条单独扣5分，不重复累计。';

const RULE_PROMPT =
  '第八条：除邀约封闭式问题外，销售使用答案不确定的封闭式提问推进对话（如“你是不是要了解一下”“你要不要听我介绍一下”“您需要吗”“您感兴趣吗”），每出现一次score增加5。' +
  '只要不能确定客户会给出肯定答案，向客户提问进行推进都属于封闭式问题；开放式问题、答案已确定为肯定的确认、单纯陈述不扣分。' +
  '邀约类封闭式问题仍按第六条单独扣分，不重复累计。' +
  '本条先由代码筛选候选句，再由LLM语义复核并统一追加；你的score和dimensions只评前三条，不得自行加入第八条分数，避免重复扣分。';

const NAMES = ['地推销售忌讳', '咨询接待忌讳事项'];

for (const name of NAMES) {
  const item = await prisma.scoreItemDef.findFirst({ where: { name } });
  if (!item) {
    console.log(`未找到「${name}」，跳过`);
    continue;
  }
  const data = JSON.parse(item.data);
  if (data.behaviorAnchor.includes('除邀约封闭式问题外')) {
    console.log(`「${name}」已包含封闭式推进提问规则，跳过`);
    continue;
  }
  data.behaviorAnchor = `${data.behaviorAnchor}\n${RULE_ANCHOR}`;
  data.judgePrompt = `${data.judgePrompt}\n${RULE_PROMPT}`;
  await prisma.scoreItemDef.update({
    where: { id: item.id },
    data: { data: JSON.stringify(data) },
  });
  console.log(`已更新「${name}」id=${item.id}`);
}

await prisma.$disconnect();
