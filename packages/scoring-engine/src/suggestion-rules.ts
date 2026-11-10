/**
 * 改进建议库：默认规则数据 + 解析。
 * 评分引擎的点评/改进建议一律从库读取；库中无对应规则时回落到这里的内置默认值（与迁移前代码文案逐字一致）。
 */
import type { SuggestionRule } from '@grasp-mvp/core';

export const SUGGESTION_KEYS = {
  groundPushIncomplete: 'ground-push-incomplete',
  tabooDeterministic: 'taboo-deterministic',
  genericGoal: 'generic-goal',
  summaryFallback: 'summary-fallback',
  groundPushProgress: 'ground-push-progress',
} as const;

/** 内置默认规则（种子数据 + 无库时的兜底）；修改文案请通过场景编辑器改库，不要改这里 */
export const DEFAULT_SUGGESTION_RULES: SuggestionRule[] = [
  {
    id: 'suggestion-ground-push-incomplete',
    tenantId: 'tenant-demo',
    name: '地推·未完成演练改进建议',
    key: SUGGESTION_KEYS.groundPushIncomplete,
    category: '地推',
    data: {
      childFailure: {
        completionReasonContains: '家长认为孩子不感兴趣',
        title: '改进与孩子沟通的策略',
        suggestion: '先给孩子情感支持，再讲一个能逗孩子开心的故事或做有趣游戏，最后才问孩子是否喜欢；不要用无铺垫的封闭式问题逼孩子表态。',
      },
      stages: [
        {
          key: 'accept-card',
          title: '先让家长拿上邀请函',
          missing: '让家长现场实际接过邀请函；只展示邀请卡、让家长回去看或回去考虑都不算完成接卡',
          suggestion: '先只练递卡这一步：将邀请函递给家长并明确说：“来，您拿上邀请函，我给您介绍一下活动。”',
          done: { type: 'customerAcceptedInvitation' },
        },
        {
          key: 'sell',
          title: '明确现场销售邀请函',
          missing: '在家长接卡后明确提出现场购买邀请函',
          suggestion: '直接说：“这张邀请函5元，您现在给孩子订一张。”',
          done: { type: 'traineeSaid', all: ['邀请函|邀请卡|体验卡'], also: ['买|卖|订|定|购|付款|支付|五元|5元|五块'] },
        },
        {
          key: 'contact',
          title: '引导填写姓名和电话',
          missing: '明确引导家长填写姓名和电话',
          suggestion: '直接说：“来，您在这里填一下姓名和电话。”',
          done: { type: 'traineeSaid', all: ['填|登记|留'], also: ['姓名|名字|电话|联系方式'] },
        },
        {
          key: 'payment',
          title: '引导选择支付方式',
          missing: '明确引导家长选择支付方式并完成付款',
          suggestion: '直接问：“您是微信还是支付宝？现在完成付款。”',
          done: { type: 'traineeSaid', all: ['微信|支付宝|现金|支付|付款'] },
        },
        {
          key: 'schedule',
          title: '约定到校体验时间',
          missing: '明确与家长约定到校体验时间',
          suggestion: '直接问：“您周六上午方便吗？我们现在把孩子到校体验的时间定下来。”',
          done: { type: 'traineeSaid', all: ['约|安排|确定'], also: ['时间|试听|体验|到校|周[一二三四五六日天]'] },
        },
      ],
      fallback: {
        title: '完成当场成交动作',
        missing: '把已有介绍转化为明确的当场成交行动',
        suggestion: '明确请家长现在确认参加，不再让客户回去考虑。',
      },
      rationaleTemplate: '{evidence}地推客户通常比较被动，销售没有给出明确的下一步动作，客户往往就会直接离开。当前最早缺失的是{missing}，本次只改进这一步。',
      incompleteItem: {
        rationale: '客户已给最后推进机会，但学员仍没有实质成交动作，地推主动性不合格，本场未完成。',
        betterScript: '来，您拿上邀请函，在这边填一下姓名和电话。您是微信还是支付宝？我们现在订好，再约孩子到校体验的时间。',
      },
      vagueBetterScript: {
        vaguePattern: '(?:您|你)(?:先)?(?:看|了解)(?:一下|下)',
        concretePattern: '拿上|接过|登记|填写|支付|购买|订好|定下|约定|安排|报名',
        replacement: '来，您拿上邀请函，我给您登记姓名和电话，再约孩子周六到校体验。',
      },
      acceptCard: {
        textPattern: '邀请函|邀请卡|体验卡',
        negativePattern: '没接|没有接|不接|未接|没拿|没有拿|不收',
        positivePattern: '接过|拿到|收下|拿了',
        declinedNegativePattern: '没接|没有接|不接|未接|没拿|没有拿',
        retreatPattern: '拿[上着]?.*回去|回去.*(?:考虑|琢磨)',
        noAcceptEvidence: '对话中没有客户实际接过邀请函的记录',
        declinedEvidence: '客户看过邀请卡但没有实际接过',
        retreatEvidence: '“拿上回去琢磨一下”是让客户离开，不算完成现场递卡',
      },
    },
  },
  {
    id: 'suggestion-taboo-deterministic',
    tenantId: 'tenant-demo',
    name: '忌讳项·确定性规则改进建议',
    key: SUGGESTION_KEYS.tabooDeterministic,
    data: {
      fluency: { title: '避免磕磕绊绊和填充词', suggestion: '放慢语速，先组织好语言再完整表达，减少嗯、啊和重复断句。' },
      repetition: { title: '同一意思只表达一次', suggestion: '直接回应客户当前的问题，同一意思表达一次即可，把新信息讲简洁、讲全面。' },
      trialInvitation: { title: '用开放式问题推进邀约', suggestion: '您什么时候方便参加？我给您安排。' },
      closedAdvanceQuestions: { title: '避免封闭式推进提问', suggestion: '我直接给您介绍一下我们课程的核心优势，您听听看是否适合孩子。' },
      childClosedQuestions: { title: '先铺垫再询问孩子兴趣', suggestion: '先尊重和鼓励孩子，再讲一个有趣的故事或做个小游戏，孩子开心后再问他喜不喜欢。' },
      knowledgeHonesty: { title: '不确定时先核实，不信口胡说', suggestion: '我是新来的，对您问的问题确实不清楚，我马上了解清楚再回复您。' },
    },
  },
  {
    id: 'suggestion-generic-goal',
    tenantId: 'tenant-demo',
    name: '通用·改进目标兜底建议',
    key: SUGGESTION_KEYS.genericGoal,
    data: {
      fatalTitle: '避免合规红线话术',
      fatalSuggestion: '删除任何保证提分、包过或绝对化效果承诺，改为如实介绍课程特点和适用情况。',
      noIssueTitle: '保持当前表现',
      noIssueRationale: '本次未发现需要优先改进的问题。',
      noIssueSuggestion: '继续保持当前沟通方式，并尝试更高难度的练习场景。',
      deductionItemFallback: '针对「{itemName}」进行专项练习，避免再次触发同类扣分。',
      scoredItemFallback: '针对「{itemName}」进行专项练习，再完成一次同类场景演练。',
      receptionQuestionFallback: '针对第{index}题《{question}》重新组织回答。',
    },
  },
  {
    id: 'suggestion-summary-fallback',
    tenantId: 'tenant-demo',
    name: '通用·教练总结兜底模板',
    key: SUGGESTION_KEYS.summaryFallback,
    data: {
      totalLine: '本次练习总分 {totalScore} 分，{passedText}（及格线 {passScore} 分）。',
      bestLine: '表现较好：{itemName}（{score} 分），继续保持。',
      goalReasonLine: '最需要改进：{title}——{rationale}',
      goalSuggestionLine: '具体建议：{suggestion}',
      fatalLine: '注意：本次话术命中合规红线，一票否决，务必避免任何效果承诺类表述。',
      worstLine: '最需要改进：{itemName}（{score} 分）{reason}',
      worstSuggestion: '建议：针对「{itemName}」参照报告中的更优话术做专项练习，再练一次巩固。',
      goodLine: '建议：保持当前节奏，尝试在更高难度场景中巩固发挥。',
    },
  },
  {
    id: 'suggestion-ground-push-progress',
    tenantId: 'tenant-demo',
    name: '地推·主动推进判定规则',
    key: SUGGESTION_KEYS.groundPushProgress,
    category: '地推',
    data: {
      intro: '你是地推主动推进判定器。地推必须由销售主导局面，客户的中性话语只是销售推进的机会，不能由客户替销售推进。销售完成必要介绍后，应主动售卖邀请函并引导客户完成下一步。实质推进包括：明确递出并售卖邀请函、引导填写姓名或联系方式、引导选择并完成支付方式、明确约定到校或体验时间。与成交相关的必要介绍和简洁答疑在介绍阶段属于正常推进；但介绍完成后仍漫无目的闲聊、只解释不行动、等待客户表态、反复说“您可以来看看/来试听”而没有当场行动，都不算实质推进。客户主动问“试听流程是什么”“接下来怎么办”不代表销售主动，销售仍必须自己提出下一步行动。',
      lastChance: '当前是客户说“我回去琢磨琢磨”后的最后一次机会：只有坚持并作出上述明确成交行动才 substantive=true；退缩、道别、空泛邀请、继续介绍或闲聊都必须 substantive=false。',
      normal: '当前尚在正常演练：必要且不过度的课程、活动或邀请函介绍可以 substantive=true；如果已有足够介绍仍没有成交动作，应 substantive=false。',
      fallbackReason: '推进判定异常，保守继续演练',
    },
  },
];

export type SuggestionData = Record<string, unknown>;

/** 读取规则数据：优先该分类的库规则，其次通用库规则，最后内置默认值 */
export function suggestionData<T = SuggestionData>(
  rules: SuggestionRule[] | undefined,
  key: string,
  category?: string,
): T {
  const found = rules?.find((r) => r.key === key && r.category === category)
    ?? rules?.find((r) => r.key === key && !r.category);
  if (found) return found.data as T;
  const fallback = DEFAULT_SUGGESTION_RULES.find((r) => r.key === key && (r.category === category || !r.category));
  return (fallback?.data ?? {}) as T;
}

export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
