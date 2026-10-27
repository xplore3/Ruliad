// 语音 WS 链路 E2E（真实 aliyun ASR/TTS + deepseek LLM）：
// 1) 用 /sessions/:id/tts 合成真人语音 2) 重采样到 16k 实时喂给 ASR，连说两遍模拟"一直说话"
// 3) 说话中不得出现 reply_text/turn_complete（不自动断句） 4) finish 后完整落回合
import WebSocket from 'ws';
import http from 'node:http';

const BASE = 'http://localhost:3060/api/v1';

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf-8');
    const req = http.request(BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: { raw: raw.slice(0, 200) } }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const fails = [];
const check = (name, cond, extra = '') => {
  console.log(cond ? 'PASS' : 'FAIL', name, extra);
  if (!cond) fails.push(name);
};

// 解析 WAV（PCM16 mono）→ 线性插值重采样到 16kHz
function wavToPcm16k(wav) {
  // 找 data 块
  let off = 12, dataOff = 44, dataLen = wav.length - 44, rate = 22050;
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === 'fmt ') rate = wav.readUInt32LE(off + 12);
    if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size;
  }
  const n = Math.min(Math.floor(dataLen / 2), Math.floor((wav.length - dataOff) / 2));
  const outLen = Math.floor(n * 16000 / rate);
  const out = Buffer.alloc(outLen * 2);
  for (let i = 0; i < outLen; i++) {
    const src = i * rate / 16000;
    const lo = Math.floor(src), hi = Math.min(lo + 1, n - 1);
    const f = src - lo;
    const v = wav.readInt16LE(dataOff + lo * 2) * (1 - f) + wav.readInt16LE(dataOff + hi * 2) * f;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2);
  }
  return out;
}

// 1. 注册 + 建会话
const reg = await post('/auth/register', { username: 'e2e_ws' + Date.now(), name: 'WS', password: '123456' });
const token = reg.body.token;
const sess = await post('/sessions', { scenarioId: 'scenario-first-visit', mode: 'practice' }, token);
check('create session', sess.status === 201, String(sess.status));
const sid = sess.body.session.id;

// 2. 合成测试语音
const tts = await post(`/sessions/${sid}/tts`, { text: '你好，我想了解一下这个课程具体怎么收费，有没有优惠。' }, token);
check('tts synthesize', tts.status === 200 && !!tts.body.audioBase64, String(tts.status));
const speechPcm = wavToPcm16k(Buffer.from(tts.body.audioBase64, 'base64'));
console.log('   speech pcm bytes:', speechPcm.length, '(', (speechPcm.length / 3200).toFixed(1), 's )');

// 3. 连接语音 WS
const ws = new WebSocket(`ws://localhost:3060/api/v1/sessions/${sid}/voice?token=${encodeURIComponent(token)}`);
const events = [];
ws.on('message', (data, isBinary) => { if (!isBinary) events.push({ ...JSON.parse(data.toString()), _at: Date.now() }); });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

// 4. start + 实时喂音频，连说两遍（模拟用户一直说话，中间不停）
ws.send(JSON.stringify({ type: 'start' }));
const CHUNK = 3200; // 100ms
const totalLen = speechPcm.length * 2;
let sent = 0;
let finishedAt = 0;
while (sent < totalLen) {
  const off = sent % speechPcm.length;
  ws.send(speechPcm.subarray(off, Math.min(off + CHUNK, speechPcm.length)));
  sent += CHUNK;
  await new Promise((r) => setTimeout(r, 100));
  // 说完第一遍后停顿检查：不应出现回合收尾事件
  if (sent === speechPcm.length) {
    const mid = events.map((e) => e.type);
    check('说了一遍后无 reply_text/turn_complete（未自动断句）',
      !mid.includes('reply_text') && !mid.includes('turn_complete'),
      JSON.stringify([...new Set(mid)]));
  }
}
const duringTalk = [...new Set(events.map((e) => e.type))];
check('持续说话全程无 reply_text/turn_complete',
  !duringTalk.includes('reply_text') && !duringTalk.includes('turn_complete'),
  JSON.stringify(duringTalk));
check('持续说话中收到 asr_partial（识别在累积）', duringTalk.includes('asr_partial'), JSON.stringify(duringTalk));

// 5. finish → 完整回合
ws.send(JSON.stringify({ type: 'finish' }));
finishedAt = Date.now();
const waitFor = (pred, ms) => new Promise((res, rej) => {
  const t1 = Date.now();
  const tick = () => {
    if (events.some(pred)) return res(true);
    if (Date.now() - t1 > ms) return rej(new Error('timeout'));
    setTimeout(tick, 100);
  };
  tick();
});
try { await waitFor((e) => e.type === 'turn_complete', 45000); }
catch { check('turn_complete received', false, '45s timeout'); }
ws.close();

const types = events.map((e) => e.type);
const iFinal = types.indexOf('asr_final');
const iReply = types.indexOf('reply_text');
const iTts = types.findIndex((t) => t === 'tts_sentence' || t === 'tts_chunk');
const iTtsEnd = types.indexOf('tts_end');
const iDone = types.indexOf('turn_complete');
check('asr_final 在 finish 后出现', iFinal >= 0);
check('顺序 asr_final → reply_text → tts → tts_end → turn_complete',
  iFinal >= 0 && iReply > iFinal && iTts > iReply && iTtsEnd > iTts && iDone > iTtsEnd,
  JSON.stringify(types.filter((t) => t !== 'asr_partial')));
const tc = events.find((e) => e.type === 'turn_complete');
const traineeText = tc?.turn?.traineeTurn?.text ?? '';
const personaText = tc?.turn?.personaTurn?.text ?? '';
console.log('   ASR 识别结果:', traineeText);
console.log('   persona 回复:', personaText.slice(0, 60));
check('ASR 识别出有效文本（非空）', traineeText.trim().length >= 4);
check('persona 回复非空', personaText.length > 0);
const ttsCount = types.filter((t) => t === 'tts_sentence').length;
check('TTS 按句全部下发（≥1 句，turn_complete 在最后）', ttsCount >= 1 && iDone === types.length - 1, `tts_sentence x${ttsCount}`);

console.log();
console.log('RESULT:', fails.length ? `${fails.length} FAILED: ${fails}` : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
