// 一次性：把实用场景相关的医疗版内容替换为教育版（对齐 packages/infra/src/seed.ts 的同 id 教育种子）。
// 只改文本字段，id / 结构 / 关联（学习路径、考核窗口、任务、历史）全部保持不变。
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function updateScenario(id, name, patch) {
  const row = await prisma.scenario.findUnique({ where: { id } });
  if (!row) throw new Error(`场景不存在: ${id}`);
  const data = JSON.parse(row.data);
  Object.assign(data, patch);
  await prisma.scenario.update({ where: { id }, data: { name, data: JSON.stringify(data) } });
  console.log(`[scenario] ${id} -> ${name}`);
}

async function updateSkillPoint(id, patch) {
  const row = await prisma.skillPoint.findUnique({ where: { id } });
  if (!row) throw new Error(`技能点不存在: ${id}`);
  const data = JSON.parse(row.data);
  Object.assign(data, patch);
  await prisma.skillPoint.update({ where: { id }, data: { data: JSON.stringify(data) } });
  console.log(`[skillPoint] ${id} 已更新`);
}

// ── 实用场景（3 个医疗版 → 教育版；「再考虑一下」推进本身无行业倾向，不动） ──
await updateScenario('scenario-first-visit', '首访破冰·焦虑家长', {
  coverageTopics: ['开场自我介绍与时间承诺', '真实提分案例引用', '效果承诺合规表述', '异议首反应', '下一步约定'],
  personaTitle: '谨慎型家长，时间只给 8 分钟',
  methodology: '张伟三步破冰法 · L2',
});
await updateScenario('scenario-price-objection', '价格异议·比价家长', {
  coverageTopics: ['价值重述', '价格异议首反应', '优惠合规边界'],
  personaTitle: '预算收紧，压价强硬',
  methodology: '价值重述应对价格异议 · L1',
});
await updateScenario('scenario-compliance', '合规效果承诺表达', {
  coverageTopics: ['效果承诺边界', '案例引用规范', '退费政策说明'],
  personaTitle: '严谨型家长，追问案例真实性',
  methodology: '效果承诺合规表达 · L3',
});

// ── 场景卡片/评分引用的技能点（id 不变，仅去医疗化文案，对齐教育种子） ──
await updateSkillPoint('sp-need', { description: '通过开放式提问识别家长真实报班需求' });
await updateSkillPoint('sp-compliance', {
  description: '严格按课程实际效果与广告合规口径表述，不承诺提分保过',
  assetName: '效果承诺合规表达',
  author: '教研部',
  source: '来自 教研部话术手册 §3.2',
});
await updateSkillPoint('sp-chain', { description: '拆解孩子/父母/祖辈多方决策链并各个击破' });

// ── 方法论（评分红线词医药版 → 教育版；skillWeights/fillerWords/passScore 不动） ──
const mc = await prisma.methodologyConfig.findUnique({ where: { id: 'methodology-demo' } });
if (mc) {
  const data = JSON.parse(mc.data);
  data.redlinePhrases = ['保证提分', '包过', '百分百考上名校', '考不上全额退款', '绝对有效果', '一夜逆袭'];
  await prisma.methodologyConfig.update({ where: { id: 'methodology-demo' }, data: { name: '课程顾问销售方法论', data: JSON.stringify(data) } });
  console.log('[methodology] methodology-demo -> 课程顾问销售方法论');
}

// ── 黄金案例（首访破冰示范对话：医疗版 → 教育版，expected 引用不变） ──
const gc = await prisma.goldenCase.findUnique({ where: { id: 'golden-case-1' } });
if (gc) {
  const data = JSON.parse(gc.data);
  data.transcript = [
    { seq: 1, speaker: 'persona', text: '你有什么事快说，我一会儿还要去接送孩子。' },
    { seq: 2, speaker: 'trainee', text: '家长您好，我是××的小林，今天只用三分钟，跟您介绍一个适合您孩子的数学思维课程。' },
    { seq: 3, speaker: 'persona', text: '又是推销课程？你们这类机构我看过太多了，提分案例都是自己编的吧。' },
    { seq: 4, speaker: 'trainee', text: '家长，我不谈所有孩子。上学期同基础学员平均提分 15 分，这是脱敏的学员档案，您先看案例再判断。' },
    { seq: 5, speaker: 'persona', text: '行，资料放这儿吧。下次带上你们的任课老师。' },
    { seq: 6, speaker: 'trainee', text: '好的，我周四下午带孩子来上试听课，任课老师当面跟您聊，半小时就够，您看方便吗？' },
  ];
  await prisma.goldenCase.update({ where: { id: 'golden-case-1' }, data: { data: JSON.stringify(data) } });
  console.log('[goldenCase] golden-case-1 对话已替换为教育版');
}

await prisma.$disconnect();
console.log('done');
