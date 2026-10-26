import type { Element, PersonaConfig, PersonaRuntimeBundle, ProductKB } from '@grasp-mvp/core';

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
 * 编译角色运行时包：
 * systemPrompt = 角色背景 + 按 elementIds 顺序的要素正文 + 产品知识注入 + 知识边界 + 行为约束；
 * dynamics = 全部 E 类要素的 triggers 合并 + 红线触发器，decayPerTurn/baseArousal 取平均。
 *
 * @param config 陪练员配置
 * @param elements 要素资产列表
 * @param productKB 可选的产品知识库；注入后陪练员掌握产品参数、竞品对比、FAQ，并对红线话术产生情绪反应
 */
export function compilePersona(
  config: PersonaConfig,
  elements: Element[],
  productKB?: ProductKB,
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
