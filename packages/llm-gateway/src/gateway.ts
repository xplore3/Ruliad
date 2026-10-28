import type { LLMGateway, LLMProvider, LLMTask } from '@grasp-mvp/core';
import { MockLLMProvider } from './providers/mock.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.js';

export interface UsageInfo {
  task: LLMTask;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** 诊断日志最小接口（Fastify logger / pino 结构兼容） */
export interface LLMDiagLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface GatewayOptions {
  /** 每次 chat 完成后触发（供事件流记录 LLM_USAGE） */
  onUsage?: (info: UsageInfo) => void;
  /** 每次 chat 调用的诊断日志（开始/完成/失败，含耗时与模型）；定位评分、对练等链路卡点 */
  logger?: LLMDiagLogger;
}

/**
 * 包装诊断日志：记录每次 LLM 调用的开始/完成/失败与耗时。
 * 若日志中只有「LLM 调用开始」而无「完成/失败」，说明底层请求挂起或耗时过长
 * （OpenAICompatibleProvider 已有超时保护：默认 60s，LLM_TIMEOUT_MS 可覆盖）。
 */
function wrapDiagLogging(
  provider: LLMProvider,
  task: LLMTask,
  logger?: LLMDiagLogger
): LLMProvider {
  if (!logger) return provider;
  return {
    name: provider.name,
    async chat(messages, options) {
      const startedAt = Date.now();
      logger.info({ task, provider: provider.name, messages: messages.length }, 'LLM 调用开始');
      try {
        const result = await provider.chat(messages, options);
        logger.info(
          {
            task,
            provider: provider.name,
            model: result.model,
            ms: Date.now() - startedAt,
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            contentLength: result.content.length,
          },
          'LLM 调用完成'
        );
        return result;
      } catch (err) {
        logger.warn(
          {
            task,
            provider: provider.name,
            ms: Date.now() - startedAt,
            err: err instanceof Error ? err.message : String(err),
          },
          'LLM 调用失败'
        );
        throw err;
      }
    },
  };
}

function wrapUsage(provider: LLMProvider, task: LLMTask, onUsage?: (info: UsageInfo) => void): LLMProvider {
  if (!onUsage) return provider;
  return {
    name: provider.name,
    async chat(messages, options) {
      const result = await provider.chat(messages, options);
      onUsage({ task, model: result.model, usage: result.usage });
      return result;
    },
  };
}

/**
 * Provider 预设：LLM_PROVIDER 风格配置的默认 baseUrl / model。
 * 对应环境变量形如 <PREFIX>_API_KEY / <PREFIX>_BASE_URL / <PREFIX>_CHAT_MODEL，
 * 例如 LLM_PROVIDER=deepseek 时读 DEEPSEEK_API_KEY 等。
 */
const PROVIDER_PRESETS: Record<string, { prefix: string; baseUrl?: string; model?: string }> = {
  deepseek: { prefix: 'DEEPSEEK', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  kimi: { prefix: 'KIMI', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  qwen: {
    prefix: 'QWEN',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  openai: { prefix: 'OPENAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  zhipu: { prefix: 'ZHIPU', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  baichuan: { prefix: 'BAICHUAN', baseUrl: 'https://api.baichuan-ai.com/v1', model: 'Baichuan4' },
  agnes: { prefix: 'AGNES' },
  custom: { prefix: 'CUSTOM' },
};

interface MainConnection {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 解析主 LLM 连接，优先级：
 * 1. LLM_PROVIDER 风格（<PREFIX>_API_KEY/BASE_URL/CHAT_MODEL，缺省用预设）
 * 2. 传统 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
 * 均未配置返回 null（全部走 Mock）。
 * 注：LLM_EMBEDDING_PROVIDER 目前保留未用（系统暂无 Embedding 场景）。
 */
function resolveMainConnection(env: NodeJS.ProcessEnv): MainConnection | null {
  const providerKey = env.LLM_PROVIDER?.trim().toLowerCase();
  if (providerKey) {
    const preset = PROVIDER_PRESETS[providerKey] ?? { prefix: providerKey.toUpperCase() };
    const apiKey = env[`${preset.prefix}_API_KEY`];
    if (apiKey) {
      return {
        apiKey,
        baseUrl: env[`${preset.prefix}_BASE_URL`] ?? preset.baseUrl ?? 'https://api.openai.com/v1',
        model: env[`${preset.prefix}_CHAT_MODEL`] ?? preset.model ?? 'gpt-4o-mini',
      };
    }
  }
  if (env.LLM_API_KEY) {
    return {
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
      model: env.LLM_MODEL ?? 'gpt-4o-mini',
    };
  }
  return null;
}

/**
 * 创建 LLM 网关：按任务类型路由到不同 provider/model。
 * - 配置 LLM_PROVIDER（+ <PREFIX>_API_KEY 等）或传统 LLM_API_KEY：走 OpenAI 兼容协议；
 *   judge_secondary 尽量用独立模型（防自评偏倚）
 * - 未配置：全部任务路由到 MockLLMProvider（离线可跑通）
 */
export function createLLMGateway(
  env: NodeJS.ProcessEnv = process.env,
  options: GatewayOptions = {}
): LLMGateway {
  const providers = new Map<LLMTask, LLMProvider>();
  const tasks: LLMTask[] = ['actor', 'judge', 'judge_secondary', 'extractor', 'video_judge'];

  // ---- 诊断：启动时 dump LLM 链路选择 ----
  const LLM_PROVIDER = env.LLM_PROVIDER;
  const DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY;
  const LLM_API_KEY = env.LLM_API_KEY;
  const llmDiag = {
    'env.LLM_PROVIDER': LLM_PROVIDER ?? '(undefined)',
    'env.LLM_API_KEY': LLM_API_KEY ? `${LLM_API_KEY.slice(0, 6)}...(${LLM_API_KEY.length}chars)` : '(undefined)',
    'env.DEEPSEEK_API_KEY': DEEPSEEK_API_KEY ? `${DEEPSEEK_API_KEY.slice(0, 6)}...(${DEEPSEEK_API_KEY.length}chars)` : '(undefined)',
  };
  console.log('[LLMGateway][diag] createLLMGateway env:', JSON.stringify(llmDiag));
  if (options.logger?.info) options.logger.info(llmDiag, 'LLM Gateway env 诊断');

  const main = resolveMainConnection(env);
  // 请求超时：默认 60s（provider 内默认值），LLM_TIMEOUT_MS 可覆盖（非法值忽略）
  const parsedTimeout = Number(env.LLM_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : undefined;
  if (main) {
    console.log(`[LLMGateway][diag] → selected: real provider (baseUrl=${main.baseUrl}, model=${main.model}, key=${main.apiKey.slice(0, 6)}...)`);
    if (options.logger?.info) options.logger.info({ baseUrl: main.baseUrl, model: main.model, keyPrefix: main.apiKey.slice(0, 6) }, 'LLM Gateway: 使用真实 provider');
    const baseUrl = main.baseUrl;
    const fallbackModel = main.model;

    const mainProvider = (model?: string) =>
      new OpenAICompatibleProvider({
        apiKey: main.apiKey,
        baseUrl,
        model: model ?? fallbackModel,
        timeoutMs,
      });

    providers.set('actor', mainProvider(env.LLM_MODEL_ACTOR));
    providers.set('judge', mainProvider(env.LLM_MODEL_JUDGE));
    providers.set('extractor', mainProvider(env.LLM_MODEL_EXTRACTOR));
    // 视频评审：需视觉模型（如 qwen-vl-plus）；未单独配置时回退主模型（非视觉模型会在调用时失败，由调用方兜底跳过）
    providers.set('video_judge', mainProvider(env.LLM_MODEL_VIDEO_JUDGE));

    // 双 judge 仲裁：secondary 必须是不同模型/独立配置，防自评偏倚
    if (env.LLM_SECONDARY_API_KEY) {
      providers.set(
        'judge_secondary',
        new OpenAICompatibleProvider({
          apiKey: env.LLM_SECONDARY_API_KEY,
          baseUrl: env.LLM_SECONDARY_BASE_URL ?? baseUrl,
          model: env.LLM_MODEL_JUDGE_SECONDARY ?? env.LLM_MODEL ?? main.model,
          timeoutMs,
        })
      );
    } else if (env.LLM_MODEL_JUDGE_SECONDARY) {
      providers.set('judge_secondary', mainProvider(env.LLM_MODEL_JUDGE_SECONDARY));
    } else {
      providers.set('judge_secondary', providers.get('judge')!);
    }
  } else {
    console.warn('[LLMGateway][WARN] → selected: mock (LLM_PROVIDER 未配置 或 对应 API_KEY 为空；文字对话将无法真正调用大模型)');
    if (options.logger?.warn) {
      options.logger.warn(
        {},
        'LLM Gateway: 正在使用 Mock provider，文字对话/评分不会真正调用大模型。配置 LLM_PROVIDER 与对应 <PREFIX>_API_KEY（如 DEEPSEEK_API_KEY），或传统 LLM_API_KEY，可切换真实服务'
      );
    }
    const mock = new MockLLMProvider();
    for (const task of tasks) providers.set(task, mock);
  }

  return {
    forTask(task: LLMTask): LLMProvider {
      const provider = providers.get(task);
      if (!provider) throw new Error(`no provider for task: ${task}`);
      return wrapUsage(wrapDiagLogging(provider, task, options.logger), task, options.onUsage);
    },
  };
}
