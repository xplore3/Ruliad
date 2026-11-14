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
          title: '尝试和孩子沟通并售卖邀请函',
          missing: '基本介绍已经完成，接下来主动和孩子沟通、激发兴趣，再尝试售卖邀请函',
          suggestion: '基本介绍已经完成，接下来主动和孩子沟通、激发兴趣，再尝试售卖邀请函。',
          done: { type: 'traineeSaid', all: ['邀请函|邀请卡|体验卡'], also: ['买|卖|订|购|付款|支付|定下|定购|定一张'] },
        },
        {
          key: 'contact',
          title: '让客户填写资料并付款',
          missing: '客户已经口头答应购买邀请函，下一步让其填写资料并且付款',
          suggestion: '客户已经口头答应购买邀请函，下一次应该让其填写资料并且付款。',
          done: { type: 'traineeSaid', all: ['填|登记|留'], also: ['姓名|名字|电话|联系方式'] },
        },
        {
          key: 'payment',
          title: '问清家长怎么付款',
          missing: '问清家长用微信、支付宝还是现金，并请家长现在付款',
          suggestion: '直接问：“您是微信还是支付宝？现在完成付款。”',
          done: { type: 'traineeSaid', all: ['微信|支付宝|现金|支付|付款'] },
        },
        {
          key: 'schedule',
          title: '和家长定好体验时间',
          missing: '和家长确定具体的到店体验时间',
          suggestion: '直接问：“您周六上午方便吗？我们现在把孩子到校体验的时间定下来。”',
          done: { type: 'traineeSaid', all: ['约|安排|确定'], also: ['时间|试听|体验|到校|周[一二三四五六日天]'] },
        },
      ],
      fallback: {
        title: '请家长现在确认参加',
        missing: '把前面的介绍变成一句清楚的行动邀请，请家长现在确认参加',
        suggestion: '明确请家长现在确认参加，不再让客户回去考虑。',
      },
      afterCardGuidance: {
        title: '递卡后，把活动介绍清楚，并让孩子产生兴趣',
        titleChildDone: '递卡后，把试听活动介绍完整',
        rationale: '家长拿过邀请函后，不要没有目的地闲聊，接着做好下面两件事：',
        rationaleChildDone: '你已经和孩子沟通过了，这部分不用重复。接下来把试听活动介绍完整：',
        activitySuggestion: '1. 继续介绍试听活动流程、学校地址、你的姓名和联系电话、邀请函售价；中间可以穿插询问孩子的年龄、有没有基础。',
        childSuggestion: '2. 主动跟孩子沟通，先让孩子对活动产生兴趣，这样家长订购邀请函的概率会大幅提升。',
      },
      stageAssessmentPrompt: '你是地推演练流程分析员。请阅读完整对话，按实际意思判断销售已经推进到哪个阶段，不要根据几个关键词机械判断，也不要只看最后一句话。参考流程：接卡→介绍活动、学校地址、姓名电话和售价并穿插询问年龄基础→与孩子沟通激发兴趣→客户口头答应购买→填写资料→付款→约定试听时间。阶段定义：accept-card=客户没有实际接卡；after-card-guidance=已接卡但尚未获得口头购买承诺，活动介绍或孩子沟通仍需指导；sell=基本介绍已经完成但尚未获得口头购买承诺，应与孩子沟通激发兴趣并尝试售卖；contact=客户已经口头答应购买但尚未填写资料；payment=已经填写资料但尚未付款；schedule=已经付款但尚未约定试听时间；complete=以上动作均已完成。特别注意：“肯定”“一定”“五元”本身不等于客户答应购买或已经付款，只有明确答应购买、实际购买行动或付款事实才算进入相应阶段。直接对孩子说话、讲故事或做游戏属于有效孩子沟通。reason 用通俗中文说明已完成的关键动作和当前缺失步骤，不得虚构。',
      sellChildDoneSuggestion: '基本介绍和孩子沟通已经完成，接下来请家长订购邀请函。',
      rationaleTemplate: '{evidence}家长如果没有听清楚下一步该做什么，往往就会直接离开。接下来最需要补上的是{missing}，这次先练这一步。',
      incompleteItem: {
        rationale: '客户给了继续沟通的机会，但销售没有继续请家长购买、留下信息、付款或定下体验时间，所以本场没有完成。',
        betterScript: '来，您拿上邀请函，在这边填一下姓名和电话。您是微信还是支付宝？我们现在订好，再约孩子到校体验的时间。',
      },
      vagueBetterScript: {
        vaguePattern: '(?:您|你)(?:先)?(?:看|了解)(?:一下|下)',
        concretePattern: '拿上|接过|登记|填写|支付|购买|订好|定下|约定|安排|报名',
        replacement: '来，您拿上邀请函，我给您登记姓名和电话，再约孩子周六到校体验。',
      },
      acceptCard: {
        textPattern: '邀请函|邀请卡|体验卡|介绍单|活动介绍单|宣传单|传单',
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
    id: 'suggestion-phone-sales-incomplete',
    tenantId: 'tenant-demo',
    name: '电销·未完成演练改进建议',
    key: SUGGESTION_KEYS.groundPushIncomplete,
    category: '电销',
    data: {
      childFailure: {
        completionReasonContains: '家长认为孩子不感兴趣',
        title: '改进与孩子沟通的策略',
        suggestion: '先给孩子情感支持，再讲一个能逗孩子开心的故事或做有趣游戏，最后才问孩子是否喜欢；不要用无铺垫的封闭式问题逼孩子表态。',
      },
      stages: [
        {
          key: 'accept-card',
          title: '先说明活动并邀请家长参加',
          missing: '先用陈述句说明199元4次体验课活动并邀请家长参加，不使用封闭式邀约',
          suggestion: '直接说：“我们有一个199元4次体验课活动，想邀请您参加。”',
          done: { type: 'customerAcceptedInvitation' },
        },
        {
          key: 'sell',
          title: '介绍活动并尝试电话下单',
          missing: '介绍活动流程、学校地址、自己的姓名和199元体验课价格，再引导家长打开大众点评下单',
          suggestion: '介绍活动流程、学校地址、自己的姓名和199元体验课价格，再引导家长打开大众点评下单。',
          done: { type: 'traineeSaid', all: ['大众点评|下单|订购|购买'], also: ['打开|点击|进入|下单|订购|购买|付款'] },
        },
        {
          key: 'contact',
          title: '让客户填写孩子资料并完成下单',
          missing: '客户已经口头答应购买，下一步让其填写孩子姓名、年龄、基础和联系方式，并在大众点评完成付款',
          suggestion: '客户已经口头答应购买，下一步引导其填写孩子姓名、年龄、基础和联系方式，并在大众点评完成付款。',
          done: { type: 'traineeSaid', all: ['填|登记|留'], also: ['姓名|名字|电话|联系方式'] },
        },
        {
          key: 'payment',
          title: '提醒客户完成付款',
          missing: '客户已经填好资料，接下来明确请客户在大众点评完成支付',
          suggestion: '直接说：“资料已经填好了，您现在在大众点评完成付款就行。”',
          done: { type: 'traineeSaid', all: ['微信|支付宝|现金|支付|付款|大众点评'] },
        },
        {
          key: 'schedule',
          title: '和家长定好试听时间',
          missing: '和家长确定具体的试听时间，尽量约在两周以内',
          suggestion: '直接问：“您周六上午方便吗？我们现在把孩子试听的时间定下来。”',
          done: { type: 'traineeSaid', all: ['约|安排|确定'], also: ['时间|试听|体验|到校|周[一二三四五六日天]'] },
        },
      ],
      fallback: {
        title: '请家长现在完成下单',
        missing: '把活动介绍转化为明确的大众点评下单动作',
        suggestion: '直接说：“来，您打开大众点评，我教您如何下单。”',
      },
      afterCardGuidance: {
        title: '邀约后，把活动和孩子兴趣都介绍清楚',
        titleChildDone: '邀约后，把199元体验课介绍完整',
        rationale: '家长已经听过活动邀请，接下来不要没有目的地闲聊，先把下面两件事做好：',
        rationaleChildDone: '你已经和孩子沟通过了，这部分不用重复。接下来把199元体验课介绍完整：',
        activitySuggestion: '1. 继续介绍试听活动流程、学校地址、你的姓名、199元4次体验课的内容和售价；手机可留电话，座机不用提电话，中间可穿插询问孩子年龄和基础。',
        childSuggestion: '2. 主动跟孩子沟通，先让孩子对活动产生兴趣，再趁热请家长打开大众点评下单，这样更容易成交。',
      },
      stageAssessmentPrompt: '你是电销演练流程分析员。请阅读完整对话，按实际意思判断销售已经推进到哪个阶段，不要根据几个关键词机械判断，也不要只看最后一句话。参考流程：非封闭式活动邀约→介绍活动、学校地址、姓名和199元体验课→与孩子沟通激发兴趣→客户口头答应购买→填写孩子资料→大众点评付款→约定试听时间。阶段定义：accept-card=没有完成有效的活动邀约；after-card-guidance=已明确说过活动名称或体验课并邀请参加，但尚未获得口头购买承诺，活动介绍或孩子沟通仍需指导，只要明确作出过邀约，后续说话无重点也不能回退为未邀约；sell=基本介绍完成但尚未获得口头购买承诺，应与孩子沟通并尝试售卖；contact=客户已经口头答应购买但尚未填写孩子资料；payment=已填写资料但尚未完成大众点评付款；schedule=已经付款但尚未约定试听时间；complete=以上动作均已完成。“肯定”“一定”“199元”本身不等于客户答应购买或已经付款，只有明确答应、实际购买行动或付款事实才算进入相应阶段。直接对孩子说话、讲故事或做游戏属于有效孩子沟通。reason 用通俗中文说明已完成动作和当前缺失步骤，不得虚构。',
      sellChildDoneSuggestion: '基本介绍和孩子沟通已经完成，接下来请家长打开大众点评下单。',
      rationaleTemplate: '{evidence}家长如果没有听清楚下一步该做什么，往往就会直接结束通话。接下来最需要补上的是{missing}，这次先练这一步。',
      incompleteItem: {
        rationale: '客户给了继续沟通的机会，但销售没有继续介绍活动、激发孩子兴趣或推进大众点评下单，所以本场没有完成。',
        betterScript: '我们有一个199元4次体验课活动，想邀请您参加。来，您打开大众点评，我教您如何下单。',
      },
      vagueBetterScript: {
        vaguePattern: '(?:您|你)(?:先)?(?:看|了解)(?:一下|下)',
        concretePattern: '活动|介绍|孩子|大众点评|下单|购买|付款|约定|安排|报名',
        replacement: '我们有一个199元4次体验课活动，想邀请您参加。来，您打开大众点评，我教您如何下单。',
      },
      acceptCard: {
        textPattern: '邀请函|邀请卡|体验卡|介绍单|活动介绍单|宣传单|传单',
        negativePattern: '没接|没有接|不接|未接|没拿|没有拿|不收',
        positivePattern: '接过|拿到|收下|拿了',
        declinedNegativePattern: '没接|没有接|不接|未接|没拿|没有拿',
        retreatPattern: '拿[上着]?.*回去|回去.*(?:考虑|琢磨)',
        noAcceptEvidence: '对话中没有完成有效的活动邀约',
        declinedEvidence: '只提到活动但没有清楚邀请家长参加',
        retreatEvidence: '让客户先回去考虑，不算持续推进',
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
      intro: '你是地推主动推进判定器。地推必须由销售主导局面，客户的中性话语只是销售推进的机会，不能由客户替销售推进。接卡后的标准顺序是：先介绍活动，再介绍学校地址，再介绍销售自己的姓名和电话，再说明邀请函售价，然后请家长购买；购买后再引导填写姓名电话、选择支付方式并约定到校或体验时间。实质推进包括按这个顺序补足当前缺失步骤并完成当场购买。与成交相关的必要介绍和简洁答疑在介绍阶段属于正常推进；但介绍完成后仍漫无目的闲聊、只解释不行动、等待客户表态、反复说“您可以来看看/来试听”而没有当场行动，都不算实质推进。客户主动问“试听流程是什么”“接下来怎么办”不代表销售主动，销售仍必须自己提出下一步行动。reason 是给学员看的改进说明，必须用通俗中文准确写出已经做了什么、还缺哪一步；此前已经递出邀请函或客户已经接过介绍单时，不得再说没有递卡，应指出当前缺少的是购买、填写信息、付款或约定体验时间中的哪一步。不要使用“实质推进”“成交动作”“最后机会机制”或 substantive 等技术化措辞。',
      lastChance: '当前是客户已经表示要考虑后的最后一次机会：只要销售仍坚持推动销售进程就 substantive=true。有效推进包括与孩子沟通、激发孩子兴趣、承接家长的话继续介绍试听活动流程、学校地址、联系电话、邀请函售价，以及请家长购买、填写信息、付款或约定时间。不得因为转换沟通对象、补充信息或没有直接要求购买就结束；只有退缩、放弃、道别、漫无目的闲聊，或既没有解决问题也没有推进任何下一步时才 substantive=false。reason 用通俗中文说明当前阶段和仍然有效的推进动作。',
      normal: '当前尚在正常演练：必要且不过度的课程、活动或邀请函介绍可以 substantive=true；如果已有足够介绍仍没有成交动作，应 substantive=false。',
      fallbackReason: '暂时无法判断这一轮是否继续推进，先让客户继续沟通。',
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
