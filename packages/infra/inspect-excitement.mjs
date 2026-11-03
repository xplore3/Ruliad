import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const reports = await prisma.scoreReport.findMany({ orderBy: { createdAt: 'desc' } });
const rows = [];
for (const r of reports) {
  const data = JSON.parse(r.data);
  const item = (data.items ?? []).find((it) => /语速调|激情/.test(it.itemName));
  const v = data.ruleStats?.voice;
  if (!item || !v || v.pitchVarSemitones == null) continue;
  rows.push({ date: r.createdAt.toISOString().slice(0, 10), score: item.score, ...v });
}
console.log(`有效样本（含声学数据）: ${rows.length} / ${reports.length}`);

const dist = (vals, bins) => {
  const counts = bins.map(() => 0);
  for (const v of vals) {
    for (let i = 0; i < bins.length; i++) {
      const [lo, hi] = bins[i];
      if ((lo === null || v >= lo) && (hi === null || v < hi)) { counts[i]++; break; }
    }
  }
  return counts;
};

const pitchBins = [[null,4],[4,5],[5,6],[6,7],[7,null]];
const rangeBins = [[null,7],[7,10],[10,13],[13,16],[16,20],[20,null]];
const loudBins = [[null,-31],[-31,-28],[-28,-25],[-25,-22],[-22,null]];
const fmt = (bins, counts, labels) =>
  bins.map((_, i) => `${labels[i]}=${counts[i]}(${(counts[i] / rows.length * 100).toFixed(0)}%)`).join(' ');

console.log('\npitchVar 分布（半音）:');
console.log('  ' + fmt(pitchBins, dist(rows.map(r=>r.pitchVarSemitones), pitchBins), ['<4','4-5','5-6','6-7','≥7']));
console.log('loudnessRange 分布（dB）:');
console.log('  ' + fmt(rangeBins, dist(rows.map(r=>r.loudnessRangeDb), rangeBins), ['<7','7-10','10-13','13-16','16-20','≥20']));
console.log('avgLoudness 分布（dBFS）:');
console.log('  ' + fmt(loudBins, dist(rows.map(r=>r.avgLoudnessDbfs), loudBins), ['<-31','-31~-28','-28~-25','-25~-22','≥-22']));

// 语速调得分分布
const scoreBins = [[null,50],[50,60],[60,70],[70,80],[80,90],[90,null]];
console.log('语速调总分分布:');
console.log('  ' + fmt(scoreBins, dist(rows.map(r=>r.score), scoreBins), ['<50','50-60','60-70','70-80','80-90','≥90']));

// 高分样本的声学数据长什么样
const top = rows.filter(r => r.score >= 80).slice(0, 10);
console.log(`\n高分(≥80)样本 ${rows.filter(r=>r.score>=80).length} 条，最近10条:`);
for (const r of top) console.log(`  ${r.date} score=${r.score} pitch=${r.pitchVarSemitones} range=${r.loudnessRangeDb} loud=${r.avgLoudnessDbfs} rate=${r.speechRateCpm} turns=${r.turns}`);

// 最近10条样本
console.log('\n最近10条:');
for (const r of rows.slice(0, 10)) console.log(`  ${r.date} score=${r.score} pitch=${r.pitchVarSemitones} range=${r.loudnessRangeDb} loud=${r.avgLoudnessDbfs} rate=${r.speechRateCpm} turns=${r.turns}`);
await prisma.$disconnect();
