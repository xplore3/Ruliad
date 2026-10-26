import type {
  BehaviorBand,
  ChatMessage,
  LLMProvider,
  PersonaRuntimeBundle,
  TranscriptTurn,
} from '@grasp-mvp/core';

/**
 * 组装 actor 消息：
 * system = 运行时包 systemPrompt + 当前档位行为指令；
 * transcript 映射 trainee -> user，persona -> assistant，coach 轮以标注形式注入 user。
 */
export function buildActorMessages(
  bundle: PersonaRuntimeBundle,
  band: BehaviorBand,
  transcript: TranscriptTurn[]
): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${bundle.systemPrompt}\n\n当前情绪状态（${band.key}）：${band.instruction}`,
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
    transcript: TranscriptTurn[]
  ): Promise<string> {
    const result = await this.llm.chat(buildActorMessages(bundle, band, transcript));
    return result.content;
  }
}
