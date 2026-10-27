import type { LLMGateway, Scenario } from '@grasp-mvp/core';

/**
 * 地推引流课新手指引：资格判断 + 双 AI 示范对话剧本生成。
 * 所有 LLM 调用失败/解析失败均有确定性兜底，保证 mock 环境可跑通。
 */

/** 资格提问两问（与前端播放顺序一致） */
export const QUALIFY_QUESTIONS = ['你做过地推吗？', '你做过教培行业的地推吗？'] as const;

/** 示范剧本一行：销售 / 客户 / 旁白 */
export interface DemoLine {
  role: 'sales' | 'customer' | 'narrator';
  text: string;
}

/** 销售固定第一句开场白（逐字，不允许 LLM 改动） */
export const FIXED_OPENING =
  '大哥/姐 您好，像您这么有气质的家长，肯定不会拒绝孩子一次成长的机会。我们是天童英语培训机构的，我们想邀请您，带孩子来参加我们的英语试听活动。';

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
 * 判断学员是否做过地推 / 教培地推。
 * qa 为累积问答（可能只有第 1 题）。两题都答"做过"才返回 true；任一题"没做过"或缺答 → false。
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
            qa.length === 1
              ? '只输出 JSON：{"didGroundPush": true 或 false}'
              : '只输出 JSON：{"didGroundPush": true 或 false, "didEduGroundPush": true 或 false}（按问题顺序对应）',
            '不要输出任何其他内容。',
          ].join('\n'),
        },
      ],
      { jsonMode: true, temperature: 0 }
    );
    const parsed = JSON.parse(extractJson(result.content)) as {
      didGroundPush?: unknown;
      didEduGroundPush?: unknown;
    };
    const didGroundPush =
      typeof parsed.didGroundPush === 'boolean' ? parsed.didGroundPush : fallbackExperienced(qa[0].answer);
    if (qa.length === 1) return didGroundPush;
    const didEdu =
      typeof parsed.didEduGroundPush === 'boolean' ? parsed.didEduGroundPush : fallbackExperienced(qa[1].answer);
    return didGroundPush && didEdu;
  } catch {
    // LLM 失败/解析失败：逐题关键词兜底，全部判"做过"才算有经验
    return qa.every((x) => fallbackExperienced(x.answer));
  }
}

/** 客户反应类型池：每次生成随机抽 1-2 种注入 prompt */
const CUSTOMER_REACTIONS = [
  '感兴趣：放慢脚步，接住邀请函，愿意多听几句',
  '摆手拒绝：客气地说不需要，转身要走',
  '赶时间：边看手机边说赶时间，匆匆想离开',
  '质疑机构：问"你们是什么机构，靠谱吗"',
  '询问价格：直接问试听课要不要钱、后续怎么收费',
  '孩子已在学：说孩子已经在别的地方学英语了',
  '警惕推销：怀疑是骗子，质问要联系方式干什么',
  '敷衍应付：嘴上应付"好好好"，脚步不停',
];

/** 兜底剧本（LLM 失败 / mock 环境使用）：固定开场白 + 客户停下接邀请函主线 */
export function fallbackDemoScript(): DemoLine[] {
  return [
    { role: 'sales', text: FIXED_OPENING },
    { role: 'narrator', text: '客户放慢脚步，接住邀请函，表现出了兴趣。' },
    { role: 'customer', text: '英语试听？我家孩子确实该补补英语了，你们这活动在哪儿啊？' },
    { role: 'sales', text: '就在咱们附近的天童英语校区，这周末就有一场，全程免费，孩子还能领一份小礼物。' },
    { role: 'customer', text: '免费是吧，那大概多长时间？我怕孩子坐不住。' },
    { role: 'sales', text: '四十分钟左右，老师都是专门带少儿的，课堂全是游戏互动，孩子都喜欢得很。您留个联系方式，我给孩子留个名额？' },
    { role: 'narrator', text: '客户停下脚步听完介绍，主动留下了联系方式，预约了周末试听。' },
    { role: 'customer', text: '行，那我登记一下，周末带孩子去看看。' },
  ];
}

function pickReactions(count: number): string[] {
  const pool = [...CUSTOMER_REACTIONS];
  const picked: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

/** 校验 LLM 输出的剧本：JSON 数组、role 合法、4-12 行、首行必须是固定开场白、至少各一行客户与旁白 */
function validateDemoScript(raw: unknown): DemoLine[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < 4 || raw.length > 12) return null;
  const lines: DemoLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const { role, text } = item as { role?: unknown; text?: unknown };
    if (role !== 'sales' && role !== 'customer' && role !== 'narrator') return null;
    if (typeof text !== 'string' || !text.trim() || text.length > 200) return null;
    lines.push({ role, text: text.trim() });
  }
  if (lines[0].role !== 'sales' || lines[0].text !== FIXED_OPENING) return null;
  if (!lines.some((l) => l.role === 'customer')) return null;
  if (!lines.some((l) => l.role === 'narrator')) return null;
  return lines;
}

/**
 * 生成双 AI 示范对话剧本。任何失败（LLM 异常、输出不合法、mock 环境）都返回内置兜底剧本。
 * version 仅用于让 prompt 体现"换个版本"，随机性主要来自客户反应类型池抽样。
 */
export async function generateDemoScript(
  gateway: LLMGateway,
  scenario: Scenario,
  version: number
): Promise<DemoLine[]> {
  const reactions = pickReactions(1 + Math.floor(Math.random() * 2));
  try {
    const result = await gateway.forTask('judge').chat(
      [
        {
          role: 'user',
          content: [
            '你是销售培训编剧。请编写一段"地推引流"示范对话剧本，用于给没有地推经验的新手销售员做示范。',
            '场景是培训机构的销售在商场/街头向路人家长推销英语试听活动。',
            `场景名称：${scenario.name}`,
            scenario.personaTitle ? `客户设定：${scenario.personaTitle}` : '',
            scenario.coverageTopics?.length ? `话术要点：${scenario.coverageTopics.join('、')}` : '',
            `这是第 ${version} 个版本，请与常见版本有所变化。`,
            '',
            '硬性要求：',
            `1. 第一句必须是销售说的这句话，逐字照抄，一字不改：「${FIXED_OPENING}」`,
            `2. 客户的反应要体现以下类型（自然融入，不要点名类型）：${reactions.join('；')}。`,
            '3. 旁白（narrator）用于解说客户的动作和反应，例如"客户放慢脚步，接住邀请函，表现出了兴趣"。',
            '4. 销售要演示标准打法：开场破冰 → 介绍活动 → 化解异议 → 邀约留资。',
            '5. 总长度 4 到 12 行，每行不超过 60 字，口语化。',
            '',
            '只输出 JSON 数组，不要任何其他文字：',
            '[{"role":"sales","text":"..."},{"role":"customer","text":"..."},{"role":"narrator","text":"..."}]',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      { jsonMode: true, temperature: 0.9 }
    );
    const lines = validateDemoScript(JSON.parse(extractJson(result.content)));
    if (lines) return lines;
  } catch {
    /* 落入兜底 */
  }
  return fallbackDemoScript();
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
