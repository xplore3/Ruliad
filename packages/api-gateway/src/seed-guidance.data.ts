import type { BriefingStandard, DemoScript, RealismStandard, ScenarioGuidance } from '@grasp-mvp/core';

const TENANT = 'tenant-demo';

/** 讲解标准库 id（新手指引流程配置引用） */
export const BRIEFING_STANDARD_IDS = {
  tone: 'std-analysis-tone',
  pace: 'std-analysis-pace',
  method: 'std-analysis-method',
  etiquette: 'std-analysis-etiquette',
} as const;

/** 演练真实度标准库 id（新手指引流程配置引用） */
export const REALISM_STANDARD_IDS = {
  reaction: 'std-realism-reaction',
  objection: 'std-realism-objection',
  stalling: 'std-realism-stalling',
  emotion: 'std-realism-emotion',
} as const;

/** 讲解标准库（第3步「讲解」口播稿引用的标准） */
export const BRIEFING_STANDARDS: BriefingStandard[] = [
  {
    id: BRIEFING_STANDARD_IDS.tone,
    tenantId: TENANT,
    name: '语调标准',
    category: 'tone',
    description:
      '地推场景语调要激情饱满，开场即拉高能量；咨询接待场景语调亲切温和，像朋友聊天；电话销售场景语调温柔有激情，像谈恋爱一样有耐心。',
    example: '地推开场："大哥，您好！像您这么有气质的家长，肯定不会拒绝孩子一次成长的机会！"',
  },
  {
    id: BRIEFING_STANDARD_IDS.pace,
    tenantId: TENANT,
    name: '语速标准',
    category: 'pace',
    description:
      '地推场景语速中等偏快，抢在客户走开之前说完价值主张；咨询接待语速中等，吐字清晰从容；电话销售语速中等偏慢，给客户留出思考和回应的时间。',
  },
  {
    id: BRIEFING_STANDARD_IDS.method,
    tenantId: TENANT,
    name: '关键方法标准',
    category: 'method',
    description:
      '开场30秒内抓住客户注意力；用"黄金年龄"话术制造紧迫感；通过与孩子互动（小游戏、讲故事）让孩子促单；成交临门一脚要果断，把笔递到客户手里。',
    example: '"太好了！6岁就是孩子学习英语的黄金年龄！"',
  },
  {
    id: BRIEFING_STANDARD_IDS.etiquette,
    tenantId: TENANT,
    name: '礼仪标准',
    category: 'etiquette',
    description:
      '像联通客服那样礼节周到：开口先问好，全程使用敬语；成交后必须说"谢谢您的信任和支持"，并现场定下试听时间，最后规范道别。',
  },
];

/** 演练真实度标准库（第4步：AI 客户逼真度标准） */
export const REALISM_STANDARDS: RealismStandard[] = [
  {
    id: REALISM_STANDARD_IDS.reaction,
    tenantId: TENANT,
    name: '反应自然度',
    category: 'reaction',
    description: '客户的回答要有口语化的犹豫、停顿和思考，不机械配合销售的每一句话，像真实路人一样有自己的节奏。',
  },
  {
    id: REALISM_STANDARD_IDS.objection,
    tenantId: TENANT,
    name: '拒绝行为真实度',
    category: 'objection',
    description: '按当前难度提出真实异议：价格太贵、孩子没时间、已经报了别家等，异议要具体可信，而不是泛泛地说"不需要"。',
  },
  {
    id: REALISM_STANDARD_IDS.stalling,
    tenantId: TENANT,
    name: '拖延行为真实度',
    category: 'stalling',
    description: '客户会使用真实拖延模式："我再想想""回去问问孩子""下次再说吧"，给销售制造促单压力。',
  },
  {
    id: REALISM_STANDARD_IDS.emotion,
    tenantId: TENANT,
    name: '情绪变化真实度',
    category: 'emotion',
    description: '客户的情绪要随对话自然过渡：被打动时语气软化，被纠缠时不耐烦，情绪变化有铺垫、不突兀。',
  },
];

const GROUND_PUSH_REALISM = [
  REALISM_STANDARD_IDS.reaction,
  REALISM_STANDARD_IDS.objection,
  REALISM_STANDARD_IDS.stalling,
  REALISM_STANDARD_IDS.emotion,
];
const ALL_BRIEFING = [
  BRIEFING_STANDARD_IDS.tone,
  BRIEFING_STANDARD_IDS.pace,
  BRIEFING_STANDARD_IDS.method,
  BRIEFING_STANDARD_IDS.etiquette,
];

/**
 * 示范剧本库种子（4 条，按业务线分支：地推/电销/接待咨询/现场成交）。
 * 内容迁移自原 SCENARIO_GUIDANCES 内嵌 demo 模板（地推剧本迁移自 services/guidance.ts 原 generateDemoScript，
 * 销售行 arousal:1 / excitement:9 已写死；咨询接待与电话销售剧本来自培训大纲对白，客户提问处用 FAQ 池占位）。
 */
export const DEMO_SCRIPTS: DemoScript[] = [
  {
    id: 'demo-script-ground-push',
    tenantId: TENANT,
    category: '地推',
    name: '地推引流示范剧本',
    faqPick: 2,
    faqPoolRef: 'ground-push-demo-faq',
    variables: {
      address: { kind: 'choice', options: ['大哥', '姐'] },
      parent: { kind: 'map', from: 'address', mapping: { 大哥: '爸爸', 姐: '妈妈' } },
      age: { kind: 'intRange', min: 4, max: 10 },
      surname: { kind: 'choice', options: ['王', '李', '张', '刘', '陈'] },
    },
    lines: [
      {
        role: 'sales',
        arousal: 1,
        excitement: 9,
        text: '${address}，您好！像您这么有气质的家长，肯定不会拒绝孩子一次成长的机会！我们是天童英语培训机构的，我们想邀请您，带孩子来参加我们的英语试听活动！',
      },
      { role: 'narrator', text: '客户听到介绍，放慢了脚步，停下来接过邀请函，表现出了兴趣。' },
      { role: 'customer', text: '${faq1.question}' },
      { role: 'sales', arousal: 1, excitement: 9, text: '${faq1.answer}' },
      { role: 'sales', arousal: 1, excitement: 9, text: '对了${address}，您家孩子今年几岁啦？' },
      { role: 'customer', text: '我家孩子今年${age}岁了。' },
      { role: 'sales', arousal: 1, excitement: 9, text: '太好了！${age}岁就是孩子学习英语的黄金年龄！' },
      { role: 'narrator', text: '客户已经接过了邀请函，销售指着邀请函继续介绍。' },
      {
        role: 'sales',
        arousal: 1,
        excitement: 9,
        text: '孩子过来以后，我们会像这副图画一样，给孩子安排一节英语的体验课，然后让孩子进行口语实践。到时候您觉得好，以后可以让孩子在我们这里学；如果您觉得不合适，也没有关系，到时候您听完以后自己做决定。',
      },
      {
        role: 'sales',
        arousal: 1,
        excitement: 9,
        text: '您看，这是我们的地址，就在万达广场三楼。这是我的电话，您叫我小${surname}就行。这是我们的邀请函，您带孩子过来，需要您给孩子订一张邀请函，就5块钱，一个家庭都可以过来。来，在这边给孩子填写一下姓名和电话，到时候我们给孩子安排活动。',
      },
      { role: 'narrator', text: '此时销售蹲下来，表示对孩子的亲切，并且和孩子玩一个英语小游戏，激发孩子的兴趣。' },
      { role: 'sales', arousal: 1, excitement: 9, text: '小朋友，刚才我们玩的游戏好玩吗？' },
      { role: 'child', arousal: 0.6, text: '好玩！' },
      {
        role: 'sales',
        arousal: 1,
        excitement: 9,
        text: '那${parent}给你花5块钱，给你订一张邀请函，到时候带你过来，我们玩更好玩的游戏，好不好啊？',
      },
      { role: 'child', arousal: 0.2, text: '好！' },
      { role: 'sales', arousal: 1, excitement: 9, text: '真棒！小朋友大声一点，好不好啊？' },
      { role: 'child', arousal: 0.85, text: '好！' },
      {
        role: 'sales',
        arousal: 1,
        excitement: 9,
        text: '那小朋友，你把笔递给${parent}，让${parent}给你订一张邀请函。',
      },
      { role: 'narrator', text: '小朋友把笔递给了${parent}。销售站了起来，把本子递过去，垫在邀请函下面。' },
      { role: 'sales', arousal: 1, excitement: 9, text: '${address}，您垫着写，这样舒服一点。' },
      { role: 'customer', text: '${faq2.question}' },
      { role: 'sales', arousal: 1, excitement: 9, text: '${faq2.answer}${address}，给孩子订上！' },
      { role: 'narrator', text: '说这句话的同时，要配合把笔从上往下落、并递给客户的肢体语言。' },
      { role: 'narrator', text: '客户在邀请函上填下了姓名和电话，销售撕下回执单。此时销售应该对孩子说话。' },
      {
        role: 'sales',
        arousal: 1,
        excitement: 9,
        text: '小朋友，${parent}给你花5块钱订了一张邀请函，你跟${parent}说一声谢谢，好不好啊？',
      },
      { role: 'child', arousal: 0.6, text: '谢谢${parent}！' },
      { role: 'sales', arousal: 1, excitement: 9, text: '${address}，您是微信还是现金？' },
      {
        role: 'narrator',
        text: '客户完成缴费以后，不要忘记说"谢谢你的信任和支持"，并且现场定下试听时间。到这里为止，跟客户道别，地推的演示就结束了。',
      },
      {
        role: 'sales',
        arousal: 1,
        excitement: 9,
        text: '谢谢您的信任和支持！那咱们就把试听时间定在本周六上午十点，到时候您带孩子直接过来就行！',
      },
      { role: 'narrator', text: '销售与客户道别，地推演示结束。' },
    ],
  },
  {
    id: 'demo-script-inquiry',
    tenantId: TENANT,
    category: '接待咨询',
    name: '咨询接待示范剧本',
    faqPick: 3,
    faqPoolRef: 'inquiry-demo-faq',
    lines: [
      { role: 'sales', arousal: 0.5, text: '您好，文杰围棋学校，请问有什么能帮您的？' },
      { role: 'customer', text: '哦，我想给孩子咨询一下，他5岁能学吗？' },
      { role: 'sales', arousal: 0.5, text: '可以的，5岁其实是学习围棋的黄金年龄，我们这5岁的孩子是最多的。' },
      { role: 'customer', text: '哦，是吧。就是他比较好动，想让他磨磨性子。' },
      { role: 'sales', arousal: 0.5, text: '您说的对，其实我们喜欢好动的孩子，普遍来说，好动的孩子都比较聪明，一般进步都快。' },
      { role: 'customer', text: '是嘛，我还以为好动的孩子学围棋费劲呢！' },
      {
        role: 'sales',
        arousal: 0.5,
        text: '您说的有道理，实际上好动的孩子反而接受能力强，这么多年教学的规律，容易出成绩的都是好动的孩子。',
      },
      { role: 'customer', text: '${faq1.question}' },
      { role: 'sales', arousal: 0.5, text: '${faq1.answer}' },
      { role: 'customer', text: '${faq2.question}' },
      { role: 'sales', arousal: 0.5, text: '${faq2.answer}' },
      { role: 'customer', text: '${faq3.question}' },
      { role: 'sales', arousal: 0.5, text: '${faq3.answer}' },
      { role: 'customer', text: '那接下来怎么办？' },
      { role: 'sales', arousal: 0.5, text: '请问您什么时候方便，我给您安排免费的试听课。' },
      { role: 'customer', text: '那就周末吧？' },
      { role: 'sales', arousal: 0.5, text: '好的，请问您希望周六还是周日呢，我尽量方便您！' },
      { role: 'customer', text: '那就周六上午吧？' },
      {
        role: 'sales',
        arousal: 0.5,
        text: '好的，那给您约周六上午10点。请问这个是您微信吗，我给您发地址，这样您也方便一点。',
      },
      { role: 'customer', text: '是的，麻烦您了。' },
      { role: 'sales', arousal: 0.5, text: '不客气哈，那期待您的光临，感谢您预约我们的围棋课。' },
      { role: 'customer', text: '好的，再见。' },
      { role: 'sales', arousal: 0.5, text: '再见，祝您周末愉快！' },
    ],
  },
  {
    id: 'demo-script-phone-sales',
    tenantId: TENANT,
    category: '电销',
    name: '电话销售示范剧本',
    faqPick: 1,
    faqPoolRef: 'phone-sales-demo-faq',
    lines: [
      { role: 'sales', arousal: 0.6, text: '圆圆妈妈您好！我是天童英语学校的，请问您有兴趣让孩子学习英语吗？' },
      { role: 'customer', text: '${faq1.question}' },
      { role: 'sales', arousal: 0.6, text: '${faq1.answer}对了，您孩子几岁了呀？' },
      { role: 'customer', text: '6岁了。' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '太好了！6岁就是孩子学英语的黄金年龄！我们现在正好在搞活动，199元4次体验课，每次40分钟。听完这四次课，您觉得好，可以长期在我们这里学；如果您觉得不合适，也没有关系，到时候您听完以后自己做决定！这个活动可以在大众点评上直接下单。',
      },
      { role: 'customer', text: '那我问问孩子吧！' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '您说的对，应该尊重孩子，兴趣是最好的老师嘛。这样，我在电话里给孩子讲一个英语的小知识，如果孩子喜欢，咱们就让他试一试；如果孩子不喜欢，咱们也尊重他。',
      },
      { role: 'customer', text: '好吧。圆圆，你过来。' },
      { role: 'narrator', text: '等了几秒钟，孩子凑到电话旁边。' },
      { role: 'child', arousal: 0.5, text: '妈妈，怎么了？' },
      { role: 'customer', text: '老师要跟你说话。' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '圆圆好，陈老师非常尊重你。我觉得孩子长大了有自己的想法，我们大人一定要尊重孩子，你说陈老师说的对不对啊？',
      },
      { role: 'child', arousal: 0.7, text: '对！' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '那圆圆，陈老师给你一个建议：我现在给你讲个英语小故事，如果你喜欢，到时候妈妈就带你过来玩；如果你不喜欢，以后就不玩了，好不好啊？',
      },
      { role: 'child', arousal: 0.6, text: '好！' },
      { role: 'narrator', text: '此时销售给孩子讲了一个英语小故事，引起了孩子的兴趣。' },
      { role: 'sales', arousal: 0.6, text: '圆圆，陈老师给你讲的故事你觉得好玩吗？' },
      { role: 'child', arousal: 0.7, text: '好玩！' },
      { role: 'sales', arousal: 0.6, text: '那你跟妈妈说，你想不想过来玩英语？' },
      { role: 'narrator', text: '孩子转向妈妈说：我想玩英语。销售让圆圆把电话还给妈妈。' },
      { role: 'sales', arousal: 0.7, text: '圆圆妈妈，我忽悠小朋友的本领还挺厉害的吧！' },
      { role: 'customer', text: '呵呵，好吧，那我们订一个吧。' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '谢谢您的信任和支持！来，您打开大众点评，我教您下单。下单以后，我还需要在电话里给您登记一些信息。',
      },
      { role: 'narrator', text: '此时销售教客户在大众点评上下单。' },
      { role: 'sales', arousal: 0.6, text: '感谢您订购我们的活动课！请问孩子全名叫什么啊？' },
      { role: 'narrator', text: '此时销售需要留取孩子的姓名、年龄、基础、试听时间这些基本信息。' },
      { role: 'sales', arousal: 0.6, text: '好的，那期待您的光临。' },
      { role: 'customer', text: '好的，谢谢。' },
      { role: 'sales', arousal: 0.6, text: '不客气，到时候我提前提醒您上课，您放心。' },
      { role: 'customer', text: '好的哈，辛苦啦。' },
      { role: 'sales', arousal: 0.6, text: '应该的，祝您周末愉快！再见！' },
      { role: 'narrator', text: '电销示范结束。' },
    ],
  },
  {
    id: 'demo-script-negotiation',
    tenantId: TENANT,
    category: '现场成交',
    name: '现场成交示范剧本',
    lines: [
      { role: 'narrator', text: '试听课结束后，家长带着孩子回到咨询区。孩子刚才玩得很开心，家长开始询问课程安排和价格。' },
      { role: 'customer', text: '孩子今天确实挺喜欢的，不过你们这个课程怎么收费？' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '谢谢您愿意留下来详细了解。刚才孩子参与活动时很投入，尤其是在需要开口表达的环节。您更看重孩子的兴趣保持，还是课堂上的表达机会呢？',
      },
      { role: 'customer', text: '主要还是希望他能坚持学，别上几次就不想来了。' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '明白，您担心的不是单节课好不好玩，而是孩子能不能持续参与。我们会根据每次课的出勤和课堂表现跟您沟通，再一起调整学习安排。',
      },
      { role: 'customer', text: '可是你们的价格比附近另一家贵一些。' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '理解，报课前比较价格很有必要。除了课时数，您也可以一起比较班额、老师给每个孩子的表达机会，以及课后的反馈方式。结合您刚才说的坚持问题，这些服务比单纯少几节课更重要。',
      },
      { role: 'customer', text: '我还是想回去和孩子爸爸商量一下。' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '应该的，家庭一起决定更稳妥。为了不耽误您时间，我想确认一下：您现在主要犹豫的是预算，还是担心孩子坚持不下来？我可以把对应的信息给您讲清楚，方便您回去商量。',
      },
      { role: 'customer', text: '预算也有一点，主要还是怕孩子坚持不了。' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '那不用急着做长期决定。您可以先报名199元4次体验课，让孩子再完整体验几次；这期间我们持续反馈他的参与情况，您觉得合适再决定后续，不合适也不勉强。',
      },
      { role: 'customer', text: '这样倒可以，先让孩子试四次看看。' },
      {
        role: 'sales',
        arousal: 0.7,
        text: '好的，那我现在帮您登记。周六上午和周日下午目前都能安排，您看哪个时间更方便？',
      },
      { role: 'customer', text: '周六上午吧。' },
      {
        role: 'sales',
        arousal: 0.7,
        text: '好的，先为您约周六上午。请您在这里确认课程、费用和退费说明，没问题后再完成支付，我再把上课时间和注意事项发给您。',
      },
      { role: 'narrator', text: '家长确认了课程与费用说明，完成体验课报名。销售没有夸大学习效果，也没有回避价格和退费问题。' },
      {
        role: 'sales',
        arousal: 0.6,
        text: '谢谢您的信任和支持。已经为您登记好了，我会提前提醒您上课。今天您还有什么需要确认的吗？',
      },
      { role: 'customer', text: '没有了，那就周六见。' },
      { role: 'sales', arousal: 0.6, text: '好的，感谢您，周六见！' },
      { role: 'narrator', text: '现场成交示范结束。' },
    ],
  },
];

/**
 * 4 个新手指引流程配置（scenarioId 对应 infra seed.ts 的 4 个 drill 场景）。
 * 第2步示范剧本统一引用示范剧本库（demoScriptId → DEMO_SCRIPTS）。
 */
export const SCENARIO_GUIDANCES: ScenarioGuidance[] = [
  // ══ 1. 地推引流课 ══
  {
    id: 'guidance-ground-push',
    tenantId: TENANT,
    scenarioId: 'scenario-drill-ground-push',
    name: '地推引流课新手指引',
    qualifyQuestions: ['你做过地推吗？', '你做过教培行业的地推吗？'],
    demoScriptId: 'demo-script-ground-push',
    keyPoints: [
      '语调要激情饱满，开场就把能量拉满，让客户愿意停下脚步',
      '语速中等偏快，抢在客户走开之前把价值说清楚',
      '开场30秒内抓住客户注意力，先夸客户再抛出邀请',
      '用"黄金年龄"话术制造紧迫感，让家长觉得现在就是最佳时机',
      '蹲下与孩子互动玩小游戏，让孩子主动要求家长订邀请函',
      '成交后必须致谢，并现场定下试听时间再道别',
    ],
    briefingStandardIds: ALL_BRIEFING,
    voiceProfile: { style: '激情', arousal: 0.9, excitement: 9, rate: 1.15 },
    liveIntro: {
      narration:
        '现在你将扮演销售的角色，由AI训练员扮演你的客户。现在假设前方有一位家长，三秒之后开始一次模拟对话。',
      goal: '现场卖给客户一张5元的邀请函',
    },
    realismStandardIds: GROUND_PUSH_REALISM,
    difficultyLevels: [
      {
        level: 1,
        label: '温和客户',
        description: '客户态度友好，基本配合销售流程，偶尔问一两个简单问题',
        customerBehavior: '态度温和，愿意停下脚步听介绍，不主动提异议，被问到时简单回答，销售推进到订邀请函时顺势配合。',
      },
      {
        level: 3,
        label: '常见异议客户',
        description: '客户会提出常见异议：孩子学的东西太多、没时间、再考虑一下',
        customerBehavior:
          '会提出1到2个常见异议（如"孩子学的太多了""我再想想"），销售处理得好就继续推进，处理不好就表现出犹豫。',
      },
      {
        level: 5,
        label: '强势拒绝客户',
        description: '客户强势拒绝并频繁拖延，对销售施压，只有出色的处理才能成交',
        customerBehavior:
          '态度强势，直接说"不需要""别缠着我"，并用"回去问问孩子""下次再说"等拖延话术，只有销售连续妥善处理异议并果断促单才会松口。',
      },
    ],
    defaultDifficulty: 1,
    duration: { targetMinutes: 20, minTurns: 6, maxTurns: 60, countdownSeconds: 1200 },
    scoringFocus: ['破冰开场', '异议处理', '促单时机', '致谢收尾'],
  },
  // ══ 2. 咨询接待 ══
  {
    id: 'guidance-inquiry',
    tenantId: TENANT,
    scenarioId: 'scenario-drill-inquiry',
    name: '咨询接待新手指引',
    qualifyQuestions: ['你做过教培机构的咨询接待吗？'],
    demoScriptId: 'demo-script-inquiry',
    keyPoints: [
      '语调亲切温和，像朋友聊天一样让客户放松',
      '语速中等，吐字清晰从容，给客户留思考时间',
      '礼节周到，像联通客服一样开口先问好、全程用敬语',
      '顺着客户的需求锁定试听时间，给客户二选一而不是开放题',
      '主动要微信发地址，把联系方式留下来',
    ],
    briefingStandardIds: ALL_BRIEFING,
    voiceProfile: { style: '亲切温和', arousal: 0.5, rate: 1.0 },
    liveIntro: {
      narration: '现在你将扮演咨询师的角色，由AI训练员扮演你的客户。三秒之后开始模拟演练。',
      goal: '给客户留下好印象，并定下试听课的时间',
    },
    realismStandardIds: GROUND_PUSH_REALISM,
    difficultyLevels: [
      {
        level: 1,
        label: '爽快客户',
        description: '客户咨询目标明确，积极配合，容易约定试听',
        customerBehavior: '咨询目的明确，对回答基本满意，顺着咨询员的引导就能定下试听时间。',
      },
      {
        level: 3,
        label: '比价客户',
        description: '客户同时在对比别家机构，会追问价格、师资、效果',
        customerBehavior: '会追问价格、师资、和别家比有什么优势等问题，透露"我再对比对比"的意向，需要咨询员用专业和耐心留住。',
      },
      {
        level: 5,
        label: '挑剔客户',
        description: '客户挑剔且防备心强，不轻易留微信和约定时间',
        customerBehavior: '对回答频频质疑，嫌贵、嫌远、担心没效果，不愿意留微信，只有咨询员持续保持礼节并给出足够价值才肯预约。',
      },
    ],
    defaultDifficulty: 1,
    duration: { targetMinutes: 25, minTurns: 6, maxTurns: 24, countdownSeconds: 1500 },
    scoringFocus: ['接待礼仪', '需求承接', '预约锁定', '联系方式获取'],
  },
  // ══ 3. 现场成交 ══
  {
    id: 'guidance-negotiation',
    tenantId: TENANT,
    scenarioId: 'scenario-drill-negotiation',
    name: '现场成交新手指引',
    qualifyQuestions: ['你做过课程顾问吗？', '你做过教培机构的课程顾问吗？'],
    demoScriptId: 'demo-script-negotiation',
    keyPoints: [
      '现场谈判十分复杂，包含多种技巧，也并非只有一种方式可以达成结果。这里尽量讲到最重要的东西。谈判既是一门科学，也是一门艺术。首先最好的营销应该是价值观得契合，其作用甚至甚于产品的优势或者需求的满足。',
      '对于课程顾问来说可以这么切入：老师说今天孩子很不错，挺明事理的。家长做出回应以后，就顺势说，我们的教育理念是，不光要培养孩子的技艺 同时也要让孩子从小养成良好的学习习惯和行为习惯，因为我们认为好的习惯从小养成。这样孩子以后，上小学以后比起同龄的孩子也会具备更多的竞争优势。',
      '也可以很自然得问小朋友：今天得课你喜欢吗？得到答复以后，就继续问“如果最喜欢是100，最不喜欢是0，你选一个数字表示你喜欢得程度，你选择几啊“因为你不光要让家长看到孩子喜欢这个项目，你还希望家长看到孩子有多喜欢。',
      '孩子也许会说90，那你就对孩子讲，那你跟妈妈击个掌，告诉妈妈你能不能坚持好不好啊，这是为了解除一部分家长得内心顾虑，孩子三分钟热度。最主要得是有些顾虑家长不会直说。孩子会过去击掌，这样家长就会高兴起来，从而不那么戒备。',
      '然后顾问就可以顺着说：我们的教育理念是以兴趣为导向，我们认为，兴趣是最好的老师，孩子有兴趣学任何东西都会事半功倍。',
      '想一想Nike的广告，它从来不说speed and feed 它说的是Just do it 这是一种运动员精神 苹果的发布会比起直接说产品的性价比，更让人记住的是那样的话，我们追求极致 把美好的东西分享给同类。这是个喧嚣的世界，任何东西都很难被人铭记。而我们能记住和我们精神契合的人--也就是价值观契合的人。比起向客户罗列产品的好处，更容易打动他们的是价值观的契合。',
      '类似的还有，我们的教育理念是启发式教育而非灌输式教育，鸡蛋从外打破是鸡蛋，从内打破是生命。我们想更多得启发孩子去思考，而不是直接将知识灌输给他们。或者说我们崇尚鼓励式教育，我们觉得好孩子都是夸出来得。孩子如果有自信，将来做任何事情都会做得更好。这些理念上得契合远远比产品上得优点更能打动家长。',
      '其次，永远不要忘记销售的铁律，现场成交。不要掉入有所期待的陷阱。在家长带孩子来体验的时候，孩子和家长受到课堂气氛的感染，有关课程的好处和孩子的热切兴趣，被最清楚的感知到。顾问此时处在最有利的位置上，而你的客户也在此时最强烈地感受到需要购买你的产品。',
      '在接下来的日子里，两件事将会发生。客户会逐渐忘记你产品的有点，他的购买热情会迅速冷却，而且每经过一天，他就觉得需要你产品的欲望会降低，而当记忆力逐渐减退时，对于你的产品他将觉得对他几乎没有益处，时间经过得越久，你想将产品卖出的几率将会变得越小，因为客户的购买热情已经冷却了。',
      '因此顾问必须借全力以赴，否则将一无所得的原则，我可以向你保证，你的坚持绝对会有所得的。接下来我告诉你应该怎么做。因为在教育行业，顾问不宜显得过于商业化。',
      '最自然的做法莫过于当客户询问价格的时候，顺便说出试听当天报名有优惠的政策，同时诚实得解释这么做得原因，可以具体这么讲：我们制定这个优惠政策的原因，是因为很多孩子喜欢，家长也认可，但是时间长了，很多事情就不了了之了。',
      '我们很重视孩子的教育，但我们毕竟是一个商业组织，经济效益也是要考虑的，因此我们制定了真实有效的优惠政策，鼓励你们在孩子喜欢，你们也认可的前提下当天报名，以此达成双赢。',
      '很多销售会担心这样直接的说辞会冒犯客户，但大量实践证明，事实正好相反，客户会对你的真诚感到尊重，更重要的是，你将会因为如此说，得到你想要的结果，假如少部分客户提出，想要保留这项优惠时，可以这样回复他们：历史告诉我们，再提出再回复的家长中，只有低于百分之2的人会再回来，所以我们才简单决定了当场购买优惠，以奖励帮助客户做决定。',
      '同时拿出过了优惠期，我们确实没有给优惠的微信聊天记录给家长看，家长就会确知机构将信守诺言。',
      '从理性的角度看，不管我们采取什么策略，都会损失一些东西。但是强势引导客户当天做决定，收益较大，而风险最小。本来慎重考虑后会决定购买却因为你的坚定坚持而放弃的客户，数量远远少于本可以当天决定，却因为拖延而生变的客户。当时间不是你的朋友的时候，要敢于面对立即遭受的损失。当时间是你的朋友的时候，要有耐心拒绝立刻得到的好处。',
      '其三，要做好销售的准备工作。好的顾问不但要对专业知识了如直掌，同时也要对于成交必备的材料，例如教学体系，内部教材，收费单，排班表，老师介绍材料提前准备，这表明顾问的专业严谨，当客户问出一些问题，顾问拿出提前准备的材料简洁详细得回答，也就赢得了客户得尊重和信任。',
      '其四，诚信。诚实是最好的政策，这并不是一个哲学问题，而是会实实在在影响客户对你的信任。顾问如果能够主动透露一些对自己不利的地方，往往更容易赢得客户的信任。人是有理性的，不会因为产品的一些瑕疵就全然否定，反而过于完美就会让人觉得不真实。',
      '具体做法随情况而定，比较通用的做法有，当客户问我们孩子是否有天赋时，坦诚得回答”实话实说，通过一两次课就去判断孩子有没有天赋，有一些过于主观，发现并且培养孩子得天赋是老师的责任，而这需要一些时间“',
      '当客户问”学这个能提高逻辑思维吗？"不妨回答“其实我也不十分清楚，因为确实很多学xx的数学成绩都好，但是很难说，是学了xx提高了他们的理科思维，还是因为他们本来具有好的理科思维，才导致了xx学得好”',
      '切记诚实是最好的政策，最成熟的商业人士并非特别善于吹嘘，而是把好的一面和有瑕疵的一面都呈现给用户，然后帮助客户去做出更好的决定。退一步讲，销售应当看高一线，赢得客户比赢得订单更重要。',
      '假如客户暂时不适合购买产品，那就给他留下好印象，也许将来他会向很多人推荐你的产品，如果通过虚假承诺或者夸大其词，让他购买了不合适的产品，他将会跟很多人说你的坏话。',
    ],
    briefingMode: 'verbatim',
    briefingStandardIds: [],
    voiceProfile: { style: '沉稳专业', arousal: 0.7, rate: 1.0 },
    liveIntro: {
      narration: '现在你将扮演销售的角色，由AI训练员扮演你的客户。三秒钟以后，你将进入现场谈判语音对话。',
      goal: '现场完成成交',
    },
    realismStandardIds: GROUND_PUSH_REALISM,
    difficultyLevels: [
      {
        level: 1,
        label: '意向客户',
        description: '客户已有较强购买意向，主要确认细节',
        customerBehavior: '购买意向明确，主要确认价格、上课时间等细节，销售顺势推单即可成交。',
      },
      {
        level: 3,
        label: '犹豫客户',
        description: '客户纠结价格和效果，会用拖延话术',
        customerBehavior: '对价格敏感，反复说"太贵了""回去和家人商量一下"，需要销售拆解价值、处理拖延后才可能成交。',
      },
      {
        level: 5,
        label: '强势谈判客户',
        description: '客户谈判经验丰富，强势压价并多处挑刺',
        customerBehavior: '强势压价，拿竞品对比，要求额外赠送和折扣，拒绝销售的常规话术，只有给出充分价值证明和让步策略才会签约。',
      },
    ],
    defaultDifficulty: 1,
    duration: { targetMinutes: 6, minTurns: 8, maxTurns: 40, countdownSeconds: 360 },
    scoringFocus: ['需求确认', '价格异议处理', '临门一脚', '成交收尾'],
  },
  // ══ 4. 电话销售 ══
  {
    id: 'guidance-phone-sales',
    tenantId: TENANT,
    scenarioId: 'scenario-drill-phone-sales',
    name: '电话销售新手指引',
    qualifyQuestions: ['你做过电话销售吗？', '你做过教培机构的电话销售吗？'],
    demoScriptId: 'demo-script-phone-sales',
    keyPoints: [
      '语调温柔像谈恋爱，同时保持一定的激情，让客户愿意听下去',
      '语速中等偏慢，给客户留出思考和回应的时间',
      '用英语小故事吸引孩子，让孩子自己说"我想学"',
      '用开玩笑的方式化解尴尬，比如"我忽悠小朋友的本领还挺厉害的吧"',
      '指导客户在大众点评下单，一步步带着操作',
      '下单后留取孩子的姓名、年龄、基础、试听时间等信息',
    ],
    briefingStandardIds: ALL_BRIEFING,
    voiceProfile: { style: '温柔有激情', arousal: 0.6, rate: 0.9 },
    liveIntro: {
      narration: '现在你将扮演销售的角色，由AI训练员扮演你的客户。三秒钟以后，你将拨通客户的电话。',
      goal: '通过电话售卖199元4次的体验课',
    },
    realismStandardIds: GROUND_PUSH_REALISM,
    difficultyLevels: [
      {
        level: 1,
        label: '温和家长',
        description: '家长耐心接听，愿意听介绍，容易被活动吸引',
        customerBehavior: '愿意接听并听完介绍，对活动感兴趣，简单问一下细节就愿意下单。',
      },
      {
        level: 3,
        label: '忙碌家长',
        description: '家长正在忙，表现出不耐烦，会提常见异议',
        customerBehavior: '接电话时正在忙，说"我现在在加班""孩子学的东西太多了"等异议，需要销售快速讲清价值并约到孩子。',
      },
      {
        level: 5,
        label: '防备家长',
        description: '家长防备心强，把销售当骚扰电话，随时可能挂断',
        customerBehavior: '开场就说"不需要""你们怎么有我电话"，多次想挂断，只有销售语气真诚、迅速给出价值并尊重孩子意愿才愿意继续聊。',
      },
    ],
    defaultDifficulty: 1,
    duration: { targetMinutes: 4, minTurns: 6, maxTurns: 24, countdownSeconds: 240 },
    scoringFocus: ['开场破冰', '异议处理', '孩子互动', '下单指导', '信息留取'],
  },
];
