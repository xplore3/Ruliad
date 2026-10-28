import type {
  Element,
  PersonaConfig,
  PersonaRuntimeBundle,
  ProductKB,
  Scenario,
  ScenarioParticipant,
} from '@grasp-mvp/core';

/** 无 E 类要素时的默认动力学参数 */
const DEFAULT_DECAY_PER_TURN = 0.05;
const DEFAULT_BASE_AROUSAL = 0.3;

/** 红线话术触发强烈反感的唤醒度增量 */
const REDLINE_ESCALATION = 0.4;

/**
 * 从红线条目的 content 中提取关键词列表。
 * 红线 content 形如「禁止使用「保证疗效」「所有患者都能达标」「根治」等绝对化表述。」
 * 提取引号内的词，退化为按逗号/顿号分割。
 */
function extractRedlineKeywords(content: string): string[] {
  // 优先提取引号内的词
  const quoted = content.match(/[「"『（(]([^」"』）)]+)[」"』）)]/g);
  if (quoted && quoted.length > 0) {
    return quoted
      .map((s) => s.replace(/^[「"『（(]/, '').replace(/[」"』）)]$/, '').trim())
      .filter((s) => s.length >= 2);
  }
  // 退化：按中文标点分割，取前 3 段
  return content
    .split(/[，。；、,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 20)
    .slice(0, 3);
}

/**
 * 组装场景设定段：把 Scenario 的剧本、参与者、难度等维度编译进演员 prompt，
 * 保证练习中的说话次序、剧本流程、角色特征与说话语气严格参考场景配置而非随意发挥。
 */
function buildScenarioSection(scenario: Scenario, personaName: string): string[] {
  const lines: string[] = [];
  lines.push(`本场对练场景：${scenario.name}。`);
  if (scenario.description) {
    lines.push(`场景背景：${scenario.description}。`);
  }
  if (scenario.personaTitle) {
    lines.push(`你的人设定位：${scenario.personaTitle}。`);
  }
  if (scenario.difficulty <= 1) {
    lines.push('难度要求：本场难度较低，你的态度相对配合，少追问刁难，给对方留出表达空间。');
  } else if (scenario.difficulty >= 3) {
    lines.push('难度要求：本场难度较高，你要更挑剔、追问更紧、不轻易松口或承诺，直到对方给出充分有说服力的理由。');
  } else {
    lines.push('难度要求：本场难度中等，保持真实专业客户的正常反应与适度追问。');
  }

  const script = scenario.script;
  if (script) {
    if (script.purpose) {
      lines.push(`本场对练目的：${script.purpose}。`);
    }
    if (script.executionOrder) {
      lines.push(
        `剧本流程（说话次序）：${script.executionOrder}。你需配合按此流程推进对话节奏，当前环节未谈透时不要主动跳到后面的环节。`
      );
    }
    if (script.topics && script.topics.length > 0) {
      lines.push(`本场围绕的话题：${script.topics.join('、')}。`);
    }
    if (script.customerQuestions && script.customerQuestions.length > 0) {
      lines.push(
        `在对话的合适时机，你要以角色口吻自然地向对方提出以下问题（按剧本流程逐一提出，不要一次性全部抛出）：${script.customerQuestions
          .map((q) => `「${q}」`)
          .join('、')}。`
      );
    }
  }

  const participants = scenario.participants ?? [];
  if (participants.length > 0) {
    // 客户方参与者：名字命中 persona 名，或不属于学员/销售侧；其余视为对方（学员侧）设定
    const customer =
      participants.find((p) => p.name.includes(personaName)) ??
      participants.find((p) => !/学员|销售|代表/.test(p.name));
    const others = participants.filter((p) => p !== customer);

    const describe = (p: ScenarioParticipant): string[] => {
      const out: string[] = [];
      if (p.traits) out.push(`· 主要特征：${p.traits}`);
      if (p.speakingStyle) out.push(`· 说话特点与语气：${p.speakingStyle}`);
      if (p.speechScope) out.push(`· 话语范围：${p.speechScope}`);
      if (p.languageRequirements) out.push(`· 言语要求：${p.languageRequirements}`);
      if (p.goal) out.push(`· 参与目的：${p.goal}`);
      return out;
    };

    if (customer) {
      lines.push(`你的角色设定（${customer.name}，必须严格遵守其说话特点与语气）：`);
      lines.push(...describe(customer));
    }
    for (const other of others) {
      lines.push(`对方设定（${other.name}）：`);
      lines.push(...describe(other));
    }
  }
  return lines;
}

/**
 * 编译角色运行时包：
 * systemPrompt = 角色背景 + 按 elementIds 顺序的要素正文 + 场景设定（剧本/参与者/难度）
 * + 产品知识注入 + 知识边界 + 行为约束；
 * dynamics = 全部 E 类要素的 triggers 合并 + 红线触发器，decayPerTurn/baseArousal 取平均。
 *
 * @param config 陪练员配置
 * @param elements 要素资产列表
 * @param productKB 可选的产品知识库；注入后陪练员掌握产品参数、竞品对比、FAQ，并对红线话术产生情绪反应
 * @param scenario 可选的场景配置；注入后剧本流程、说话次序、参与者特征与语气、难度等进入 prompt
 */
export function compilePersona(
  config: PersonaConfig,
  elements: Element[],
  productKB?: ProductKB,
  scenario?: Scenario,
): PersonaRuntimeBundle {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const ordered = config.elementIds
    .map((id) => byId.get(id))
    .filter((e): e is Element => e !== undefined);

  const lines: string[] = [];
  const profile = [
    `你是${config.name}`,
    config.age !== undefined ? `${config.age}岁` : '',
    config.occupation ? `职业是${config.occupation}` : '',
  ]
    .filter(Boolean)
    .join('，');
  lines.push(`${profile}。`);
  lines.push(`背景：${config.background}`);
  for (const e of ordered) {
    lines.push(`【${e.name}】${e.content}`);
  }

  // ---- 注入场景设定（剧本流程/说话次序、参与者特征与语气、难度） ----
  if (scenario) {
    lines.push(...buildScenarioSection(scenario, config.name));
  }

  // ---- 注入产品知识 ----
  if (productKB && productKB.entries.length > 0) {
    const keypoints = productKB.entries.filter((e) => e.kind === 'keypoint');
    const competitors = productKB.entries.filter((e) => e.kind === 'competitor');
    const faqs = productKB.entries.filter((e) => e.kind === 'faq');
    const redlines = productKB.entries.filter((e) => e.kind === 'redline');

    if (keypoints.length > 0) {
      lines.push('你了解以下产品信息：');
      keypoints.forEach((k) => lines.push(`· ${k.title}：${k.content}`));
    }
    if (competitors.length > 0) {
      lines.push('你会用以下竞品信息来压价或质疑：');
      competitors.forEach((c) => lines.push(`· ${c.title}：${c.content}`));
    }
    if (faqs.length > 0) {
      lines.push('你对以下高频异议有自己的预期反应：');
      faqs.forEach((f) => lines.push(`· ${f.title}：${f.content}`));
    }
    if (redlines.length > 0) {
      lines.push('你对以下红线话术零容忍（听到会强烈反感并质疑）：');
      redlines.forEach((r) => lines.push(`· ${r.title}：${r.content}`));
    }
  }

  if (config.knowledgeBoundary.mustNotKnow.length > 0) {
    lines.push(`你不知道以下信息：${config.knowledgeBoundary.mustNotKnow.join('；')}。`);
  }
  if (config.knowledgeBoundary.loadedKnowledge.length > 0) {
    lines.push(`你额外了解：${config.knowledgeBoundary.loadedKnowledge.join('；')}。`);
  }
  lines.push(
    '对话风格要求：以该客户角色口吻自然对话，模拟真实电话沟通。' +
      '（1）长短句交替：有时简短回应（如"嗯"、"对"、"好"），有时展开说明（20-50字）；' +
      '（2）通话开头先问候或确认对方身份（如"喂，您好"、"请问是X老师吗"）；' +
      '（3）偶尔确认对方意思（如"您的意思是...对吗"、"我理解的是..."）；' +
      '（4）不暴露自己是 AI，不暴露评分标准，全程沉浸在角色中。'
  );

  const emotionElements = ordered.filter((e) => e.type === 'E' && e.dynamics);
  const triggers = emotionElements.flatMap((e) => e.dynamics!.triggers);

  // ---- 红线词追加为情绪触发器 ----
  if (productKB) {
    const redlines = productKB.entries.filter((e) => e.kind === 'redline');
    const redlineKeywords = redlines.flatMap((r) => extractRedlineKeywords(r.content));
    if (redlineKeywords.length > 0) {
      triggers.push({
        id: 'trig-redline',
        keywords: redlineKeywords,
        escalation: REDLINE_ESCALATION,
        description: '红线话术触发强烈反感',
      });
    }
  }

  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const decayPerTurn =
    emotionElements.length > 0
      ? avg(emotionElements.map((e) => e.dynamics!.decayPerTurn))
      : DEFAULT_DECAY_PER_TURN;
  const baseArousal =
    emotionElements.length > 0
      ? avg(emotionElements.map((e) => e.dynamics!.baseArousal))
      : DEFAULT_BASE_AROUSAL;

  return {
    personaConfigId: config.id,
    systemPrompt: lines.join('\n'),
    behaviorBands: config.behaviorBands,
    knowledgeBoundary: config.knowledgeBoundary,
    dynamics: { triggers, decayPerTurn, baseArousal },
  };
}
