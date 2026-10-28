import type { ChatMessage, ChatOptions, ChatResult, LLMProvider } from '@grasp-mvp/core';

/** 内容哈希：保证 mock 输出确定性 */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pick<T>(arr: T[], seed: string): T {
  return arr[hash(seed) % arr.length];
}

/** 提取消息的纯文本部分（多模态 content 只取 text 片段，图片忽略） */
function textOf(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

export type MockHandler = (messages: ChatMessage[], options?: ChatOptions) => string;

/** 学员发言中的负面/违规信号词（judge 启发式用） */
const NEGATIVE_WORDS = ['打折', '降价', '不知道', '随便', '保证提分', '包过', '绝对有效果'];

/**
 * 离线确定性 provider：无 API Key 时全系统可跑通。
 * 同一输入永远返回同一输出，供演示与测试。
 */
export class MockLLMProvider implements LLMProvider {
  name = 'mock';

  constructor(private handler?: MockHandler) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const content = this.handler
      ? this.handler(messages, options)
      : defaultHandler(messages, options);
    return { content, model: 'mock-model', usage: { promptTokens: 0, completionTokens: 0 } };
  }
}

function defaultHandler(messages: ChatMessage[], options?: ChatOptions): string {
  if (options?.jsonMode) {
    return mockJudgeJson(messages.map(textOf).join('\n'));
  }
  return mockActorReply(messages);
}

/** judge 场景：从 prompt 提取候选档位 key，按启发式选择，返回合法 JSON */
function mockJudgeJson(prompt: string): string {
  const keys = [...prompt.matchAll(/"key"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  let levelKey: string;
  if (keys.length === 0) {
    levelKey = 'unknown';
  } else if (NEGATIVE_WORDS.some((w) => prompt.includes(w))) {
    // 约定：levels 按分数升序，第一个为最低档
    levelKey = keys[0];
  } else {
    levelKey = keys[hash(prompt) % keys.length];
  }
  const seqMatch = prompt.match(/\[(\d+)\]\s*学员[：:]([^\n]+)/);
  const quote = seqMatch ? seqMatch[2].trim().slice(0, 80) : '（未定位到原文）';
  const quoteTurnSeq = seqMatch ? Number(seqMatch[1]) : 1;
  // 约定：levels 按分数升序，最后一个为最高档；最高档（无扣分）给空串
  const betterScript =
    keys.length > 0 && levelKey === keys[keys.length - 1]
      ? ''
      : '先认可您的顾虑，再说明我们能提供的保障，您看好吗？';
  return JSON.stringify({
    levelKey,
    quote,
    quoteTurnSeq,
    rationale: `mock 判定：基于启发式选择档位 ${levelKey}`,
    betterScript,
  });
}

/** actor 场景：简短中文客户口吻回复，随行为指令与学员发言变化 */
function mockActorReply(messages: ChatMessage[]): string {
  const system = textOf(messages.find((m) => m.role === 'system') ?? { role: 'system', content: '' });
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const lastUser = lastUserMsg ? textOf(lastUserMsg) : '';
  const seed = lastUser + String(messages.length);

  // 情绪档位影响语气
  if (/不耐烦|生气|烦躁|愤怒/.test(system)) {
    return pick(
      ['行了，说重点吧，我时间不多。', '嗯，你直接说多少钱的事。', '我没那么多耐心听这些，简单点。'],
      seed
    );
  }

  // 关键词异议回应
  if (/价格|贵|便宜|优惠|打折/.test(lastUser)) {
    return pick(
      [
        '你们这个价格确实比别家高不少，我凭什么选你们？',
        '价格我还是觉得有点贵，隔壁家便宜快三成呢。',
        '价钱的事我还是有顾虑，你再想想办法？',
      ],
      seed
    );
  }
  if (/理赔|赔付|报销/.test(lastUser)) {
    return pick(
      [
        '我听说你们理赔特别慢，我一个朋友就拖了俩月，真的假的？',
        '理赔这块我最担心，真出事的时候你们能不能痛快点？',
      ],
      seed
    );
  }
  if (/收益|回报|赚/.test(lastUser)) {
    return '这个收益到底能不能保证？别到时候说得天花乱坠。';
  }
  if (/考虑|再想想|商量/.test(lastUser)) {
    return '行吧，那我再考虑考虑，你别老催我。';
  }

  // 默认通用回应
  return pick(
    [
      '嗯，你接着说。',
      '这样啊，那具体是怎么回事？',
      '哦？这对我有什么好处呢？',
      '我听不太懂，你说得再明白点。',
      '嗯……我还是有点犹豫。',
    ],
    seed
  );
}
