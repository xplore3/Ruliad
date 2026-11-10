/**
 * 更新「地推销售忌讳」「咨询接待忌讳事项」：
 * 将第二条（虚假承诺、夸大其词）的判定统一移交跨场景通用标准「合规表达通用规范」，
 * 避免同一行为在两处重复扣分，并保证全场景（含电销/现场成交）执行同一套判定口径。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node update-taboo-compliance-delegation.mjs
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NAMES = ['地推销售忌讳', '咨询接待忌讳事项'];
const DONE_MARK = '合规表达通用规范';

const NEW_ANCHOR_RULE_2 =
  '2. 虚假承诺与夸大其词已统一移交跨场景通用标准「合规表达通用规范」判定，该标准在地推、电销、咨询接待、现场成交全部场景生效，' +
  '明确区分“传递信心”（如“您放心，我们一定会让您觉得值得的”）与“虚假事实承诺”（如实际8人班谎称2人班、保证提分）。' +
  '本项不再对虚假承诺重复扣分。';

const NEW_PROMPT_RULE_2 =
  '第二条（已移交，不评）：虚假承诺、夸大其词由跨场景通用标准「合规表达通用规范」统一判定并在全部场景生效，' +
  '该标准明确“传递信心”（如“您放心，我们一定会让您觉得值得的”）不属于虚假承诺，' +
  '“虚构机构客观事实或与实际不符的保证”（如实际8人班谎称2人班、保证提分）才扣分。' +
  '本项不得对虚假承诺扣分。';

/** 用起止锚点替换片段（锚点文本不依赖内部精确内容，长度校验保证不会误切） */
function replaceBetween(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start === -1) throw new Error(`未找到起始锚点：${label}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`未找到结束锚点：${label}`);
  if (end <= start) throw new Error(`锚点顺序异常：${label}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

for (const name of NAMES) {
  const item = await prisma.scoreItemDef.findFirst({ where: { name } });
  if (!item) {
    console.log(`未找到「${name}」，跳过`);
    continue;
  }
  const data = JSON.parse(item.data);
  if ((data.behaviorAnchor ?? '').includes(DONE_MARK) && (data.judgePrompt ?? '').includes(DONE_MARK)) {
    console.log(`「${name}」已移交通用标准，跳过`);
    continue;
  }

  // 1) 行为锚定：替换第二条
  data.behaviorAnchor = replaceBetween(
    data.behaviorAnchor,
    '2. 虚假承诺、夸大其词按程度扣分',
    '3. 在',
    NEW_ANCHOR_RULE_2 + '\n',
    `${name}.behaviorAnchor 第二条`,
  );

  // 2) 判定 prompt：替换第二条判定段
  data.judgePrompt = replaceBetween(
    data.judgePrompt,
    '第二条：虚假承诺、夸大其词按最严重的一次程度扣分',
    '第三条：',
    NEW_PROMPT_RULE_2,
    `${name}.judgePrompt 第二条`,
  );

  // 3) 判定 prompt：移除原第二条的 A-E 判定细则（已并入通用标准）
  data.judgePrompt = replaceBetween(
    data.judgePrompt,
    '第二条按以下业务规则分别判断表达方式与真实意图',
    '普通措辞不够亲切不属于第一条。',
    '',
    `${name}.judgePrompt A-E 细则`,
  );

  // 4) 判定范围语句：只评第一条和第三条
  const before = data.judgePrompt;
  data.judgePrompt = data.judgePrompt.split('只评前三条').join('只评第一条和第三条');
  data.judgePrompt = data.judgePrompt.split('三条忌讳是否触犯').join('第一条、第三条的触犯情况');
  if (data.judgePrompt === before && !data.judgePrompt.includes('只评第一条和第三条')) {
    console.log(`「${name}」未找到“只评前三条”表述，请人工核查`);
  }

  await prisma.scoreItemDef.update({
    where: { id: item.id },
    data: { data: JSON.stringify(data) },
  });
  console.log(`已更新「${name}」id=${item.id}：虚假承诺判定已移交「合规表达通用规范」`);
}

await prisma.$disconnect();
