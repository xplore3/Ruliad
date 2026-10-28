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
}
