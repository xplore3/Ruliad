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
    } else if (turn.speaker === 'child') {
      messages.push({ role: 'assistant', content: `（孩子回答：${turn.text}）` });
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
/** 向孩子提问标记：剧情中客户转头问孩子时输出，由系统另行生成孩子回答 */
const CHILD_MARKER = /\[\[?CHILD\]\]?|【CHILD】/i;

/** 向孩子提问的控制指令：客户问孩子的问题由孩子本人回答（系统生成），不由销售作答 */
const CHILD_CONTROL_INSTRUCTION = [
  '如果剧情需要你（客户/家长）转头向身边的孩子提问（如"宝贝你喜不喜欢""想不想学"），',
  '照常以家长身份说出这个问题，并在回复的最末尾加上标记 [[CHILD]]（如有 [[CLOSE]] 则放在它前面）；',
  '孩子的问题由孩子本人回答，你不要代替孩子回答，也不要让这个问题被忽略。',
].join('\n');

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
   * 返回 asksChild=true 表示本轮客户转头向孩子提问（[[CHILD]] 标记），孩子回答由调用方另行生成。
   */
  async replyWithSignal(
    bundle: PersonaRuntimeBundle,
    band: BehaviorBand,
    transcript: TranscriptTurn[],
    coachIntensity?: 'low' | 'medium' | 'high'
  ): Promise<{ text: string; shouldClose: boolean; asksChild: boolean }> {
    const messages = buildActorMessages(bundle, band, transcript, coachIntensity);
    messages[0] = { role: 'system', content: `${messages[0].content}\n\n${CLOSE_CONTROL_INSTRUCTION}\n${CHILD_CONTROL_INSTRUCTION}` };
    const result = await this.llm.chat(messages);
    const shouldClose = CLOSE_MARKER.test(result.content);
    const asksChild = CHILD_MARKER.test(result.content);
    const text = result.content
      .replace(new RegExp(CLOSE_MARKER.source, 'gi'), '')
      .replace(new RegExp(CHILD_MARKER.source, 'gi'), '')
      .trim();
    return { text: text || result.content.trim(), shouldClose, asksChild };
  }
}

/** 孩子角色的默认系统提示：真实、简短、孩子口吻，不替家长做决定 */
const CHILD_SYSTEM_PROMPT = [
  '你是地推/电销对练现场家长身边的孩子，大约 6~10 岁，正在家长旁边玩或好奇地听着。',
  '用小孩的口吻简短、真实地回答（一两句话），可以带点孩子气（"嗯……""好玩吗？"），不要替家长做决定，不要推销，不要说出超出孩子认知的话。',
  '【硬性规则】当被问"想不想去/喜不喜欢/要不要学"时，必须回答不想去、不喜欢（如"不想去""我不喜欢"）——这是你给销售出的难题；',
  '之后如果销售给你讲故事、陪你玩游戏、耐心地哄你引导你，你可以逐渐表现出好奇和喜欢，最后被说服；但销售一上来就讲道理时不要轻易答应。',
  '直接输出孩子的台词本身，不要输出任何解释、引号或旁白。',
].join('\n');

/**
 * 孩子回答：家长向孩子提问、或孩子模式下销售对孩子说话时，由独立的 LLM 调用以孩子口吻作答。
 * transcript 仅作情境上下文；question 为对方刚说的话（家长提问或销售哄孩子的话）。
 */
export async function replyAsChild(
  llm: LLMProvider,
  transcript: TranscriptTurn[],
  question: string
): Promise<string> {
  const context = transcript
    .slice(-8)
    .map((t) =>
      t.speaker === 'trainee'
        ? `销售：${t.text}`
        : t.speaker === 'persona'
          ? `家长：${t.text}`
          : t.speaker === 'child'
            ? `孩子：${t.text}`
            : `旁白：${t.text}`
    )
    .join('\n');
  const result = await llm.chat([
    { role: 'system', content: CHILD_SYSTEM_PROMPT },
    { role: 'user', content: `${context ? `对话情境：\n${context}\n\n` : ''}对方刚对你说："${question}"\n请以孩子身份回答。` },
  ]);
  return result.content.trim();
}

/**
 * 孩子模式下的对话对象路由：判定学员本轮发言是在对孩子说还是对家长说。
 * 语境是孩子刚被家长提问/正在与孩子互动；判定不了时默认 child（保持与孩子的对话不中断）。
 */
export async function classifyAddressTarget(
  llm: LLMProvider,
  transcript: TranscriptTurn[],
  traineeText: string
): Promise<'child' | 'parent'> {
  try {
    const context = transcript
      .slice(-4)
      .map((t) =>
        t.speaker === 'trainee'
          ? `销售：${t.text}`
          : t.speaker === 'persona'
            ? `家长：${t.text}`
            : t.speaker === 'child'
              ? `孩子：${t.text}`
              : `旁白：${t.text}`
      )
      .join('\n');
    const result = await llm.chat(
      [
        {
          role: 'system',
          content:
            '你是对练场景的对话对象分类器。现场有销售、家长、孩子。根据语境判断销售的下一句话是在对孩子说还是对家长说。' +
            '对孩子说的特征：称呼"小朋友/宝贝/孩子"或直接接孩子的话、给孩子讲故事/玩游戏/哄孩子；' +
            '对家长说的特征：称呼"大哥/您/家长"或继续谈价格、报名、课程等成人话题。' +
            '拿不准时判 child。只输出 JSON：{"target":"child" 或 "parent"}',
        },
        { role: 'user', content: `${context ? `前面对话：\n${context}\n\n` : ''}销售说："${traineeText}"` },
      ],
      { jsonMode: true, temperature: 0 }
    );
    const parsed = JSON.parse(result.content) as { target?: unknown };
    return parsed.target === 'parent' ? 'parent' : 'child';
  } catch {
    return 'child';
  }
}
