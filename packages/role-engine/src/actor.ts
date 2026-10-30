import type {
  BehaviorBand,
  ChatMessage,
  LLMProvider,
  PersonaRuntimeBundle,
  TranscriptTurn,
} from '@grasp-mvp/core';

/** 教练强度 → persona 行为附加指令（high = 更频繁追问/施压；low = 更宽松配合） */
const INTENSITY_INSTRUCTIONS: Record<'low' | 'medium' | 'high', string> = {
  low: '教练强度：低。你态度宽松，不主动为难学员，较少追问，给学员充分表达空间。',
  medium: '教练强度：中。你按场景设定正常回应，学员表述含糊时适度追问。',
  high: '教练强度：高。你更频繁地追问细节、质疑模糊表述、适时打断施压，不轻易放过学员的空泛话术。',
};

/**
 * 组装 actor 消息：
 * system = 运行时包 systemPrompt + 当前档位行为指令（+ 可选教练强度指令）；
 * transcript 映射 trainee -> user，persona -> assistant，coach 轮以标注形式注入 user。
 */
export function buildActorMessages(
  bundle: PersonaRuntimeBundle,
  band: BehaviorBand,
  transcript: TranscriptTurn[],
  coachIntensity?: 'low' | 'medium' | 'high'
): ChatMessage[] {
  const intensityLine = coachIntensity ? `\n${INTENSITY_INSTRUCTIONS[coachIntensity]}` : '';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${bundle.systemPrompt}\n\n当前情绪状态（${band.key}）：${band.instruction}${intensityLine}`,
    },
  ];
  for (const turn of transcript) {
    if (turn.speaker === 'trainee') {
      messages.push({ role: 'user', content: turn.text });
    } else if (turn.speaker === 'persona') {
      messages.push({ role: 'assistant', content: turn.text });
    } else {
      messages.push({ role: 'user', content: `（教练提示：${turn.text}）` });
    }
  }
  return messages;
}

/** 结束控制指令：要求 LLM 回复时顺带判断本场对练是否应当自然结束（收尾台词末尾加标记，不用 JSON——对话生成走 JSON 模式容易退化为空白输出） */
const CLOSE_CONTROL_INSTRUCTION = [
  '请同时判断本场对练是否应当结束：当对话自然到达终点（学员已达成本场目标、谈判破裂、或你作为客户决定结束对话离开）时，',
  '以角色身份自然地说出收尾台词，并在回复的最末尾加上标记 [[CLOSE]]；否则正常回应，不要加任何标记。',
  '直接输出你的台词本身，不要输出 JSON、引号或任何解释。',
].join('\n');

/** 结束标记（容忍全角/半角变体） */
const CLOSE_MARKER = /\[\[?CLOSE\]\]?|【CLOSE】/i;

/** 客户角色演员：基于 LLM 生成 persona 回复 */
export class PersonaActor {
  constructor(private llm: LLMProvider) {}

  async reply(
    bundle: PersonaRuntimeBundle,
    band: BehaviorBand,
    transcript: TranscriptTurn[],
    coachIntensity?: 'low' | 'medium' | 'high'
  ): Promise<string> {
    const result = await this.llm.chat(buildActorMessages(bundle, band, transcript, coachIntensity));
    return result.content;
  }

  /**
   * 带结束判断的回复：LLM 每轮顺带决定本场对练是否该自然收口（替代倒计时强制结束）。
   * 模型在收尾台词末尾输出 [[CLOSE]] 标记表示结束；无标记或输出异常时按不结束处理。
   */
  async replyWithSignal(
    bundle: PersonaRuntimeBundle,
    band: BehaviorBand,
    transcript: TranscriptTurn[],
    coachIntensity?: 'low' | 'medium' | 'high'
  ): Promise<{ text: string; shouldClose: boolean }> {
    const messages = buildActorMessages(bundle, band, transcript, coachIntensity);
    messages[0] = { role: 'system', content: `${messages[0].content}\n\n${CLOSE_CONTROL_INSTRUCTION}` };
    const result = await this.llm.chat(messages);
    const shouldClose = CLOSE_MARKER.test(result.content);
    const text = result.content.replace(new RegExp(CLOSE_MARKER.source, 'gi'), '').trim();
    return { text: text || result.content.trim(), shouldClose };
  }
}
