/**
 * 新增评分标准「与孩子说话的语气」（地推，权重 5，voiceChannel=child）。
 * 只统计对孩子说的学员轮次（addressedToChild），要求温柔/亲和/声音小：
 *  - 音高抬升 2~5 半音 = 温柔亲和（哄孩子的正常升调）；不抬升偏冷淡；抬太多=地推腔会吓到孩子
 *  - 响度相对个人基线持平或更低 = 声音小、不训斥
 *  - 语速 160~240 字/分钟 = 温柔从容
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node add-child-tone-standard.mjs
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NAME = '与孩子说话的语气';
const existing = await prisma.scoreItemDef.findMany({ where: { name: NAME } });
if (existing.length > 0) {
  console.log('标准已存在，跳过（id=', existing[0].id, ')');
  process.exit(0);
}

const data = {
  behaviorAnchor:
    '与孩子说话的语气（只评对孩子说的轮次，与孩子音高/响度基线比较，锚点间线性插值）：' +
    '温柔亲和=音高比个人平静基线抬升2~5半音（哄孩子的自然升调）得100分；完全不抬升(≤0)=偏冷淡得40~70分；抬升8半音以上=地推腔、会吓到孩子，得20~60分；' +
    '声音小=响度比个人基线低1dB以上得100分；持平(±1dB)得75~100分；明显更响(+3dB以上)=有训斥感，得20~50分；' +
    '语速从容=160~240字/分钟得100分，240~300偏快得70分，≥360像催促得40分。' +
    '注意：本标准与地推腔（激情度）是两套相反的要求——对客户要有激情，对孩子要温柔。',
  judgePrompt:
    '本标准（与孩子说话的语气）由代码按语音量化数据确定性计分，分数不可更改。' +
    '你只做两件事：1）引用各项量化数据与对应得分，向学员解释分数怎么来的；2）若扣分，给一句更温柔的对孩子话术示范。' +
    '只评与孩子说话的轮次；不得提及本标准之外的维度；不得更改任何分数。',
  weight: 5,
  levels: [],
  isObservation: false,
  category: '地推',
  scoringMode: 'score',
  voiceChannel: 'child',
  quantitativeRule: {
    blocks: [
      {
        label: '与孩子说话的语气',
        maxScore: 100,
        metrics: [
          {
            metric: 'f0LiftSemitones',
            weight: 1,
            points: [
              { value: -2, score: 40 },
              { value: 0, score: 70 },
              { value: 2, score: 100 },
              { value: 5, score: 100 },
              { value: 8, score: 60 },
              { value: 12, score: 20 },
            ],
          },
          {
            metric: 'loudnessLiftDb',
            weight: 1,
            points: [
              { value: -4, score: 100 },
              { value: -1, score: 100 },
              { value: 1, score: 75 },
              { value: 3, score: 50 },
              { value: 6, score: 20 },
            ],
          },
          {
            metric: 'speechRateCpm',
            weight: 1,
            points: [
              { value: 100, score: 60 },
              { value: 160, score: 100 },
              { value: 240, score: 100 },
              { value: 300, score: 70 },
              { value: 360, score: 40 },
            ],
          },
        ],
      },
    ],
  },
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
console.log(`已创建「${NAME}」id=${id}（地推，权重5，voiceChannel=child）`);
await prisma.$disconnect();
