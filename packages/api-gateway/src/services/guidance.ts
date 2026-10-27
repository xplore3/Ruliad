import type { LLMGateway } from '@grasp-mvp/core';
import { DEMO_FAQ_ITEMS, type DemoFaqItem } from '../demo-faq.data.js';

/**
 * 地推引流课新手指引：资格判断 + 双 AI 示范对话剧本生成。
 * 示范剧本按标准地推流程确定性生成（客户问题与标准答案从地推开场景问答题库 demo-faq.data.ts 抽取），
 * 不依赖 LLM；资格判断与示范选择的 LLM 调用失败/解析失败均有确定性兜底，保证 mock 环境可跑通。
 */

/** 资格提问两问（与前端播放顺序一致） */
export const QUALIFY_QUESTIONS = ['你做过地推吗？', '你做过教培行业的地推吗？'] as const;

/** 示范剧本一行：销售 / 客户 / 小朋友 / 旁白；arousal 控制 TTS 情绪，excitement 为激情倍率（销售=3） */
export interface DemoLine {
  role: 'sales' | 'customer' | 'child' | 'narrator';
  text: string;
  arousal?: number;
  excitement?: number;
}

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

/** 清洗标准答案中的占位标记：xx岁 → 剧本中孩子的年龄；哥/姐 → 当前剧本的称呼（大哥/姐） */
function sanitizeFaq(text: string, age: number, address: string): string {
  return text.replace(/xx岁/g, `${age}岁`).replace(/哥\/姐/g, address).trim();
}

function pickTwoFaqs(): [DemoFaqItem, DemoFaqItem] {
  const pool = [...DEMO_FAQ_ITEMS];
  const first = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const second = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  return [first, second];
}

const SALES_SURNAMES = ['王', '李', '张', '刘', '陈'];

/**
 * 生成标准地推示范剧本（确定性模板，不走 LLM，保证流程逐字符合培训规范）：
 * 激情开场（大哥/姐 二选一且全剧统一）→ 客户驻足提问（题库问题+标准答案）→ 问年龄/黄金年龄
 * → 指着邀请函介绍体验课与地址 → 蹲下与孩子玩游戏 → 让孩子请家长订邀请函（小声→大声）
 * → 垫本子 → 客户再问（题库问题+标准答案）→ 递笔成交 → 孩子道谢 → 微信还是现金 → 致谢定时间道别。
 * version 仅作接口兼容，随机性来自称呼/年龄/姓氏/题库抽题。
 */
export function generateDemoScript(_version: number): DemoLine[] {
  // 开场称呼：大哥 或 姐 二选一，全剧统一；对应孩子口中的 爸爸/妈妈
  const address = Math.random() < 0.5 ? '大哥' : '姐';
  const parent = address === '大哥' ? '爸爸' : '妈妈';
  const age = 4 + Math.floor(Math.random() * 7); // 4~10 岁
  const surname = SALES_SURNAMES[Math.floor(Math.random() * SALES_SURNAMES.length)];
  const [faq1, faq2] = pickTwoFaqs();
  const answer1 = sanitizeFaq(faq1.faq, age, address);
  const answer2 = sanitizeFaq(faq2.faq, age, address);

  // 销售全程高唤醒（arousal≈0.9）+ 9 倍激情（excitement=9，语速/音调抬升顶到上限）；小朋友小声/大声用 arousal 区分
  const lines: DemoLine[] = [
    {
      role: 'sales',
      arousal: 0.95,
      text: `${address}，您好！像您这么有气质的家长，肯定不会拒绝孩子一次成长的机会！我们是天童英语培训机构的，我们想邀请您，带孩子来参加我们的英语试听活动！`,
    },
    { role: 'narrator', text: '客户听到介绍，放慢了脚步，停下来接过邀请函，表现出了兴趣。' },
    { role: 'customer', text: faq1.question },
    { role: 'sales', arousal: 0.9, text: answer1 },
    { role: 'sales', arousal: 0.9, text: `对了${address}，您家孩子今年几岁啦？` },
    { role: 'customer', text: `我家孩子今年${age}岁了。` },
    { role: 'sales', arousal: 0.95, text: `太好了！${age}岁就是孩子学习英语的黄金年龄！` },
    { role: 'narrator', text: '客户已经接过了邀请函，销售指着邀请函继续介绍。' },
    {
      role: 'sales',
      arousal: 0.9,
      text: '孩子过来以后，我们会像这副图画一样，给孩子安排一节英语的体验课，然后让孩子进行口语实践。到时候您觉得好，以后可以让孩子在我们这里学；如果您觉得不合适，也没有关系，到时候您听完以后自己做决定。',
    },
    {
      role: 'sales',
      arousal: 0.9,
      text: `您看，这是我们的地址，就在万达广场三楼。这是我的电话，您叫我小${surname}就行。这是我们的邀请函，您带孩子过来，需要您给孩子订一张邀请函，就5块钱，一个家庭都可以过来。来，在这边给孩子填写一下姓名和电话，到时候我们给孩子安排活动。`,
    },
    { role: 'narrator', text: '此时销售蹲下来，表示对孩子的亲切，并且和孩子玩一个英语小游戏，激发孩子的兴趣。' },
    { role: 'sales', arousal: 0.9, text: '小朋友，刚才我们玩的游戏好玩吗？' },
    { role: 'child', arousal: 0.6, text: '好玩！' },
    {
      role: 'sales',
      arousal: 0.9,
      text: `那${parent}给你花5块钱，给你订一张邀请函，到时候带你过来，我们玩更好玩的游戏，好不好啊？`,
    },
    { role: 'child', arousal: 0.2, text: '好！' },
    { role: 'sales', arousal: 1, text: '真棒！小朋友大声一点，好不好啊？' },
    { role: 'child', arousal: 0.85, text: '好！' },
    { role: 'sales', arousal: 0.9, text: `那小朋友，你把笔递给${parent}，让${parent}给你订一张邀请函。` },
    { role: 'narrator', text: `小朋友把笔递给了${parent}。销售站了起来，把本子递过去，垫在邀请函下面。` },
    { role: 'sales', arousal: 0.9, text: `${address}，您垫着写，这样舒服一点。` },
    { role: 'customer', text: faq2.question },
    { role: 'sales', arousal: 0.9, text: `${answer2}${address}，给孩子订上！` },
    { role: 'narrator', text: '说这句话的同时，要配合把笔从上往下落、并递给客户的肢体语言。' },
    { role: 'narrator', text: '客户在邀请函上填下了姓名和电话，销售撕下回执单。此时销售应该对孩子说话。' },
    {
      role: 'sales',
      arousal: 0.9,
      text: `小朋友，${parent}给你花5块钱订了一张邀请函，你跟${parent}说一声谢谢，好不好啊？`,
    },
    { role: 'child', arousal: 0.6, text: `谢谢${parent}！` },
    { role: 'sales', arousal: 0.9, text: `${address}，您是微信还是现金？` },
    {
      role: 'narrator',
      text: '客户完成缴费以后，不要忘记说"谢谢你的信任和支持"，并且现场定下试听时间。到这里为止，跟客户道别，地推的演示就结束了。',
    },
    {
      role: 'sales',
      arousal: 0.9,
      text: '谢谢您的信任和支持！那咱们就把试听时间定在本周六上午十点，到时候您带孩子直接过来就行！',
    },
    { role: 'narrator', text: '销售与客户道别，地推演示结束。' },
  ];
  // 销售台词激情拉满：arousal=1 × excitement=9 → 激情模式目标值：语速 1.15x（略快）、音调 1.1x（接近正常）、音量 65
  return lines.map((l) => (l.role === 'sales' ? { ...l, arousal: 1, excitement: 9 } : l));
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
