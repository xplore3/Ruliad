import type {
  BriefingStandard,
  DemoLine,
  DemoScriptTemplate,
  LLMGateway,
  ScenarioGuidance,
} from '@grasp-mvp/core';
import type { Store } from '@grasp-mvp/infra';
import { DEMO_FAQ_ITEMS } from '../demo-faq.data.js';

/**
 * 新手指引流程：资格判断 + 示范剧本演绎 + 讲解口播稿组装。
 * 资源库化以后，示范剧本存示范剧本库（DemoScript），由 ScenarioGuidance.demoScriptId 引用。
 * 示范执行方式：先把模板确定性渲染成参照稿（变量 + FAQ 池抽取），再交给大模型理解演绎成自然对话；
 * LLM 失败/输出不合法时回退参照稿，保证 mock/弱网环境可跑通。
 * 场景无指引配置或剧本引用失效时不提供兜底示范剧本，由路由声明无示范（hasDemo=false），前端跳过示范步骤。
 */

/** 资格提问兜底（场景无引导资源时的默认两问） */
export const QUALIFY_QUESTIONS = ['你做过地推吗？', '你做过教培行业的地推吗？'] as const;

export type { DemoLine } from '@grasp-mvp/core';

export type DemoChoice = 'replay' | 'practice';

/** 从 LLM 输出中提取 JSON 片段（容忍 ```json 包裹与前后杂文本） */
function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : content;
  const start = raw.search(/[[{]/);
  return start >= 0 ? raw.slice(start).trim() : raw.trim();
}

/** 否定关键词：命中任一即判"没做过" */
const NEGATIVE_EXP = /没做过|没有做过|没干过|没有|没(?!错)|从来没|从未|不曾|尚未|第一次|不太了解|不了解|没接触|没有经验|无经验/;

/** 单条回答的关键词兜底判断：保守策略，判断不出视为"没做过"（宁可进指导模式） */
function fallbackExperienced(answer: string): boolean {
  if (NEGATIVE_EXP.test(answer)) return false;
  if (/做过|干过|有经验|是的|当然|以前做|之前做/.test(answer)) return true;
  return false;
}

/**
 * 判断学员是否有相关经验（问题数量按新手指引流程配置，不写死）。
 * 全部问题都答"做过"才返回 true；任一题"没做过"或缺答 → false。
 */
export async function judgeExperience(
  gateway: LLMGateway,
  qa: { question: string; answer: string }[]
): Promise<boolean> {
  if (qa.length === 0) return false;
  try {
    const qaLines = qa.map((x, i) => `问题${i + 1}：${x.question}\n回答${i + 1}：${x.answer}`).join('\n');
    const result = await gateway.forTask('judge').chat(
      [
        {
          role: 'user',
          content: [
            '你是销售培训的新手资格审核员。下面是学员对资格提问的语音回答（经语音识别，可能有错字）。',
            '请判断每个问题学员是否表达"做过/有相关经验"。回答含糊、答非所问、回避问题都视为没做过。',
            qaLines,
            `只输出 JSON：{"results": [true 或 false, ...]}（数组按问题顺序，共 ${qa.length} 项）`,
            '不要输出任何其他内容。',
          ].join('\n'),
        },
      ],
      { jsonMode: true, temperature: 0 }
    );
    const parsed = JSON.parse(extractJson(result.content)) as { results?: unknown };
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    // 逐题解析，缺位/非布尔走关键词兜底
    return qa.every((x, i) => (typeof results[i] === 'boolean' ? results[i] : fallbackExperienced(x.answer)));
  } catch {
    // LLM 失败/解析失败：逐题关键词兜底，全部判"做过"才算有经验
    return qa.every((x) => fallbackExperienced(x.answer));
  }
}

/** 清洗标准答案中的占位标记：xx岁 → 剧本中孩子的年龄；哥/姐 → 当前剧本的称呼（大哥/姐） */
function sanitizeFaq(text: string, age: number, address: string): string {
  return text.replace(/xx岁/g, `${age}岁`).replace(/哥\/姐/g, address).trim();
}

/** 再听一版关键词 */
const REPLAY_EXP = /再听|再来|换一个|另一个|再放|重听|重新听|一遍|换个|重新来/;
/** 开始练习关键词 */
const PRACTICE_EXP = /练习|开始|直接|上手|试试|模拟|来吧|可以了/;

/** 判断用户想"再听一版示范"还是"开始练习"。LLM 优先，失败走关键词兜底，默认 practice */
export async function judgeDemoChoice(gateway: LLMGateway, text: string): Promise<DemoChoice> {
  try {
    const result = await gateway.forTask('judge').chat(
      [
        {
          role: 'user',
          content: [
            '用户刚看完一段销售示范对话，被问到"想再听一个版本的示范，还是开始模拟练习？"。',
            `用户的语音回答（可能有错字）："${text}"`,
            '判断用户意图：想再听一版示范 → replay；想开始练习 → practice。回答含糊视为 practice。',
            '只输出 JSON：{"choice":"replay" 或 "practice"}，不要输出任何其他内容。',
          ].join('\n'),
        },
      ],
      { jsonMode: true, temperature: 0 }
    );
    const parsed = JSON.parse(extractJson(result.content)) as { choice?: unknown };
    if (parsed.choice === 'replay' || parsed.choice === 'practice') return parsed.choice;
  } catch {
    /* 落入兜底 */
  }
  if (REPLAY_EXP.test(text)) return 'replay';
  if (PRACTICE_EXP.test(text)) return 'practice';
  return 'practice';
}

/** 示范剧本 FAQ 池条目（question 为客户台词，faq 为标准应答话术） */
export interface DemoFaqPoolItem {
  question: string;
  faq: string;
}

/** 旧版 faqPoolRef 别名映射（兼容存量指引配置）；新配置直接把 faqPoolRef 填示范问答库的分类名 */
const FAQ_POOL_CATEGORIES: Record<string, string[]> = {
  'ground-push-demo-faq': ['地推示范'],
  'inquiry-demo-faq': ['咨询接待场景', '线下谈单场景', '通用场景'],
  'phone-sales-demo-faq': ['电销场景', '地推电销拓客场景', '地推电销场景'],
};

/**
 * 按 faqPoolRef 解析 FAQ 池：
 * 1. poolRef 直接当示范问答库（DemoFaq）的分类名读取，取够 need 条即用（referenceAnswer 作为标准答案）
 * 2. 未取够时走 FAQ_POOL_CATEGORIES 旧映射，按映射的分类逐个读（兼容存量指引配置）
 * 3. 都取不够 need 条时回退 demo-faq.data.ts 内置 28 条地推 FAQ（保证 mock/空库可跑）
 */
export async function resolveFaqPool(
  store: Store,
  tenantId: string,
  poolRef: string | undefined,
  need: number
): Promise<DemoFaqPoolItem[]> {
  const readCategories = async (categories: string[]): Promise<DemoFaqPoolItem[]> => {
    const pools = await Promise.all(categories.map((category) => store.listDemoFaqs(tenantId, category)));
    return pools
      .flat()
      .filter((q) => q.referenceAnswer?.trim())
      .map((q) => ({ question: q.question, faq: q.referenceAnswer!.trim() }));
  };
  if (poolRef) {
    const direct = await readCategories([poolRef]);
    if (direct.length >= need) return direct;
    const mapped = FAQ_POOL_CATEGORIES[poolRef];
    if (mapped) {
      const pool = await readCategories(mapped);
      if (pool.length >= need) return pool;
    }
  }
  return DEMO_FAQ_ITEMS.map((x) => ({ question: x.question, faq: x.faq }));
}

/** 不放回随机抽 n 条 */
function pickFaqs(pool: DemoFaqPoolItem[], n: number): DemoFaqPoolItem[] {
  const rest = [...pool];
  const picked: DemoFaqPoolItem[] = [];
  for (let i = 0; i < n && rest.length > 0; i++) {
    picked.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  }
  return picked;
}

/**
 * 渲染示范剧本模板：
 * 1. 解析 variables（choice 随机选项 / intRange 随机整数 / map 按 from 变量值映射）
 * 2. 从 faqPool 不放回随机抽 faq1..faqN（faqPick 条）
 * 3. 占位符替换：${name} 用变量值，${faqN.question}/${faqN.answer} 用抽中的 FAQ（答案经 sanitizeFaq 清洗）
 */
export function renderDemoScript(template: DemoScriptTemplate, faqPool: DemoFaqPoolItem[]): DemoLine[] {
  // 变量解析（按声明顺序，map 依赖前面的变量已解析）
  const vars: Record<string, string> = {};
  for (const [name, variable] of Object.entries(template.variables ?? {})) {
    if (variable.kind === 'choice') {
      vars[name] = variable.options[Math.floor(Math.random() * variable.options.length)];
    } else if (variable.kind === 'intRange') {
      vars[name] = String(variable.min + Math.floor(Math.random() * (variable.max - variable.min + 1)));
    } else {
      vars[name] = variable.mapping[vars[variable.from]] ?? '';
    }
  }

  const faqs = pickFaqs(faqPool, template.faqPick ?? 0);
  const age = Number(vars.age) || 6;
  const address = vars.address ?? '哥/姐';

  const interpolate = (text: string): string =>
    text.replace(/\$\{([^}]+)\}/g, (raw, expr: string) => {
      const faqMatch = expr.match(/^faq(\d+)\.(question|answer)$/);
      if (faqMatch) {
        const item = faqs[Number(faqMatch[1]) - 1];
        if (!item) return raw; // 池子不足时保留占位，便于排查
        return faqMatch[2] === 'question' ? item.question : sanitizeFaq(item.faq, age, address);
      }
      return vars[expr] ?? raw;
    });

  return template.lines.map((line) => ({ ...line, text: interpolate(line.text) }));
}

const DEMO_ROLES = new Set(['sales', 'customer', 'child', 'narrator']);

/** 清洗 LLM 演绎输出的台词行；非法行返回 null */
function sanitizePerformedLine(raw: unknown): DemoLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const line = raw as Record<string, unknown>;
  if (typeof line.role !== 'string' || !DEMO_ROLES.has(line.role)) return null;
  if (typeof line.text !== 'string' || !line.text.trim()) return null;
  const out: DemoLine = { role: line.role as DemoLine['role'], text: line.text.trim() };
  if (Number.isFinite(line.excitement)) out.excitement = Math.max(1, Math.min(10, Math.round(Number(line.excitement))));
  if (Number.isFinite(line.arousal)) out.arousal = Math.max(0, Math.min(1, Number(line.arousal)));
  return out;
}

/**
 * 示范执行（第2步）：剧本库内容不照念，而是先确定性渲染成参照稿，再交给大模型理解演绎成自然的双人对话。
 * 事实内容（称呼/年龄/FAQ 问答要点/流程顺序）以参照稿为准，措辞由 LLM 口语化演绎；
 * version > 1（学员点"再听一版"）时要求换一种演绎风格。LLM 失败/输出不合法回退参照稿。
 */
export async function performDemoScript(
  gateway: LLMGateway,
  template: DemoScriptTemplate,
  faqPool: DemoFaqPoolItem[],
  version = 1
): Promise<DemoLine[]> {
  const reference = renderDemoScript(template, faqPool);
  const scriptText = reference
    .map((l) => `${{ sales: '销售', customer: '客户', child: '孩子', narrator: '旁白' }[l.role]}：${l.text}`)
    .join('\n');
  try {
    const result = await gateway.forTask('actor').chat(
      [
        {
          role: 'user',
          content: [
            '你是销售培训示范剧的演绎引擎。下面是一份销售示范剧本参照稿（角色：销售/客户/孩子/旁白）。',
            '请理解剧本的流程、事实信息和问答要点，把它演绎成一段自然、口语化、像真实现场发生的双人对话。',
            '要求：',
            '1. 保持剧本的流程顺序和全部事实信息不变（称呼、年龄、课程信息、客户的提问与销售的应答要点必须保留原意）',
            '2. 措辞可以自然发挥：加语气词、合理过渡、让客户反应更真实；不要机械照念',
            '3. 可以微调台词拆分与顺序衔接，但总行数与参照稿接近，客户提问与对应应答必须成对出现',
            version > 1 ? '4. 这是再听一版的请求：换一种演绎风格（节奏/用词/客户性格微调），事实不变' : '',
            '只输出 JSON：{"lines":[{"role":"sales|customer|child|narrator","text":"台词","excitement":1-10 整数（情绪强度，销售开场高、旁白低）}]}',
            '不要输出任何其他内容。',
            '',
            '【剧本参照稿】',
            scriptText,
          ].filter(Boolean).join('\n'),
        },
      ],
      { jsonMode: true, temperature: 0.8 }
    );
    const parsed = JSON.parse(extractJson(result.content)) as { lines?: unknown };
    const lines = (Array.isArray(parsed.lines) ? parsed.lines : [])
      .map(sanitizePerformedLine)
      .filter((l): l is DemoLine => !!l);
    // 演绎结果行数过少视为失败（剧本被截断），回退参照稿
    if (lines.length >= Math.max(4, Math.floor(reference.length / 2))) return lines;
  } catch {
    /* 落入兜底 */
  }
  return reference;
}

/** 加载新手指引流程配置（无配置返回 undefined，调用方走兜底逻辑） */
export async function getGuidance(store: Store, scenarioId: string): Promise<ScenarioGuidance | undefined> {
  return store.getScenarioGuidance(scenarioId);
}

const CN_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/**
 * 组装教练口播稿（第3步）：讲解要点 + 引用的讲解标准库条目，按"第一/第二…"编号。
 * 返回纯文本数组，每项一段口播。
 */
export function composeBriefing(guidance: ScenarioGuidance, standards: BriefingStandard[]): string[] {
  const referenced = guidance.briefingStandardIds
    .map((id) => standards.find((s) => s.id === id))
    .filter((s): s is BriefingStandard => !!s);
  const points = [
    ...guidance.keyPoints,
    ...referenced.map((s) => `${s.name}：${s.description}${s.example ? `例如：${s.example}` : ''}`),
  ];
  if (points.length === 0) return [];
  // 无示范模式（demoScriptId=null）的场景没有"刚才这段示范"，开场与收尾问句相应调整
  const hasDemo = guidance.demoScriptId != null;
  const lines = [hasDemo ? '先来讲解刚才这段示范的关键点。' : '先来讲解这个场景的关键要领。'];
  points.forEach((point, i) => {
    const numeral = CN_NUMERALS[i] ?? String(i + 1);
    lines.push(`第${numeral}，${point}`);
  });
  if (hasDemo) lines.push('想再听一次示范对白，还是直接开始模拟练习？');
  return lines;
}
