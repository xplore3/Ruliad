/**
 * 回归验证：用历史语音场次重算「语速调」得分。
 * 对比三种口径：① 旧聚合+旧bands（库里实际得分）② 旧聚合+新锚点插值 ③ 新聚合(峰值融合)+新锚点插值
 * 用法：DATABASE_URL="file:<绝对路径>/prisma/dev.db" node verify-excitement-recalibration.mjs
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const PEAK_MIN_VOICED_MS = 2000;

function scoreByPoints(points, value) {
  const sorted = [...points].sort((a, b) => a.value - b.value);
  if (value <= sorted[0].value) return sorted[0].score;
  if (value >= sorted[sorted.length - 1].value) return sorted[sorted.length - 1].score;
  for (let i = 1; i < sorted.length; i++) {
    if (value < sorted[i].value) {
      const a = sorted[i - 1];
      const b = sorted[i];
      return Math.round(a.score + ((value - a.value) / (b.value - a.value)) * (b.score - a.score));
    }
  }
  return sorted[sorted.length - 1].score;
}

function computeQuant(rule, voice) {
  let total = 0;
  const parts = [];
  for (const block of rule.blocks) {
    const scored = block.metrics.map((m) => {
      const v = voice?.[m.metric];
      return v == null ? { s: 50, v: null, w: m.weight ?? 1 } : { s: scoreByPoints(m.points, v), v, w: m.weight ?? 1 };
    });
    const tw = scored.reduce((s, p) => s + p.w, 0);
    const avg = scored.reduce((s, p) => s + p.s * p.w, 0) / tw;
    const blockScore = Math.round((avg / 100) * block.maxScore);
    total += blockScore;
    parts.push(`${block.label}${blockScore}/${block.maxScore}(${scored.map((p) => (p.v === null ? '无数据' : `${p.v}→${p.s}`)).join(',')})`);
  }
  return { total, detail: parts.join(' ') };
}

// 与 packages/scoring-engine/src/rules.ts 相同的新聚合逻辑
function aggregateVoice(voiceTurns) {
  const totalVoicedMs = voiceTurns.reduce((s, t) => s + t.voicedMs, 0);
  if (totalVoicedMs <= 0) return null;
  const wavg = (pick) => voiceTurns.reduce((s, t) => s + pick(t) * t.voicedMs, 0) / totalVoicedMs;
  const blendPeak = (pick) => {
    const mean = wavg(pick);
    const eligible = voiceTurns.filter((t) => t.voicedMs >= PEAK_MIN_VOICED_MS);
    if (!eligible.length) return mean;
    return (mean + Math.max(...eligible.map(pick))) / 2;
  };
  const pitchTurns = voiceTurns.filter((t) => t.pitchVarSemitones != null);
  const pitchMs = pitchTurns.reduce((s, t) => s + t.voicedMs, 0);
  let pitch = null;
  if (pitchMs > 0) {
    const mean = pitchTurns.reduce((s, t) => s + t.pitchVarSemitones * t.voicedMs, 0) / pitchMs;
    const eligible = pitchTurns.filter((t) => t.voicedMs >= PEAK_MIN_VOICED_MS);
    pitch = eligible.length ? (mean + Math.max(...eligible.map((t) => t.pitchVarSemitones))) / 2 : mean;
  }
  const voiceChars = voiceTurns.reduce((s, t) => s + t.textLen, 0);
  const r = (v, d = 10) => (v == null ? null : Math.round(v * d) / d);
  return {
    turns: voiceTurns.length,
    avgLoudnessDbfs: r(wavg((t) => t.avgLoudnessDbfs)),
    loudnessRangeDb: r(blendPeak((t) => t.loudnessRangeDb)),
    pitchVarSemitones: r(pitch, 100),
    speechRateCpm: Math.round(voiceChars / (totalVoicedMs / 60000)),
  };
}

// 取新规则（地推）
const defs = await prisma.scoreItemDef.findMany();
const def = defs.map((d) => ({ id: d.id, name: d.name, ...JSON.parse(d.data) })).find((d) => d.name === '语速调' && d.category === '地推');
if (!def?.quantitativeRule) throw new Error('未找到地推语速调定量规则，请先跑 update-excitement-rule.mjs');

const reports = await prisma.scoreReport.findMany({ orderBy: { createdAt: 'desc' } });
console.log('日期        旧分 | 旧聚合+新锚点 | 新聚合+新锚点 | 新聚合后的声学值');
for (const r of reports) {
  const data = JSON.parse(r.data);
  const item = (data.items ?? []).find((it) => /语速调/.test(it.itemName));
  const oldVoice = data.ruleStats?.voice;
  if (!item || !oldVoice) continue;
  const s = await prisma.session.findUnique({ where: { id: r.sessionId } });
  if (!s) continue;
  const sd = JSON.parse(s.data);
  const voiceTurns = (sd.transcript ?? [])
    .filter((t) => t.speaker === 'trainee' && t.voiceFeatures)
    .map((t) => ({ textLen: String(t.text ?? '').length, ...t.voiceFeatures }));
  if (!voiceTurns.length) continue;
  const newVoice = aggregateVoice(voiceTurns);
  const reOld = computeQuant(def.quantitativeRule, oldVoice);
  const reNew = computeQuant(def.quantitativeRule, newVoice);
  console.log(
    `${r.createdAt.toISOString().slice(0, 16)}  ${String(item.score).padStart(3)} | ${String(reOld.total).padStart(3)} | ${String(reNew.total).padStart(3)} | ` +
      `pitch=${newVoice.pitchVarSemitones} range=${newVoice.loudnessRangeDb} loud=${newVoice.avgLoudnessDbfs} rate=${newVoice.speechRateCpm}`
  );
  console.log(`      ${reNew.detail}`);
}
await prisma.$disconnect();
