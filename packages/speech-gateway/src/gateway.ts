import { MockSpeechProvider } from './providers/mock.js';
import { AliyunSpeechProvider } from './providers/aliyun.js';
import type { SpeechGateway } from './types.js';

/** 行内 logger：server.ts 传入 app.log；未传入时退到 stdout */
type DiagLogger = { info?: (obj: Record<string, unknown>, msg: string) => void };

/**
 * 创建语音网关：
 * - SPEECH_PROVIDER=aliyun 且配置了 SPEECH_API_KEY（或 DASHSCOPE_API_KEY）：走阿里百炼 DashScope；
 * - 其他情况（含 SPEECH_PROVIDER 缺省、aliyun 无 key）：走内置 Mock（离线可跑通）。
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
    'env.SPEECH_PROVIDER.type': typeof SPEECH_PROVIDER,
    'env.SPEECH_PROVIDER.len': SPEECH_PROVIDER?.length ?? 0,
    'env.SPEECH_PROVIDER.bytes': SPEECH_PROVIDER ? Buffer.from(SPEECH_PROVIDER).toString('hex') : '(none)',
    'env.SPEECH_API_KEY': SPEECH_API_KEY ? `${SPEECH_API_KEY.slice(0, 6)}...(${SPEECH_API_KEY.length}chars)` : '(undefined)',
    'env.DASHSCOPE_API_KEY': DASHSCOPE_API_KEY ? `${DASHSCOPE_API_KEY.slice(0, 6)}...(${DASHSCOPE_API_KEY.length}chars)` : '(undefined)',
    'computed.providerKey': providerKey,
    'computed.apiKey_truthy': !!apiKey,
  };
  console.log('[SpeechGateway][diag] createSpeechGateway env:', JSON.stringify(diag));
  if (logger?.info) logger.info(diag, 'SpeechGateway env 诊断');

  if (providerKey === 'aliyun' && apiKey) {
    const aliyun = new AliyunSpeechProvider({
      apiKey,
      asrModel: env.SPEECH_ASR_MODEL ?? 'paraformer-realtime-v2',
      ttsModel: env.SPEECH_TTS_MODEL ?? 'cosyvoice-v2',
      ttsVoice: env.SPEECH_TTS_VOICE ?? 'longxiaochun_v2',
      url: env.SPEECH_WS_URL,
    });
    console.log(`[SpeechGateway][diag] → selected: aliyun (key=${apiKey.slice(0, 6)}...)`);
    return { asr: aliyun, tts: aliyun };
  }

  console.log(`[SpeechGateway][diag] → selected: mock (providerKey="${providerKey}", apiKey=${apiKey ? 'set' : 'empty'}, reason: ${providerKey !== 'aliyun' ? 'SPEECH_PROVIDER≠aliyun' : 'SPEECH_API_KEY 为空'})`);
  const mock = new MockSpeechProvider();
  return { asr: mock, tts: mock };
}
