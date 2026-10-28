import { MockSpeechProvider } from './providers/mock.js';
import { AliyunSpeechProvider } from './providers/aliyun.js';
import { OpenAITTSProvider } from './providers/openai.js';
import type { SpeechGateway, TTSProvider } from './types.js';

/** 行内 logger：server.ts 传入 app.log；未传入时退到 stdout */
type DiagLogger = {
  info?: (obj: Record<string, unknown>, msg: string) => void;
  warn?: (obj: Record<string, unknown>, msg: string) => void;
};

/**
 * 创建语音网关：
 * - ASR 由 SPEECH_PROVIDER 决定：aliyun 且配置了 SPEECH_API_KEY（或 DASHSCOPE_API_KEY）走阿里百炼，
 *   其他情况走内置 Mock（离线可跑通）。OpenAI 无流式 ASR，不提供 OpenAI ASR。
 * - TTS 由 SPEECH_TTS_PROVIDER 决定（缺省跟随 SPEECH_PROVIDER）：
 *   openai 且配置了 OPENAI_API_KEY → OpenAI 兼容接口（OPENAI_BASE_URL 可指向中转）。
 */
export function createSpeechGateway(
  env: NodeJS.ProcessEnv = process.env,
  logger?: DiagLogger,
): SpeechGateway {
  const SPEECH_PROVIDER = env.SPEECH_PROVIDER;
  const SPEECH_API_KEY = env.SPEECH_API_KEY;
  const DASHSCOPE_API_KEY = env.DASHSCOPE_API_KEY;
  const providerKey = (SPEECH_PROVIDER ?? 'mock').trim().toLowerCase();
  const apiKey = SPEECH_API_KEY ?? DASHSCOPE_API_KEY;

  // 诊断：直接 dump 进 stdout，不依赖 Fastify logger 是否已初始化
  const diag = {
    'env.SPEECH_PROVIDER': SPEECH_PROVIDER ?? '(undefined)',
    'env.SPEECH_PROVIDER.len': SPEECH_PROVIDER?.length ?? 0,
    'env.SPEECH_API_KEY': SPEECH_API_KEY ? `${SPEECH_API_KEY.slice(0, 6)}...(${SPEECH_API_KEY.length}chars)` : '(undefined)',
    'env.SPEECH_TTS_PROVIDER': env.SPEECH_TTS_PROVIDER ?? '(undefined→跟随SPEECH_PROVIDER)',
    'env.OPENAI_API_KEY': env.OPENAI_API_KEY ? `${env.OPENAI_API_KEY.slice(0, 6)}...(${env.OPENAI_API_KEY.length}chars)` : '(undefined)',
    'computed.providerKey': providerKey,
    'computed.apiKey_truthy': !!apiKey,
  };
  console.log('[SpeechGateway][diag] createSpeechGateway env:', JSON.stringify(diag));
  if (logger?.info) logger.info(diag, 'SpeechGateway env 诊断');

  // ASR：仅 aliyun / mock
  let asr: SpeechGateway['asr'];
  let aliyunTTS: TTSProvider | null = null;
  if (providerKey === 'aliyun' && apiKey) {
    const aliyun = new AliyunSpeechProvider({
      apiKey,
      asrModel: env.SPEECH_ASR_MODEL ?? 'paraformer-realtime-v2',
      ttsModel: env.SPEECH_TTS_MODEL ?? 'cosyvoice-v2',
      ttsVoice: env.SPEECH_TTS_VOICE ?? 'longxiaochun_v2',
      url: env.SPEECH_WS_URL,
    });
    console.log(`[SpeechGateway][diag] → ASR selected: aliyun (key=${apiKey.slice(0, 6)}...)`);
    asr = aliyun;
    aliyunTTS = aliyun;
  } else {
    const reason = providerKey !== 'aliyun' ? 'SPEECH_PROVIDER≠aliyun' : 'SPEECH_API_KEY 为空';
    console.warn(`[SpeechGateway][WARN] → selected: mock (providerKey="${providerKey}", apiKey=${apiKey ? 'set' : 'empty'}, reason: ${reason})`);
    logger?.warn?.(
      { providerKey, reason },
      '语音网关：正在使用 Mock provider（识别/合成均为模拟输出）。配置 SPEECH_PROVIDER=aliyun 与 SPEECH_API_KEY（或 DASHSCOPE_API_KEY）可切换真实服务'
    );
    const mock = new MockSpeechProvider();
    return { asr: mock, tts: pickTTS(env, mock) };
  }

  return { asr, tts: pickTTS(env, aliyunTTS!) };
}

/** TTS 选择：SPEECH_TTS_PROVIDER=openai 且 OPENAI_API_KEY 存在 → OpenAI；否则回退默认（阿里/mock） */
function pickTTS(env: NodeJS.ProcessEnv, fallback: TTSProvider): TTSProvider {
  const ttsKey = (env.SPEECH_TTS_PROVIDER ?? '').trim().toLowerCase();
  if (ttsKey === 'openai') {
    if (!env.OPENAI_API_KEY) {
      console.log('[SpeechGateway][diag] → TTS: SPEECH_TTS_PROVIDER=openai 但 OPENAI_API_KEY 为空，回退默认 provider');
      return fallback;
    }
    console.log(
      `[SpeechGateway][diag] → TTS selected: openai (baseUrl=${env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}, model=${env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts'})`
    );
    return new OpenAITTSProvider({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
      defaultVoice: env.OPENAI_TTS_VOICE ?? 'coral',
    });
  }
  return fallback;

}
