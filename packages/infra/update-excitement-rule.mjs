/**
 * 迁移 v2：彻底移除评分对「绝对响度」的依赖。
 * 背景：绝对响度由麦克风增益/距离/浏览器 AGC 决定，与学员激情无关；
 * AGC 开关会让电平基线漂移 ~10dB，导致按绝对响度计的分数剧烈波动。
 * 本次起声学分析前做电平归一化（voice-features v3），评分只保留相对量：
 * 音调变化 / 响度起伏 / 语速。
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node update-excitement-rule.mjs
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// 第五次定标（2026-11-02 晚）：改用"个人基线抬升"指标。
// 实测证据：学员平淡场 F0 中位数 136Hz、激情场 276Hz（音高抬升型激情），
// 而音调方差平淡 3.16 > 激情 2.77（方向相反），响度起伏同样反向——方差/起伏类指标对该学员失效。
// 新口径：激情度 = 音高抬升(相对个人平静基线)×2/3 + 响度提升×1/3；基线存于用户 preferences.voiceBaseline。
const F0_LIFT_POINTS = [
  { value: -1, score: 10 },
  { value: 0, score: 20 },
  { value: 2, score: 40 },
  { value: 4, score: 60 },
  { value: 6, score: 75 },
  { value: 8, score: 88 },
  { value: 10, score: 95 },
  { value: 12, score: 100 },
];
const LOUD_LIFT_POINTS = [
  { value: -3, score: 10 },
  { value: 0, score: 40 },
  { value: 2, score: 60 },
  { value: 4, score: 80 },
  { value: 6, score: 100 },
];
const RATE_POINTS = [
  { value: 120, score: 10 },
  { value: 180, score: 55 },
  { value: 240, score: 100 },
  { value: 380, score: 100 },
  { value: 420, score: 55 },
  { value: 480, score: 20 },
];

const EXCITEMENT_ANCHOR =
  '语音量化锚点（个人基线抬升口径：以学员本人平静语音的音高/响度为基线，测相对抬升；电平归一化后测量，锚点间线性插值）：' +
  '音高抬升（相对基线的半音数）——≤0=没有激情(20分)，2=略有(40)，4=中等(60)，6=较有激情(75)，8=明显激情(88)，10=很有激情(95)，≥12=激情拉满(100)；' +
  '响度提升（相对基线的dB数）——≤0=没有提升(40分)，2=略响(60)，4=明显更响(80)，≥6=全力输出(100)；' +
  '真实语速——240~380字/分钟=利落有冲劲(100分)，180~240或380~420=一般(55)，≤120=拖沓(10)，≥480=过快(20)，中间线性过渡；' +
  '表达流畅度——无明显停顿和口头禅=100分，每次明显停顿扣15分、每个口头禅扣5分，最低0分。' +
  '说明：音调方差/响度起伏不再作为激情度指标（对"持续高亢"型激情失效且受八度检测噪声污染）；绝对响度不参与计分。' +
  '未设置个人语音基线的学员，音高/响度抬升按无数据计（50分）——请先录制平静语音完成基线校准。';

const excitementRule = {
  blocks: [
    {
      label: '激情度',
      maxScore: 60,
      metrics: [
        { metric: 'f0LiftSemitones', weight: 2, points: F0_LIFT_POINTS },
        { metric: 'loudnessLiftDb', weight: 1, points: LOUD_LIFT_POINTS },
      ],
    },
    { label: '语速', maxScore: 20, metrics: [{ metric: 'speechRateCpm', points: RATE_POINTS }] },
    { label: '音调', maxScore: 10, metrics: [{ metric: 'f0LiftSemitones', points: F0_LIFT_POINTS }] },
    {
      label: '表达流畅度',
      maxScore: 10,
      metrics: [{ metric: 'fluencyScore', points: [{ value: 0, score: 0 }, { value: 100, score: 100 }] }],
    },
  ],
};

// 咨询接待「语气语调」：同样移除绝对响度块（声音温度），钟形评分改锚点插值
const RECEPTION_ANCHOR =
  '语音量化锚点（客服腔为钟形评分：中间区间最优，太平=冷漠死板、太激动=不像客服，两头都扣分；电平归一化后测量，锚点间线性插值）：' +
  '语调平稳=音调变化4~5.5半音为温和有起伏(100分)，3~4偏平(55)，≤3念经冷漠(25)，5.5~6.5偏激动(55)，≥7.5地推腔(35)；' +
  '响度动态8~14dB为平稳柔和(100分)，5~8偏平(60)，≤5死板(25)，14~17偏激动(60)，≥20起伏过大不稳(45)；' +
  '语速适中或与客户一致=普通180~260字/分钟为从容清晰吐字稳(100分)，与客户TTS语速倍率对应的匹配区间也可得100分；150~180偏慢(60)，≤150拖沓(25)，260~300偏快(60)，≥360有抢话感(30)，两种区间任一满足即取较高分。' +
  '音量（平均响度）不参与计分——它由麦克风增益和距离决定，与表现无关，仅在报告中作参考。';

const receptionRule = {
  blocks: [
    {
      label: '语调平稳',
      maxScore: 60,
      metrics: [
        {
          metric: 'pitchVarSemitones',
          weight: 1,
          points: [
            { value: 1.5, score: 25 },
            { value: 3, score: 55 },
            { value: 4, score: 100 },
            { value: 5.5, score: 100 },
            { value: 6.5, score: 55 },
            { value: 7.5, score: 35 },
          ],
        },
        {
          metric: 'loudnessRangeDb',
          weight: 1,
          points: [
            { value: 2, score: 25 },
            { value: 5, score: 60 },
            { value: 8, score: 100 },
            { value: 14, score: 100 },
            { value: 17, score: 60 },
            { value: 20, score: 45 },
          ],
        },
      ],
    },
    {
      label: '语速从容',
      maxScore: 40,
      metrics: [
        {
          metric: 'speechRateCpm',
          points: [
            { value: 100, score: 25 },
            { value: 150, score: 60 },
            { value: 180, score: 100 },
            { value: 260, score: 100 },
            { value: 300, score: 60 },
            { value: 360, score: 30 },
          ],
        },
      ],
    },
  ],
};

const defs = await prisma.scoreItemDef.findMany();
let updated = 0;
for (const d of defs) {
  const data = JSON.parse(d.data);
  if (d.name === '语速调') {
    await prisma.scoreItemDef.update({
      where: { id: d.id },
      data: { data: JSON.stringify({ ...data, behaviorAnchor: EXCITEMENT_ANCHOR, quantitativeRule: excitementRule }) },
    });
    console.log(`已更新 语速调 id=${d.id} category=${data.category ?? '(无)'}：激情度=音高抬升(2/3)+响度提升(1/3)（个人基线口径）`);
    updated++;
  } else if (d.name === '语气语调') {
    await prisma.scoreItemDef.update({
      where: { id: d.id },
      data: { data: JSON.stringify({ ...data, behaviorAnchor: RECEPTION_ANCHOR, quantitativeRule: receptionRule }) },
    });
    console.log(`已更新 语气语调 id=${d.id} category=${data.category ?? '(无)'}：语调平稳60+语速从容40（删除声音温度/绝对响度）`);
    updated++;
  }
}
console.log(`共更新 ${updated} 条评分标准`);

// 学员个人语音基线：取"毫无感情"实战场（2026-11-02 08:13，session 1e4bda2c）实测——
// 开场 F0 中位数 136Hz、整场平均响度 -36.1dBFS。后续可用新的平静录音重新校准。
const BASELINE = { medianF0Hz: 143, avgLoudnessDbfs: -36.1 };
const admin = await prisma.user.findUnique({ where: { id: 'user-admin-1' } });
if (admin) {
  const data = JSON.parse(admin.data);
  const preferences = { ...(data.preferences ?? {}), voiceBaseline: BASELINE };
  await prisma.user.update({ where: { id: admin.id }, data: { data: JSON.stringify({ ...data, preferences }) } });
  console.log(`已设置 user-admin-1 语音基线: F0=${BASELINE.medianF0Hz}Hz, 响度=${BASELINE.avgLoudnessDbfs}dBFS`);
}
await prisma.$disconnect();
