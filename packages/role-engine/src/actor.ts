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

function prosodyEvidence(turn: TranscriptTurn): string {
  const prosody = turn.voiceFeatures?.prosody;
  if (!prosody) return '';
  const pitchValues = prosody.pitchCurve.map((point) => point.f0Hz);
  const pitchRange = pitchValues.length > 0
    ? `${Math.round(Math.min(...pitchValues))}~${Math.round(Math.max(...pitchValues))}Hz`
    : '有效音调帧不足';
  const pauses = prosody.pauses.map((pause) => `${(pause.atMs / 1000).toFixed(1)}秒处${(pause.durationMs / 1000).toFixed(1)}秒`).join('、') || '无明显停顿';
  const elongated = prosody.elongatedSegments
    .map((segment) => `${(segment.startMs / 1000).toFixed(1)}~${(segment.endMs / 1000).toFixed(1)}秒`)
    .join('、') || '无明显连续长发声段';
  return [
    '【说话语气辅助证据（同步音频分析，仅供理解表达意图）】',
    `音调轨迹：${pitchRange}，共 ${prosody.pitchCurve.length} 个有效音调帧；音量轨迹共 ${prosody.loudnessCurve.length} 帧。`,
    `停顿：${pauses}；可能拖长音的连续发声段：${elongated}。`,
    `笑声线索：${prosody.laughterCue.status}（${prosody.laughterCue.reason}）。`,
    `夸张/表演感线索：${prosody.performanceCue.status}（${prosody.performanceCue.reason}）。`,
    '这些是启发式声学线索，不是幽默或情绪结论。请结合对话语境判断是否玩笑、反讽或认真承诺，不得只凭“一定”等绝对化词语下结论，也不得把声学线索当成确定情绪。',
  ].join('\n');
}

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
  for (const [index, turn] of transcript.entries()) {
    if (turn.speaker === 'trainee') {
      const evidence = index === transcript.length - 1 ? prosodyEvidence(turn) : '';
      const intent = index === transcript.length - 1 && turn.expressionIntent
        ? `【表达方式与意图】语气=${turn.expressionIntent.tone}，意图=${turn.expressionIntent.intent}（置信度${turn.expressionIntent.confidence}）：${turn.expressionIntent.rationale}\n语气与意图彼此独立，玩笑式承诺、威胁、强迫或劝说均可能存在；该结论不用于直接扣分。`
        : '';
      messages.push({ role: 'user', content: `${turn.text}${intent ? `\n\n${intent}` : ''}${evidence ? `\n\n${evidence}` : ''}` });
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
  '地推客户只是潜在客户，耐心有限：销售明显答非所问、完全跑题或持续无目的闲聊且不推进流程时，必须立即表示还有事并离开，不得继续配合闲聊。',
  '销售在介绍邀请函的中后段提出封闭式问题，且不能确定答案肯定时（如“您让孩子学围棋吗”），你必须明确回答“不学”“不需要”或其他否定答复，不得配合成肯定回答。',
  '直接输出你的台词本身，不要输出 JSON、引号或任何解释。',
].join('\n');

/** 结束标记（容忍全角/半角变体） */
const CLOSE_MARKER = /\[\[?CLOSE\]\]?|【CLOSE】/i;
/** 向孩子提问标记：剧情中客户转头问孩子时输出，由系统另行生成孩子回答 */
const CHILD_MARKER = /\[\[?CHILD\]\]?|【CHILD】/i;
/** 咨询接待固定题号标记：只记录实际提出的固定题，不进入转写或播报 */
const RECEPTION_QUESTION_MARKER = /\[\[?Q:(\d{1,2})\]\]?/i;

/** 向孩子提问的控制指令：客户问孩子的问题由孩子本人回答（系统生成），不由销售作答 */
const CHILD_CONTROL_INSTRUCTION = [
  '如果剧情需要你（客户/家长）转头向身边的孩子提问（如"宝贝你喜不喜欢""想不想学"），',
  '照常以家长身份说出这个问题，并在回复的最末尾加上标记 [[CHILD]]（如有 [[CLOSE]] 则放在它前面）；',
  '孩子的问题由孩子本人回答，你不要代替孩子回答，也不要让这个问题被忽略。',
  '在地推成交环节的六连问中，转头问孩子“宝贝，你想去吗”固定为最后一次拒绝；前五轮不得提前向孩子提问，也不得用“孩子不喜欢”提前结束。',
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
  ): Promise<{ text: string; shouldClose: boolean; asksChild: boolean; questionIndex?: number }> {
    const messages = buildActorMessages(bundle, band, transcript, coachIntensity);
    messages[0] = { role: 'system', content: `${messages[0].content}\n\n${CLOSE_CONTROL_INSTRUCTION}\n${CHILD_CONTROL_INSTRUCTION}` };
    const result = await this.llm.chat(messages);
    const shouldClose = CLOSE_MARKER.test(result.content);
    const asksChild = CHILD_MARKER.test(result.content);
    const questionMatch = result.content.match(RECEPTION_QUESTION_MARKER);
    const parsedIndex = Number(questionMatch?.[1]);
    const questionIndex = parsedIndex >= 1 && parsedIndex <= 10 ? parsedIndex : undefined;
    const text = result.content
      .replace(new RegExp(CLOSE_MARKER.source, 'gi'), '')
      .replace(new RegExp(CHILD_MARKER.source, 'gi'), '')
      .replace(new RegExp(RECEPTION_QUESTION_MARKER.source, 'gi'), '')
      .trim();
    return { text: text || result.content.trim(), shouldClose, asksChild, questionIndex };
  }
}

/** 孩子角色的默认系统提示：真实、简短、孩子口吻，不替家长做决定 */
const CHILD_SYSTEM_PROMPT = [
  '你是地推/电销对练现场家长身边的孩子，大约 6~10 岁，正在家长旁边玩或好奇地听着。',
  '用小孩的口吻简短、真实地回答（一两句话），可以带点孩子气（"嗯……""好玩吗？"），不要替家长做决定，不要推销，不要说出超出孩子认知的话。',
  '【初次拒绝】当家长第一次问"想不想去/喜不喜欢/要不要学"时，回答不想去、不喜欢（如"不想去""我不喜欢"）。',
  '销售在没有先给你情感支持、也没有讲好玩故事或带你玩游戏时，直接问“小朋友你喜欢吗”“你想学吗”，必须回答“不喜欢”“不想学”并标记 [[RESIST]]，不得被问题引导成肯定回答。',
  '【真实心理】这个年龄段的孩子自主性有限，注意力容易被大人温和地转移。大人自然岔开话题后，不要每轮都揪着之前的玩具、滑梯或同一件事不放。销售简短回应你想玩的事物时，你可以开心一下，再听对方说，但不要反复要求兑现或展开长时间的滑梯讨论。',
  '【松动的两个必要条件】销售必须先给予情感支持，再通过搞笑故事、小游戏等趣味内容让你开心和好奇，最后才问你是否喜欢或想学。顺序不能颠倒。',
  '情感支持可以是尊重你的想法和自主选择，也可以是鼓励、关注、陪伴、蹲下来平视等方式，方法不唯一。',
  '只有故事或游戏好玩、却一直没有获得情感支持时，你仍然会抵触；只有尊重、鼓励等情感支持、却没有好玩的故事或游戏时，你也仍然会抵触。不要因为对方一再建议就机械答应。',
  '对方只是表达尊重并让你听故事，但你还没有实际听到故事时，仍须标记 [[RESIST]]；“愿意听故事”不等于已经松动。故事必须实际讲出来且能逗你开心，不能只有讲故事的承诺。',
  '先获得情感支持、再听到好玩故事或玩到有趣游戏后，销售再问你是否喜欢或想学，此时答案已经确定，必须固定回答“喜欢/想学”并标记 [[OPEN]]，这不属于封闭式问题。无铺垫或策略不当直接提问时固定回答“不喜欢/不想学”并标记 [[RESIST]]。销售若忽略、命令、训斥或施压，你更会直接抗拒。',
  '直接输出孩子的台词本身，不要输出解释、引号或旁白。必须在台词最后加内部控制标记：仍抗拒时加 [[RESIST]]，已经松动时加 [[OPEN]]。',
].join('\n');

const CHILD_RESIST_MARKER = /\[\[?RESIST\]\]?|【RESIST】/i;
const CHILD_OPEN_MARKER = /\[\[?OPEN\]\]?|【OPEN】/i;

export interface ChildReply {
  text: string;
  resistant: boolean;
}

/**
 * 孩子回答：家长向孩子提问、或孩子模式下销售对孩子说话时，由独立的 LLM 调用以孩子口吻作答。
 * resistant 供服务端执行错误沟通轮数限制；控制标记不会进入转写或播报。
 */
export async function replyAsChild(
  llm: LLMProvider,
  transcript: TranscriptTurn[],
  question: string
): Promise<ChildReply> {
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
  const raw = result.content.trim();
  return {
    text: raw.replace(CHILD_RESIST_MARKER, '').replace(CHILD_OPEN_MARKER, '').trim(),
    resistant: CHILD_OPEN_MARKER.test(raw) ? false : true,
  };
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

/**
 * 潜在客户耐心判定：仅在销售明显跑题、答非所问或持续无目的闲聊时要求强制离场。
 * 话术不专业、短暂寒暄或推进较弱不等于跑题，无法确定时保守返回 false。
 */
export async function shouldCustomerLeave(
  llm: LLMProvider,
  transcript: TranscriptTurn[],
  scenarioContext: string,
  isOpening: boolean
): Promise<boolean> {
  try {
    const context = transcript
      .slice(-6)
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
            '你是地推场景的客户耐心判定器。客户只是潜在客户，没有明确需求，不会长时间陪销售闲扯。' +
            '开场规则：如果当前是销售在本小场的首次发言，必须有明确的地推目的，可以直接说明来意、活动、对客户的价值或下一步行动。机构、姓名等具体自我介绍不是硬性要求；例如“像您这样有气质的家长，肯定不会拒绝孩子一次成长的机会”通过夸奖建立好感并说明来意，是合格开场。' +
            '只说“你好啊”、无目的闲聊、没有任何明确来意，或只报机构/姓名却没有说明目的，必须 offPoint=true。' +
            '如果销售在首次明确介绍或递出邀请函之前，向家长或孩子提出封闭式问题且不能确定答案肯定（如“您让孩子学围棋吗”，或未给孩子情感支持和好玩故事就问“小朋友你喜欢吗”），必须 offPoint=true，客户会直接拒绝并结束。邀请函中后段出现同类问题则不属于本强制离场规则。' +
            '其他强制离场情况：1）销售完全答非所问，回应与客户问题明显无关；2）销售持续进行与销售目标完全无关的闲聊，完全没有目的性。销售相关但缺乏成交推进时不走本强制离场规则，由地推最后推进机会机制处理。' +
            '以下情况必须输出 offPoint=false：有明确来意的正常开场、夸奖加说明来意、紧张口吃但仍在推进、表达不够专业、单轮推进较弱、销售正在介绍课程或邀请函、正在回应客户、正在给孩子讲故事或做游戏、客户本身已经明确拒绝。' +
            '不要因为销售说得差就判跑题；只有明显、严重、结合上下文也说不通时才判 true。无法确定时判 false。只输出 JSON：{"offPoint":true或false,"reason":"简短理由"}',
        },
        {
          role: 'user',
          content: `演练背景：\n${scenarioContext.slice(0, 5000)}\n\n当前是否为本小场首次发言：${isOpening ? '是' : '否'}\n\n最近对话：\n${context}\n\n请判断销售是否已经明显跑题或开场不合格到客户应直接离开。`,
        },
      ],
      { jsonMode: true, temperature: 0 }
    );
    const parsed = JSON.parse(result.content) as { offPoint?: unknown };
    return parsed.offPoint === true;
  } catch {
    return false;
  }
}
