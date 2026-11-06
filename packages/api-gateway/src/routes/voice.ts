import type { FastifyInstance } from 'fastify';
import type { ASRStream, TTSOptions } from '@grasp-mvp/speech-gateway';
import type { RouteContext } from '../ctx.js';
import { tokenFailReason, verifyToken } from '../auth.js';
import { runTurn } from '../services/turn.js';
import { analyzePcm16, wavToPcm } from '../services/voice-features.js';
import { saveTurnRecording } from '../services/recording.js';

/** WebSocket 关闭码说明（仅日志用，与客户端保持同步） */
function describeCloseCode(code: number): string {
  switch (code) {
    case 1000: return '正常关闭';
    case 1001: return '终端离开';
    case 1006: return '异常断开（握手被拒 / 网络中断 / Nginx 未透传 WS 头常见此码）';
    case 4401: return '鉴权失败（token 缺失或过期）';
    default: return `未知(${code})`;
  }
}

// ---------- VAD（语音活动检测）：基于 PCM 能量的静音检测 ----------
/** PCM16 音频能量（RMS） */
function pcmRMS(buf: Buffer): number {
  const n = Math.floor(buf.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / n) / 32768;
}

/** VAD 配置 */
const VAD_SILENCE_MS = 2500; // 允许说话中的自然停顿，避免 1 秒静音就把本轮截断
const VAD_CHUNK_MS = 100; // 每 100ms 检测一次

/** VAD 自适应阈值范围与噪声倍率：AGC 关闭后不同麦克风的原始电平差异大，
 * 固定阈值会把轻声说话误判为静音（话说到一半被切断）。按近期静音块估计噪声底并随之浮动。 */
const VAD_MIN_THRESHOLD = 0.003;
const VAD_MAX_THRESHOLD = 0.015;
const VAD_NOISE_MULTIPLIER = 2;

export function createAdaptiveVad() {
  let noiseFloor = 0.004;
  return {
    /** 当前语音判定阈值（噪声底 ×2，钳制在 0.003~0.015），兼顾轻声发言 */
    threshold(): number {
      return Math.min(VAD_MAX_THRESHOLD, Math.max(VAD_MIN_THRESHOLD, noiseFloor * VAD_NOISE_MULTIPLIER));
    },
    /** 输入一个音频块 RMS，返回是否语音；非语音块慢速更新噪声底，避免把轻声发言学成噪声 */
    isSpeech(rms: number): boolean {
      if (rms > this.threshold()) return true;
      noiseFloor = Math.max(0.0015, noiseFloor * 0.999 + rms * 0.001);
      return false;
    },
  };
}

/** 回复按句号/问号/感叹号等切句（保留标点），供逐句 TTS 边合成边播 */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^。？！；!?\n]+[。？！；!?]*/g)?.filter((s) => s.trim()) ?? [];
  return parts.length > 0 ? parts : [text];
}

/** 'audio/wav; codecs=1' → 'wav'；取不到时回退 'pcm' */
function formatFromMime(mime: string | undefined): string {
  const f = (mime ?? '').toLowerCase().replace(/^audio\//, '').split(';')[0].trim();
  return f || 'pcm';
}

/**
 * 解析 TTS 音色参数，三级回退：新手指引流程配置 voiceProfile → 人设 voiceProfile → provider 全局默认。
 * 字段口径（两种 VoiceProfile 结构不同，保守映射）：
 * - voice（音色名）只在人设 voiceProfile 里，guidance 的 VoiceProfile 无此字段，始终取自人设；
 * - excitement / rate：guidance 配了就覆盖人设（人设 voiceProfile 是自由 Record，仅取数字字段）；
 * - guidance.style / arousal：TTSOptions 无 style 字段；arousal 由每轮情绪快照实时传入，均不在此合并。
 */
export async function personaVoice(
  store: RouteContext['store'],
  scenarioId: string,
  personaConfigId: string,
  log?: { info(obj: object, msg: string): void }
): Promise<Pick<TTSOptions, 'voice' | 'excitement' | 'rate'>> {
  const persona = await store.getPersonaConfig(personaConfigId);
  const guidance = await store.getScenarioGuidance(scenarioId).catch(() => undefined);

  const pv = persona?.voiceProfile ?? {};
  const voice = typeof pv.voice === 'string' && pv.voice ? pv.voice : undefined;
  const personaExcitement = typeof pv.excitement === 'number' ? pv.excitement : undefined;
  const personaRate = typeof pv.rate === 'number' ? pv.rate : undefined;

  const gv = guidance?.voiceProfile;
  const profile = {
    voice,
    excitement: gv?.excitement ?? personaExcitement,
    rate: gv?.rate ?? personaRate,
  };
  log?.info(
    {
      personaConfigId,
      personaName: persona?.name,
      age: persona?.age,
      occupation: persona?.occupation,
      voiceProfile: persona?.voiceProfile ?? null,
      guidanceVoiceProfile: gv ?? null,
      voiceUsed: voice ?? '(全局默认)',
    },
    'TTS 说话人属性'
  );
  return profile;
}

/**
 * 语音对练路由：
 * - POST /sessions/:id/voice-turn  一期批量：音频进 → ASR → runTurn → TTS → JSON（含 base64 音频）
 * - GET  /sessions/:id/voice       二期流式：WebSocket，PCM16 二进制帧进，asr/tts 事件出
 */
export async function voiceRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, speech } = ctx;

  // audio/* raw body 按 Buffer 收下（multipart 由 @fastify/multipart 处理）
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // 一期：语音批量回合
  app.post<{ Params: { id: string } }>('/sessions/:id/voice-turn', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session) return reply.code(404).send({ error: '会话不存在' });
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });

    // 支持两种音频上传方式：multipart/form-data 文件字段，或 Content-Type: audio/* 的 raw body
    let audio: Buffer | undefined;
    let format = 'pcm';
    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'multipart 请求缺少音频文件字段' });
      audio = await file.toBuffer();
      format = formatFromMime(file.mimetype);
    } else if (Buffer.isBuffer(request.body) && request.body.length > 0) {
      audio = request.body;
      format = formatFromMime(request.headers['content-type']);
    }
    if (!audio || audio.length === 0) {
      return reply.code(400).send({ error: '缺少音频：用 multipart/form-data 上传文件，或以 Content-Type: audio/* 直传' });
    }

    const userText = (await speech.asr.transcribe(audio, format)).trim();
    if (!userText) return reply.code(422).send({ error: '未识别到有效语音' });

    // 声学特征提取：响度/起伏/音调变化/说话时长，随学员轮入库供评分量化判定（失败不影响回合）
    const pcm = wavToPcm(audio);
    if (pcm) saveTurnRecording(session.id, pcm);
    const voiceFeatures = pcm ? analyzePcm16(pcm) ?? undefined : undefined;

    const scenario = await store.getScenario(session.scenarioId);
    if (!scenario) return reply.code(500).send({ error: '场景缺失' });
    // 整段 TTS 预合成与 runTurn 内的语义一致性审查并行（warmup 只服务家长主应答轮）
    const warmupProfile = await personaVoice(store, scenario.id, scenario.personaConfigId, request.log);
    const result = await runTurn(ctx, session, scenario, userText, voiceFeatures, (text) =>
      speech.tts.synthesize(text, warmupProfile).catch(() => null)
    );
    if (!result) return reply.code(500).send({ error: '场景对应的 persona 配置缺失' });

    const isChildReply = !result.personaTurn && !!result.childTurn;
    const mainReplyText = (result.personaTurn ?? result.childTurn)?.text ?? '';
    const tts = result.warmupAudio
      ? { audio: result.warmupAudio, format: result.warmupFormat ?? 'wav' }
      : await speech.tts.synthesize(mainReplyText, {
          arousal: isChildReply ? undefined : result.arousal ?? undefined,
          voice: isChildReply ? ROLE_VOICES.child : warmupProfile.voice,
          excitement: warmupProfile.excitement,
          rate: warmupProfile.rate,
        });
    // 双场制切场旁白：用旁白音色合成（失败不阻断回合）
    let narratorAudioBase64: string | undefined;
    if (result.narratorTurn) {
      narratorAudioBase64 = (
        await speech.tts.synthesize(result.narratorTurn.text, { voice: ROLE_VOICES.narrator }).catch(() => null)
      )?.audio.toString('base64');
    }
    // 孩子作答：用儿童音色合成（失败不阻断回合；孩子主应答轮已由主链路合成，跳过）
    let childAudioBase64: string | undefined;
    if (result.childTurn && !isChildReply) {
      childAudioBase64 = (
        await speech.tts.synthesize(result.childTurn.text, { voice: ROLE_VOICES.child }).catch(() => null)
      )?.audio.toString('base64');
    }

    return {
      userText,
      replyText: mainReplyText,
      audioBase64: tts.audio.toString('base64'),
      audioFormat: tts.format,
      narratorAudioBase64,
      childAudioBase64,
      turn: {
        traineeTurn: result.traineeTurn,
        personaTurn: result.personaTurn,
        narratorTurn: result.narratorTurn,
              childTurn: result.childTurn,
        remainingSeconds: result.remainingSeconds,
        timeUp: result.timeUp,
        pendingQuizzes: result.pendingQuizzes,
      },
      emotion: { arousal: result.arousal, bandKey: result.bandKey },
    };
  });

  // 六题语调测试的单题回答：只做 ASR 与声学分析并保存学员轮，不调用客户 LLM
  app.post<{ Params: { id: string } }>('/sessions/:id/fluency-test-answer', async (request, reply) => {
    const session = await store.getSession(request.params.id);
    if (!session || session.userId !== request.userId) return reply.code(404).send({ error: '会话不存在' });
    if (session.status !== 'active') return reply.code(409).send({ error: '会话已结束' });
    const answeredCount = session.transcript.filter((turn) => turn.speaker === 'trainee').length;
    if (answeredCount >= 6) return reply.code(409).send({ error: '六题已全部回答，请提交评分' });

    let audio: Buffer | undefined;
    let format = 'pcm';
    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'multipart 请求缺少音频文件字段' });
      audio = await file.toBuffer();
      format = formatFromMime(file.mimetype);
    } else if (Buffer.isBuffer(request.body) && request.body.length > 0) {
      audio = request.body;
      format = formatFromMime(request.headers['content-type']);
    }
    if (!audio || audio.length === 0) {
      return reply.code(400).send({ error: '缺少音频：用 multipart/form-data 上传文件，或以 Content-Type: audio/* 直传' });
    }

    const userText = (await speech.asr.transcribe(audio, format)).trim();
    if (!userText) return reply.code(422).send({ error: '未识别到有效语音' });
    const pcm = wavToPcm(audio);
    if (pcm) saveTurnRecording(session.id, pcm);
    const voiceFeatures = pcm ? analyzePcm16(pcm) ?? undefined : undefined;
    const traineeTurn = {
      seq: session.transcript.length + 1,
      speaker: 'trainee' as const,
      text: userText,
      at: new Date().toISOString(),
      ...(voiceFeatures ? { voiceFeatures } : {}),
    };
    await store.updateSession(session.id, { transcript: [...session.transcript, traineeTurn] });
    return { userText, answeredCount: answeredCount + 1, total: 6 };
  });

  /** TTS 说话角色：persona=按人设音色（默认，兼容现状）；coach/sales/narrator/child=指引模式固定音色 */
  type VoiceRole = 'persona' | 'coach' | 'sales' | 'narrator' | 'child';
  // 指引模式各角色的固定音色（与 persona 常用默认 longxiaochun_v2 区分开）；
  // mock speech 忽略音色参数，aliyun 未知音色会报错——这里选的都是官方音色。
  // sales 用 CosyVoice v3 音色 longanhuan（欢脱元气女，v3 模型表现力更强；provider 按音色代际自动路由到 v3 系模型）
  const ROLE_VOICES: Record<Exclude<VoiceRole, 'persona'>, string> = {
    coach: 'longshu_v2',
    sales: 'longanhuan',
    narrator: 'longhua_v2',
    child: 'longhuhu_v3',
  };

  // 开场白/文字模式回复的服务端 TTS：按 persona 音色合成任意文本（与 voice-turn 回复同一声音）；
  // voiceRole 为 coach/sales/narrator/child 时用指引模式固定音色（示范对话各角色区分）
  app.post<{ Params: { id: string }; Body: { text?: string; arousal?: number; excitement?: number; voiceRole?: VoiceRole; rate?: number } }>(
    '/sessions/:id/tts',
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session) return reply.code(404).send({ error: '会话不存在' });
      const text = (request.body?.text ?? '').trim();
      if (!text) return reply.code(400).send({ error: '缺少 text' });
      if (text.length > 500) return reply.code(400).send({ error: 'text 过长' });
      const voiceRole = request.body?.voiceRole ?? 'persona';
      if (!['persona', 'coach', 'sales', 'narrator', 'child'].includes(voiceRole)) {
        return reply.code(400).send({ error: 'voiceRole 只能是 persona / coach / sales / narrator / child' });
      }
      const rate = request.body?.rate;
      if (rate !== undefined && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0.5 || rate > 2)) {
        return reply.code(400).send({ error: 'rate 只能是 0.5~2.0 的数字' });
      }
      const scenario = await store.getScenario(session.scenarioId);
      if (!scenario) return reply.code(500).send({ error: '场景缺失' });
      // 试听端点：请求显式传入的 excitement/rate 优先于场景/人设配置
      const ttsProfile: Pick<TTSOptions, 'voice' | 'excitement' | 'rate'> =
        voiceRole === 'persona'
          ? await personaVoice(store, scenario.id, scenario.personaConfigId, request.log)
          : { voice: ROLE_VOICES[voiceRole] };
      const tts = await speech.tts.synthesize(text, {
        voice: ttsProfile.voice,
        arousal: request.body?.arousal,
        excitement: request.body?.excitement ?? ttsProfile.excitement,
        rate: rate ?? ttsProfile.rate,
      });
      return { audioBase64: tts.audio.toString('base64'), audioFormat: tts.format };
    }
  );

  // 二期：语音流式回合（WebSocket）。token 经 query 传入（浏览器 WS 无法带 header），在此校验
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/sessions/:id/voice',
    { websocket: true },
    (socket, req) => {
      const token = req.query.token;
      const payload = token ? verifyToken(token) : null;
      if (!payload) {
        req.log.warn(
          {
            sessionId: req.params.id,
            hasToken: !!token,
            tokenFailReason: token ? tokenFailReason(token) : '缺少 token',
          },
          'voice WS 鉴权失败，关闭连接（4401）'
        );
        socket.close(4401, '未登录或登录已过期');
        return;
      }
      const sessionId = req.params.id;
      req.log.info({ sessionId, userId: payload.userId, provider: speech.asr.name }, 'voice WS 已建立');

      // 每连接只允许一轮未完成的 ASR/TTS 流程：round 单调递增，过期轮次的异步回调一律丢弃
      let round = 0;
      let asrStream: ASRStream | null = null;
      let speaking = false; // ASR 流已建立、尚未出最终结果
      let processing = false; // asr_final 已出、runTurn/回复处理中
      let ttsPlaying = false;
      /** 本轮最新识别文本（句末结果为累计全量，阶段结果包含最后半句） */
      let latestText = '';
      let latestIsFinal = false;
      /** 本轮上行音频块（PCM16），回合落库前做声学特征提取 */
      let audioChunks: Buffer[] = [];
      /** 客户端已点「结束本轮」：等 ASR 收尾后统一落回合，说话中不做自动断句 */
      let clientFinish = false;
      let finishing = false;

      const send = (msg: Record<string, unknown>) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      };

      /** 终止当前轮（打断/新轮覆盖/断连清理），返回是否有进行中的流程 */
      const cancelRound = (): boolean => {
        const active = speaking || processing || ttsPlaying;
        round++;
        speaking = false;
        processing = false;
        ttsPlaying = false;
        latestText = '';
        latestIsFinal = false;
        audioChunks = [];
        clientFinish = false;
        finishing = false;
        if (asrStream) {
          asrStream.close();
          asrStream = null;
        }
        return active;
      };

      const handleFinal = async (myRound: number, text: string) => {
        speaking = false;
        if (myRound !== round) return;
        const userText = text.trim();
        if (!userText) {
          send({ type: 'error', message: '未识别到有效语音' });
          return;
        }
        processing = true;
        const fail = (message: string) => {
          processing = false;
          send({ type: 'error', message });
        };
        try {
          const session = await store.getSession(sessionId);
          if (!session) return fail('会话不存在');
          if (session.status !== 'active') return fail('会话已结束');
          if (session.pausedAt) return fail('会话已暂停，请先继续');
          const scenario = await store.getScenario(session.scenarioId);
          if (!scenario) return fail('场景缺失');

          console.log(`[VoiceCall][trace] calling runTurn: sessionId=${sessionId} userText="${userText.slice(0, 40)}"`);
          // 声学特征提取（本轮上行 PCM）：失败不影响回合；原始录音留存供离线核查
          const uplink = audioChunks.length > 0 ? Buffer.concat(audioChunks) : undefined;
          if (uplink) saveTurnRecording(sessionId, uplink);
          const voiceFeatures = uplink ? analyzePcm16(uplink) ?? undefined : undefined;
          // 首句 TTS 预合成与 runTurn 内的语义一致性审查并行（warmup 只服务家长主应答轮）
          const warmupProfile = await personaVoice(store, scenario.id, scenario.personaConfigId, req.log);
          const result = await runTurn(ctx, session, scenario, userText, voiceFeatures, (text) => {
            const first = splitSentences(text)[0];
            return first ? speech.tts.synthesize(first, warmupProfile) : Promise.resolve(null);
          });
          console.log(`[VoiceCall][trace] runTurn returned: ${result ? `ok reply="${(result.personaTurn ?? result.childTurn)?.text.slice(0, 40)}..."` : 'NULL'}`);
          if (!result) return fail('场景对应的 persona 配置缺失');
          if (myRound !== round) {
            console.log('[VoiceCall][trace] runTurn done but round changed, aborting');
            return;
          }
          processing = false;

          const isChildReply = !result.personaTurn && !!result.childTurn;
          const replyText = (result.personaTurn ?? result.childTurn)?.text ?? '';
          console.log(`[VoiceCall][trace] sending reply_text: "${replyText.slice(0, 60)}" (${replyText.length} chars)`);
          send({ type: 'reply_text', text: replyText });

          // 逐句合成逐句发：客户端收到即可开始播放，实现边合成边播
          ttsPlaying = true;
          const ttsProfile = isChildReply
            ? { voice: ROLE_VOICES.child }
            : await personaVoice(store, scenario.id, scenario.personaConfigId, req.log);
          const sentences = splitSentences(replyText);
          for (let seq = 0; seq < sentences.length; seq++) {
            if (myRound !== round) return; // 被打断
            try {
              // 首句命中预合成（与语义审查并行完成的）直接用，无需再等 TTS
              if (seq === 0 && result.warmupAudio) {
                send({ type: 'tts_sentence', seq, audio: result.warmupAudio.toString('base64'), format: result.warmupFormat });
                continue;
              }
              const tts = await speech.tts.synthesize(sentences[seq], {
                arousal: isChildReply ? undefined : result.arousal ?? undefined,
                ...ttsProfile,
              });
              if (myRound !== round) return;
              send({ type: 'tts_sentence', seq, audio: tts.audio.toString('base64'), format: tts.format });
            } catch (ttsErr) {
              // 单句合成失败：跳过该句继续后续句子，避免整轮回复剩余部分全部丢失
              req.log.warn(
                { sessionId, seq, sentence: sentences[seq].slice(0, 30), err: ttsErr instanceof Error ? ttsErr.message : String(ttsErr) },
                'voice 单句 TTS 合成失败，跳过该句'
              );
            }
          }
          // 孩子作答：家长提问后、接在家长台词之后用儿童音色播（孩子主应答轮已由上面主链路播放，跳过）
          let extraSeq = sentences.length;
          if (result.childTurn && !isChildReply) {
            try {
              const childTts = await speech.tts.synthesize(result.childTurn.text, { voice: ROLE_VOICES.child });
              if (myRound !== round) return;
              send({ type: 'tts_sentence', seq: extraSeq++, audio: childTts.audio.toString('base64'), format: childTts.format });
            } catch (ttsErr) {
              req.log.warn(
                { sessionId, err: ttsErr instanceof Error ? ttsErr.message : String(ttsErr) },
                'voice 孩子作答 TTS 合成失败，跳过'
              );
            }
          }
          // 双场制切场旁白：接在 persona 回复之后用旁白音色播（失败不阻断回合）
          if (result.narratorTurn) {
            try {
              const narratorTts = await speech.tts.synthesize(result.narratorTurn.text, { voice: ROLE_VOICES.narrator });
              if (myRound !== round) return;
              send({ type: 'tts_sentence', seq: extraSeq++, audio: narratorTts.audio.toString('base64'), format: narratorTts.format });
            } catch (ttsErr) {
              req.log.warn(
                { sessionId, err: ttsErr instanceof Error ? ttsErr.message : String(ttsErr) },
                'voice 切场旁白 TTS 合成失败，跳过'
              );
            }
          }
          ttsPlaying = false;
          send({ type: 'tts_end' });
          send({
            type: 'turn_complete',
            turn: {
              traineeTurn: result.traineeTurn,
              personaTurn: result.personaTurn,
              narratorTurn: result.narratorTurn,
              childTurn: result.childTurn,
              remainingSeconds: result.remainingSeconds,
              timeUp: result.timeUp,
              pendingQuizzes: result.pendingQuizzes,
            },
            emotion: { arousal: result.arousal, bandKey: result.bandKey },
          });
        } catch (err) {
          if (myRound !== round) return;
          processing = false;
          ttsPlaying = false;
          console.error('[voice handleFinal] 异常:', err instanceof Error ? err.message : String(err), err instanceof Error ? err.stack : '');
          send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      };

      /** 客户端结束本轮：汇总识别文本，发 asr_final 并落回合（幂等） */
      const doFinish = (myRound: number) => {
        if (myRound !== round || finishing) return;
        finishing = true;
        send({ type: 'asr_final', text: latestText });
        void handleFinal(myRound, latestText);
      };

      const startASR = () => {
        if (cancelRound()) send({ type: 'tts_cancelled' });
        const myRound = round;
        speaking = true;
        asrStream = speech.asr.createStream({
          onPartial: (text) => {
            if (myRound !== round) return;
            latestText = text;
            latestIsFinal = false;
            send({ type: 'asr_partial', text });
          },
          // paraformer 句末会多次回调（累计文本）：用户一直说话时不自动断句、不收尾，
          // 只刷新字幕；只有客户端点了「结束本轮」（clientFinish）才真正落回合
          onFinal: (text) => {
            if (myRound !== round) return;
            latestText = text;
            latestIsFinal = true;
            send({ type: 'asr_partial', text });
            if (clientFinish) doFinish(myRound);
          },
          onFinished: () => {
            if (myRound !== round) return;
            if (clientFinish) doFinish(myRound);
          },
          onError: (err) => {
            if (myRound !== round) return;
            req.log.warn({ sessionId, err: err.message, provider: speech.asr.name }, 'voice WS ASR 流错误');
            speaking = false;
            send({ type: 'error', message: `ASR：${err.message}` });
          },
        });
      };

      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          // 音频块：PCM16 LE 16kHz mono。未在说话状态（含 TTS 播放中）则视为新一轮开始
          // 注意：processing 为 true 时说明 runTurn 进行中，不应被新音频打断，忽略之
          if (!speaking && !processing) startASR();
          asrStream?.write(data);
          audioChunks.push(data);
          return;
        }
        let msg: { type?: string };
        try {
          msg = JSON.parse(data.toString());
        } catch {
          send({ type: 'error', message: '无法解析的消息（期望 JSON 文本帧或二进制音频帧）' });
          return;
        }
        switch (msg.type) {
          case 'start':
            if (!processing) startASR();
            break;
          case 'finish':
            // 用户一直说话时不自动断句：仅在客户端明确结束本轮时收尾
            clientFinish = true;
            if (asrStream && latestIsFinal) {
              // 句末已确认且之后没有阶段文本，无需等待 task-finished
              asrStream.close();
              asrStream = null;
              doFinish(round);
            } else if (asrStream) {
              asrStream.finish();
            } else {
              doFinish(round);
            }
            break;
          case 'interrupt':
            if (cancelRound()) send({ type: 'tts_cancelled' });
            break;
          default:
            send({ type: 'error', message: `未知消息类型: ${msg.type ?? '(空)'}` });
        }
      });

      socket.on('close', (code: number, reason: Buffer) => {
        req.log.info({ sessionId, code, reason: reason?.toString() ?? '' }, 'voice WS 关闭');
        cancelRound();
      });
      socket.on('error', (err: Error) => {
        req.log.warn({ sessionId, err: err.message }, 'voice WS 错误');
        cancelRound();
      });
    }
  );

  // 三期：实时语音通话（全双工 WebSocket）。token 经 query 传入。
  // 客户端持续发送 PCM16 音频流，服务端 VAD 自动检测断句 → ASR → runTurn → 流式 TTS → 自动恢复监听。
  // 用户开口说话时自动打断 TTS 播放，实现类似电话的连续对话体验。
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/sessions/:id/voice-call',
    { websocket: true },
    (socket, req) => {
      const handlerStartedAt = Date.now();
      const token = req.query.token;
      const payload = token ? verifyToken(token) : null;
      if (!payload) {
        req.log.warn(
          {
            sessionId: req.params.id,
            hasToken: !!token,
            tokenFailReason: token ? tokenFailReason(token) : '缺少 token',
          },
          'voice-call WS 鉴权失败，关闭连接（4401）'
        );
        socket.close(4401, '未登录或登录已过期');
        return;
      }
      const sessionId = req.params.id;
      req.log.info(
        {
          sessionId,
          userId: payload.userId,
          provider: speech.asr.name,
          remoteAddress: req.ip,
          handlerMs: Date.now() - handlerStartedAt,
        },
        'voice-call WS 已建立（handler 入口）'
      );

      let round = 0;
      let asrStream: ASRStream | null = null;
      let listening = false; // 正在监听用户说话（ASR 流已建立）
      let processing = false; // runTurn 处理中
      let ttsPlaying = false; // TTS 播放中
      let ttsAborted = false; // TTS 被用户打断
      let closed = false;
      let receivedAudio = false; // 已收到首块麦克风音频（日志用）
      let startMsgReceived = false; // 客户端是否发来 'start'
      let listeningCount = 0; // startListening 被调用次数（诊断用）
      let audioMsgCount = 0; // 收到音频块总数（诊断用）

      // VAD 状态
      const vad = createAdaptiveVad(); // 本连接级自适应 VAD（噪声底随环境浮动）
      let vadBuffer: Buffer[] = []; // 累积音频块
      let roundAudio: Buffer[] = []; // 本轮全部上行音频（供回合落库前声学特征提取）
      let vadSilenceStart = 0; // 静音开始时间戳（0 = 未在静音）
      let vadHasSpeech = false; // 本轮检测到过语音
      let latestText = '';
      let latestIsFinal = false;
      let finishRequested = false;
      let finalHandled = false;

      const send = (msg: Record<string, unknown>) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      };

      /** 停止当前 ASR 流 */
      const stopASR = () => {
        if (asrStream) {
          asrStream.close();
          asrStream = null;
        }
        listening = false;
      };

      const completeASR = (myRound: number, text: string) => {
        if (myRound !== round || finalHandled) return;
        finalHandled = true;
        send({ type: 'asr_final', text });
        void handleUserSpeech(myRound, text);
      };

      /** 终止当前轮（打断/断连清理） */
      const cancelAll = (): boolean => {
        const active = listening || processing || ttsPlaying;
        round++;
        listening = false;
        processing = false;
        ttsPlaying = false;
        ttsAborted = true;
        stopASR();
        vadBuffer = [];
        roundAudio = [];
        vadSilenceStart = 0;
        vadHasSpeech = false;
        latestText = '';
        latestIsFinal = false;
        finishRequested = false;
        finalHandled = false;
        return active;
      };

      /** 通话接通后自动播放开场白问候（如"喂，您好"），然后恢复监听 */
      const playGreeting = async () => {
        if (closed || processing || ttsPlaying) {
          console.log(`[VoiceCall][greeting] SKIP: closed=${closed} processing=${processing} ttsPlaying=${ttsPlaying}`);
          return;
        }
        const myRound = round;
        processing = true;
        console.log(`[VoiceCall][greeting] ENTER: round=${myRound}`);
        try {
          const session = await store.getSession(sessionId);
          if (!session || myRound !== round) {
            console.log(`[VoiceCall][greeting] ABORT: session=${!!session} myRound=${myRound} round=${round}`);
            return;
          }
          if (session.status !== 'active') {
            console.log(`[VoiceCall][greeting] ABORT: session.status=${session.status}`);
            return;
          }
          const scenario = await store.getScenario(session.scenarioId);
          if (!scenario) {
            console.log(`[VoiceCall][greeting] ABORT: no scenario for ${session.scenarioId}`);
            return;
          }

          // 用一条内部触发消息让 AI 生成自然的接听开场白
          console.log(`[VoiceCall][greeting] calling runTurn with __SYSTEM_GREETING__`);
          const result = await runTurn(
            ctx,
            session,
            scenario,
            '__SYSTEM_GREETING__'
          );
          console.log(`[VoiceCall][greeting] runTurn returned: result=${!!result} myRound=${myRound} round=${round}`);
          if (!result || myRound !== round) return;
          processing = false;

          const replyText = result.personaTurn?.text ?? '';
          console.log(`[VoiceCall][greeting] replyText="${replyText.slice(0, 60)}" length=${replyText.length}`);
          send({ type: 'reply_text', text: replyText });

          // 流式 TTS 播放开场白
          ttsPlaying = true;
          ttsAborted = false;
          const ttsProfile = await personaVoice(store, scenario.id, scenario.personaConfigId, req.log);
          console.log(`[VoiceCall][greeting] voice=${ttsProfile.voice ?? '(default)'}`);
          const sentences = splitSentences(replyText);
          console.log(`[VoiceCall][greeting] sentences=${sentences.length}: ${JSON.stringify(sentences.map(s => s.slice(0, 30)))}`);
          let seq = 0;
          for (const sentence of sentences) {
            if (myRound !== round || ttsAborted || closed) {
              console.log(`[VoiceCall][greeting] TTS loop ABORT: myRound=${myRound} round=${round} ttsAborted=${ttsAborted} closed=${closed}`);
              return;
            }
            console.log(`[VoiceCall][greeting] synthesizing seq=${seq}: "${sentence.slice(0, 40)}"`);
            try {
              let chunkCount = 0;
              let totalBytes = 0;
              for await (const chunk of speech.tts.synthesizeStream(sentence, {
                arousal: result.arousal ?? undefined,
                ...ttsProfile,
              })) {
                if (myRound !== round || ttsAborted || closed) return;
                chunkCount++;
                totalBytes += chunk.audio.length;
                if (chunk.audio.length > 0) {
                  send({
                    type: 'tts_chunk',
                    seq,
                    audio: chunk.audio.toString('base64'),
                    format: chunk.format,
                    isFinal: chunk.isFinal,
                  });
                }
                if (chunk.isFinal) seq++;
              }
              console.log(`[VoiceCall][greeting] stream done seq=${seq}: chunks=${chunkCount} bytes=${totalBytes}`);
            } catch (streamErr) {
              console.warn(`[VoiceCall][greeting] stream FAILED, fallback to synthesize: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`);
              if (myRound !== round || ttsAborted || closed) return;
              try {
                const tts = await speech.tts.synthesize(sentence, {
                  arousal: result.arousal ?? undefined,
                  ...ttsProfile,
                });
                console.log(`[VoiceCall][greeting] fallback synthesize done: bytes=${tts.audio.length}`);
                if (myRound !== round || ttsAborted || closed) return;
                send({
                  type: 'tts_chunk',
                  seq,
                  audio: tts.audio.toString('base64'),
                  format: tts.format,
                  isFinal: true,
                });
                seq++;
              } catch (fallbackErr) {
                // 单句合成失败：跳过该句继续后续句子，避免整轮回复剩余部分丢失
                req.log.warn(
                  { sessionId, seq, err: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) },
                  'voice-call 开场白单句 TTS 合成失败，跳过该句'
                );
                seq++;
              }
            }
          }

          if (myRound !== round) return;
          ttsPlaying = false;
          send({ type: 'tts_end' });
          send({
            type: 'turn_complete',
            turn: {
              traineeTurn: result.traineeTurn,
              personaTurn: result.personaTurn,
              remainingSeconds: result.remainingSeconds,
              timeUp: result.timeUp,
              pendingQuizzes: result.pendingQuizzes,
            },
            emotion: { arousal: result.arousal, bandKey: result.bandKey },
          });
          console.log(`[VoiceCall][greeting] DONE: greeting played and turn_complete sent`);

          // 开场白播放完毕后自动恢复监听
          if (!closed) {
            setTimeout(() => { if (!closed) startListening(); }, 300);
          }
        } catch (err) {
          if (myRound !== round) return;
          processing = false;
          ttsPlaying = false;
          console.error('[VoiceCall][greeting] FATAL:', err instanceof Error ? err.message : String(err), err instanceof Error ? err.stack : '');
          req.log.warn(
            { sessionId, err: err instanceof Error ? err.message : String(err) },
            'voice-call 开场白生成失败，恢复监听'
          );
          if (!closed) startListening();
        }
      };

      /** 开始监听用户说话 */
      const startListening = () => {
        if (listening || processing || ttsPlaying || closed) {
          req.log.info(
            { sessionId, listening, processing, ttsPlaying, closed, listeningCount },
            'voice-call startListening 被跳过（当前状态不满足条件）'
          );
          return;
        }
        cancelAll();
        listeningCount++;
        const myRound = round;
        listening = true;
        vadHasSpeech = false;
        vadSilenceStart = 0;
        vadBuffer = [];
        req.log.info(
          { sessionId, round: myRound, provider: speech.asr.name, listeningCount },
          'voice-call 开始创建 ASR 流（startListening）'
        );
        asrStream = speech.asr.createStream({
          onPartial: (text) => {
            if (myRound !== round) return;
            latestText = text;
            latestIsFinal = false;
            send({ type: 'asr_partial', text });
          },
          onFinal: (text) => {
            if (myRound !== round) return;
            latestText = text;
            latestIsFinal = true;
            if (finishRequested) completeASR(myRound, text);
            else send({ type: 'asr_partial', text });
          },
          onFinished: () => {
            if (myRound === round && finishRequested) completeASR(myRound, latestText);
          },
          onError: (err) => {
            if (myRound !== round) return;
            req.log.warn(
              { sessionId, err: err.message, provider: speech.asr.name },
              'voice-call ASR 流错误（500ms 后自动恢复监听）'
            );
            listening = false;
            send({ type: 'error', message: `ASR：${err.message}` });
            // 出错后自动恢复监听
            setTimeout(() => { if (!closed) startListening(); }, 500);
          },
        });
        send({ type: 'listening' });
      };

      /** VAD 处理：检测到静音后自动 finish ASR */
      const processVAD = () => {
        if (!listening || closed || finishRequested) return;

        // 将累积的音频拼成一块做 VAD 检测
        const buf = Buffer.concat(vadBuffer);
        vadBuffer = [];

        const rms = pcmRMS(buf);
        if (vad.isSpeech(rms)) {
          // 检测到语音
          vadHasSpeech = true;
          vadSilenceStart = 0;
        } else if (vadHasSpeech) {
          // 之前有语音，现在静音
          if (vadSilenceStart === 0) {
            vadSilenceStart = Date.now();
          }
          const silenceMs = Date.now() - vadSilenceStart;
          if (silenceMs >= VAD_SILENCE_MS) {
            finishRequested = true;
            // 已有句末结果且之后没有新的阶段文本时可直接提交，无需再等识别流关闭
            if (latestIsFinal) completeASR(round, latestText);
            else asrStream?.finish();
          }
        }
      };

      /** 定时器：每 VAD_CHUNK_MS 毫秒执行一次 VAD 检测 */
      const vadTimer = setInterval(processVAD, VAD_CHUNK_MS);

      /** 用户说完一句话：ASR 最终结果 → runTurn → 流式 TTS → 自动恢复监听 */
      const handleUserSpeech = async (myRound: number, text: string) => {
        const stepStartedAt = Date.now();
        console.log(`[VoiceCall][trace] handleUserSpeech ENTER: round=${myRound} currentRound=${round} text="${text.slice(0, 40)}"`);
        listening = false;
        stopASR();
        if (myRound !== round) {
          console.log(`[VoiceCall][trace] handleUserSpeech SKIP: round mismatch (myRound=${myRound} vs current=${round})`);
          return;
        }
        const userText = text.trim();
        if (!userText) {
          console.log('[VoiceCall][trace] handleUserSpeech: empty text, skip');
          send({ type: 'error', message: '未识别到有效语音' });
          setTimeout(() => { if (!closed) startListening(); }, 300);
          return;
        }
        processing = true;
        console.log(`[VoiceCall][trace] handleUserSpeech: userText="${userText.slice(0, 60)}" → starting business logic (ms=${Date.now() - stepStartedAt})`);
        const fail = (message: string) => {
          processing = false;
          req.log.warn(
            { sessionId, message, userText: userText.slice(0, 50) },
            'voice-call 本轮处理失败（500ms 后自动恢复监听）'
          );
          send({ type: 'error', message });
          // 出错后自动恢复监听
          setTimeout(() => { if (!closed) startListening(); }, 500);
        };
        try {
          const session = await store.getSession(sessionId);
          if (!session) return fail('会话不存在');
          if (session.status !== 'active') return fail('会话已结束');
          if (session.pausedAt) return fail('会话已暂停，请先继续');
          const scenario = await store.getScenario(session.scenarioId);
          if (!scenario) return fail('场景缺失');

          console.log(`[VoiceCall][trace] calling runTurn: sessionId=${sessionId} userText="${userText.slice(0, 40)}"`);
          // 声学特征提取（本轮上行 PCM）：失败不影响回合
          const voiceFeatures = roundAudio.length > 0
            ? analyzePcm16(Buffer.concat(roundAudio)) ?? undefined
            : undefined;
          // 首句 TTS 预合成与 runTurn 内的语义一致性审查并行（warmup 只服务家长主应答轮）
          const warmupProfile = await personaVoice(store, scenario.id, scenario.personaConfigId, req.log);
          const result = await runTurn(ctx, session, scenario, userText, voiceFeatures, (text) => {
            const first = splitSentences(text)[0];
            return first ? speech.tts.synthesize(first, warmupProfile) : Promise.resolve(null);
          });
          console.log(`[VoiceCall][trace] runTurn returned: ${result ? `ok reply="${(result.personaTurn ?? result.childTurn)?.text.slice(0, 40)}..."` : 'NULL'}`);
          if (!result) return fail('场景对应的 persona 配置缺失');
          if (myRound !== round) {
            console.log('[VoiceCall][trace] runTurn done but round changed, aborting');
            return;
          }
          processing = false;

          const isChildReply = !result.personaTurn && !!result.childTurn;
          const replyText = (result.personaTurn ?? result.childTurn)?.text ?? '';
          console.log(`[VoiceCall][trace] sending reply_text: "${replyText.slice(0, 60)}" (${replyText.length} chars)`);
          send({ type: 'reply_text', text: replyText });

          // 流式 TTS：逐句合成，使用 synthesizeStream 分块发送
          ttsPlaying = true;
          ttsAborted = false;
          const ttsProfile = isChildReply
            ? { voice: ROLE_VOICES.child }
            : await personaVoice(store, scenario.id, scenario.personaConfigId, req.log);
          const sentences = splitSentences(replyText);
          let seq = 0;

          // 首句命中预合成（与语义审查并行完成的）直接发送，该句无需再流式合成
          if (result.warmupAudio && sentences.length > 0) {
            send({ type: 'tts_chunk', seq, audio: result.warmupAudio.toString('base64'), format: result.warmupFormat, isFinal: true });
            seq++;
          }
          for (const sentence of sentences.slice(result.warmupAudio ? 1 : 0)) {
            if (myRound !== round || ttsAborted || closed) return;
            // 使用流式 TTS：音频分块即到即发
            try {
              for await (const chunk of speech.tts.synthesizeStream(sentence, {
                arousal: isChildReply ? undefined : result.arousal ?? undefined,
                ...ttsProfile,
              })) {
                if (myRound !== round || ttsAborted || closed) return;
                if (chunk.audio.length > 0) {
                  send({
                    type: 'tts_chunk',
                    seq,
                    audio: chunk.audio.toString('base64'),
                    format: chunk.format,
                    isFinal: chunk.isFinal,
                  });
                }
                if (chunk.isFinal) seq++;
              }
            } catch {
              // 流式失败：回退非流式
              if (myRound !== round || ttsAborted || closed) return;
              try {
                const tts = await speech.tts.synthesize(sentence, {
                  arousal: isChildReply ? undefined : result.arousal ?? undefined,
                  ...ttsProfile,
                });
                if (myRound !== round || ttsAborted || closed) return;
                send({
                  type: 'tts_chunk',
                  seq,
                  audio: tts.audio.toString('base64'),
                  format: tts.format,
                  isFinal: true,
                });
                seq++;
              } catch (fallbackErr) {
                // 单句合成失败：跳过该句继续后续句子，避免整轮回复剩余部分丢失
                req.log.warn(
                  { sessionId, seq, err: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) },
                  'voice-call 单句 TTS 合成失败，跳过该句'
                );
                seq++;
              }
            }
          }

          if (myRound !== round) return;
          // 孩子作答：家长提问后、接在家长台词之后用儿童音色播（孩子主应答轮已由上面主链路播放，跳过）
          if (result.childTurn && !isChildReply) {
            try {
              const childTts = await speech.tts.synthesize(result.childTurn.text, { voice: ROLE_VOICES.child });
              if (myRound !== round) return;
              send({ type: 'tts_chunk', seq, audio: childTts.audio.toString('base64'), format: childTts.format, isFinal: true });
              seq++;
            } catch (ttsErr) {
              req.log.warn(
                { sessionId, err: ttsErr instanceof Error ? ttsErr.message : String(ttsErr) },
                'voice-call 孩子作答 TTS 合成失败，跳过'
              );
            }
          }
          // 双场制切场旁白：接在 persona 回复之后用旁白音色播（失败不阻断回合）
          if (result.narratorTurn) {
            try {
              const narratorTts = await speech.tts.synthesize(result.narratorTurn.text, { voice: ROLE_VOICES.narrator });
              if (myRound !== round) return;
              send({ type: 'tts_chunk', seq, audio: narratorTts.audio.toString('base64'), format: narratorTts.format, isFinal: true });
              seq++;
            } catch (ttsErr) {
              req.log.warn(
                { sessionId, err: ttsErr instanceof Error ? ttsErr.message : String(ttsErr) },
                'voice-call 切场旁白 TTS 合成失败，跳过'
              );
            }
          }
          ttsPlaying = false;
          send({ type: 'tts_end' });
          send({
            type: 'turn_complete',
            turn: {
              traineeTurn: result.traineeTurn,
              personaTurn: result.personaTurn,
              narratorTurn: result.narratorTurn,
              childTurn: result.childTurn,
              remainingSeconds: result.remainingSeconds,
              timeUp: result.timeUp,
              pendingQuizzes: result.pendingQuizzes,
            },
            emotion: { arousal: result.arousal, bandKey: result.bandKey },
          });

          // TTS 播放完毕：自动恢复监听
          if (!closed) {
            setTimeout(() => { if (!closed) startListening(); }, 300);
          }
        } catch (err) {
          if (myRound !== round) return;
          processing = false;
          ttsPlaying = false;
          req.log.error(
            {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            },
            'voice-call 本轮处理异常（500ms 后自动恢复监听）'
          );
          send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
          setTimeout(() => { if (!closed) startListening(); }, 500);
        }
      };

      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (closed) return;
        if (isBinary) {
          audioMsgCount++;
          if (!receivedAudio) {
            receivedAudio = true;
            req.log.info(
              { sessionId, bytes: data.length },
              'voice-call 收到首块麦克风音频（采集链路正常）'
            );
            console.log(`[VoiceCall][trace] first audio chunk #${audioMsgCount}: ${data.length}bytes isTTS=${ttsPlaying} isList=${listening} isProc=${processing}`);
          }
          if (audioMsgCount <= 5 || audioMsgCount % 20 === 0) {
            console.log(`[VoiceCall][trace] audio #${audioMsgCount}: ${data.length}bytes isTTS=${ttsPlaying} isList=${listening} isProc=${processing} asrStream=${!!asrStream}`);
          }
          // 二进制音频块：PCM16 LE 16kHz mono
          // TTS 播放中：检测到明显语音能量才视为用户插话打断；低能量噪声/回声直接忽略，
          // 否则持续推流的首块音频（甚至扬声器回声）会立刻掐断 TTS；阈值随噪声底自适应
          if (ttsPlaying) {
            const rms = pcmRMS(data);
            if (rms > vad.threshold() * 2) {
              cancelAll();
              send({ type: 'tts_cancelled' });
              // 打断的这块音频含有效语音，继续走下面的 ASR 流程
            } else {
              return; // 忽略低能量噪声
            }
          }

          if (!listening && !processing) {
            startListening();
          }

          if (listening && asrStream) {
            asrStream.write(data);
            // 同时累积到 VAD buffer 与本轮特征提取 buffer
            vadBuffer.push(data);
            roundAudio.push(data);
          }
          return;
        }

        // 文本消息
        let msg: { type?: string };
        try {
          msg = JSON.parse(data.toString());
        } catch {
          send({ type: 'error', message: '无法解析的消息' });
          return;
        }
        switch (msg.type) {
          case 'start':
            // 客户端请求开始通话
            startMsgReceived = true;
            req.log.info(
              { sessionId, listeningCount, hasAsrStream: !!asrStream },
              'voice-call 收到客户端 start 消息：触发开场白问候 playGreeting()'
            );
            void playGreeting();
            break;
          case 'stop':
            // 客户端请求停止通话
            req.log.info({ sessionId }, 'voice-call 收到 stop：结束通话');
            cancelAll();
            send({ type: 'stopped' });
            break;
          case 'interrupt':
            if (cancelAll()) send({ type: 'tts_cancelled' });
            break;
          default:
            send({ type: 'error', message: `未知消息类型: ${msg.type ?? '(空)'}` });
        }
      });

      socket.on('close', (code: number, reason: Buffer) => {
        closed = true;
        clearInterval(vadTimer);
        cancelAll();
        const diag = {
          sessionId,
          closeCode: code,
          closeCodeDesc: describeCloseCode(code),
          reason: reason?.toString() ?? '',
          receivedAudio,
          audioMsgCount,
          startMsgReceived,
          listeningCount,
          wasListening: listening,
          wasProcessing: processing,
          wasTtsPlaying: ttsPlaying,
        };
        // 特别标记：WS 建立后从未收到 start 消息 = 客户端连上后直接连接失败
        if (!startMsgReceived) {
          req.log.warn(
            diag,
            'voice-call WS 关闭（从未收到客户端 start 消息 → 客户端可能在 WS onopen 前就失败，或 token/路由问题）'
          );
        } else {
          req.log.info(diag, 'voice-call WS 关闭（含会话诊断摘要）');
        }
      });
      socket.on('error', (err: Error) => {
        closed = true;
        clearInterval(vadTimer);
        cancelAll();
        req.log.warn({ sessionId, err: err.message }, 'voice-call WS 错误');
      });
    }
  );
}
