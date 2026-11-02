/**
 * 录音离线核查：node analyze-recording.mjs <wav文件路径>
 * 输出整体声学特征 + 音调轨迹诊断（有效帧率/八度跳变/滤波前后方差），
 * 用于判定"音调变化"是真实起伏还是检测器噪声。
 */
import { readFileSync } from 'node:fs';
const { analyzePcm16, wavToPcm } = await import('file:///D:/Git/ccc/ruliad/packages/api-gateway/dist/services/voice-features.js');

const file = process.argv[2];
if (!file) throw new Error('用法: node analyze-recording.mjs <wav文件>');
const buf = readFileSync(file);
const sampleRate = buf.toString('ascii', 0, 4) === 'RIFF' ? buf.readUInt32LE(24) : 16000;
const pcm = wavToPcm(buf);
console.log(`文件: ${file} | ${sampleRate}Hz | ${(pcm.length / 2 / sampleRate).toFixed(1)}s`);
console.log('整体特征:', JSON.stringify(analyzePcm16(pcm, sampleRate)));

// ---- 逐帧音调轨迹（与 voice-features 相同算法） ----
const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
const winLen = Math.floor(sampleRate * 0.04);
const hopLen = Math.floor(sampleRate * 0.02);
const F0_MIN = 60, F0_MAX = 500;
function pitchOfFrame(start) {
  let energy = 0;
  for (let i = 0; i < winLen; i++) energy += (samples[start + i] / 32768) ** 2;
  if (Math.sqrt(energy / winLen) < 0.004) return null;
  const minLag = Math.floor(sampleRate / F0_MAX);
  const maxLag = Math.min(Math.floor(sampleRate / F0_MIN), winLen - 1);
  let bestLag = 0, bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0, n1 = 0, n2 = 0;
    const n = winLen - lag;
    for (let i = 0; i < n; i++) {
      const a = samples[start + i], b = samples[start + i + lag];
      sum += a * b; n1 += a * a; n2 += b * b;
    }
    const corr = Math.sqrt(n1 * n2) > 0 ? sum / Math.sqrt(n1 * n2) : 0;
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  return bestLag ? { f0: sampleRate / bestLag, clarity: bestCorr } : null;
}

const frames = [];
for (let start = 0; start + winLen <= samples.length; start += hopLen) {
  const r = pitchOfFrame(start);
  if (r && r.clarity >= 0.6) frames.push({ ms: Math.round((start / sampleRate) * 1000), f0: Math.round(r.f0), clarity: Math.round(r.clarity * 100) / 100 });
}
const totalFrames = Math.floor((samples.length - winLen) / hopLen);
const midis = frames.map((f) => 69 + 12 * Math.log2(f.f0 / 440));
const std = (arr) => {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
};
const octaveJumps = midis.filter((m, i) => i > 0 && Math.abs(m - midis[i - 1]) > 9).length;
console.log(`音调帧: 有效 ${frames.length}/${totalFrames} (${Math.round((frames.length / totalFrames) * 100)}%)`);
if (midis.length > 1) {
  console.log(`原始半音标准差: ${std(midis).toFixed(2)} | 相邻帧八度跳变(>9半音): ${octaveJumps} 次`);
  const sorted = [...midis].sort((a, b) => a - b);
  console.log(`F0 分布: min=${Math.round(440 * 2 ** ((sorted[0] - 69) / 12))} p50=${Math.round(440 * 2 ** ((sorted[Math.floor(sorted.length / 2)] - 69) / 12))} max=${Math.round(440 * 2 ** ((sorted[sorted.length - 1] - 69) / 12))} Hz`);
}
console.log('轨迹（每 200ms 抽样: 时间ms F0Hz clarity）:');
for (let i = 0; i < frames.length; i += 10) {
  const f = frames[i];
  console.log(`  ${f.ms} ${f.f0} ${f.clarity}`);
}
