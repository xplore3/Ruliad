/** LLM 网关接口：多模型路由，judge 与演员分离 */

/** 多模态内容片段（OpenAI 兼容协议）：文本或图片（URL / data URL） */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** 纯文本用 string；多模态（图文混排）用 ContentPart[] */
  content: string | ContentPart[];
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 强制 JSON 输出 */
  jsonMode?: boolean;
}

export interface ChatResult {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** 任务类型：路由到不同模型；judge_realtime 用于对练回复的低延迟审查，video_judge 路由到视觉模型 */
export type LLMTask = 'actor' | 'judge' | 'judge_realtime' | 'judge_secondary' | 'extractor' | 'video_judge';

export type ChatDeltaHandler = (delta: string, content: string) => void;

export interface LLMProvider {
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  /** 可选流式输出；provider 不支持时调用方回退 chat */
  chatStream?(messages: ChatMessage[], options?: ChatOptions, onDelta?: ChatDeltaHandler): Promise<ChatResult>;
}

export interface LLMGateway {
  /** 按任务类型路由到对应 provider */
  forTask(task: LLMTask): LLMProvider;
}
