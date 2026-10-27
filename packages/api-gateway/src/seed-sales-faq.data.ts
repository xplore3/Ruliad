/**
 * 教培销售 FAQ 陪练场景数据（来源：销售 FAQ 话术库，50 条，原编号 4 缺失）。
 * 每条对应一个练习场景：家长（陪练员）抛出异议/问题，学员（销售）按标准话术应答。
 */

export interface SalesFaqPersona {
  id: string;
  name: string;
  background: string;
  age: number;
  occupation: string;
  voice: string;
  archetype: string;
  calm: string;
  guarded: string;
  annoyed: string;
  loadedKnowledge: string[];
}

export interface SalesFaqItem {
  /** 原始问题编号（与话术库一致，缺 4） */
  num: number;
  /** 场景名称 */
  name: string;
  /** 业务场景分类（写入 methodology 字段） */
  category: string;
  /** 家长侧一句话设定 */
  personaTitle: string;
  personaId: string;
  skillPointIds: string[];
  difficulty: number;
  /** 学员应答需要覆盖的要点（规则层 coverage 检查） */
  coverageTopics: string[];
  /** 家长抛出的问题 */
  question: string;
  /** 标准应答话术（FAQ 参考答案） */
  faq: string;
  /** 为什么这么回答（话术解析，可选） */
  why?: string;
}

const KB_ALL = ['本地培训机构的口碑与价格区间', '孩子同龄人的报班情况'];

export const SALES_FAQ_PERSONAS: SalesFaqPersona[] = [
  {
    id: 'persona-parent-price',
    name: '王秀兰',
    background:
      '6岁男孩的妈妈，34岁，精打细算的家庭主妇；对价格极其敏感，喜欢占点小便宜、要面子，认定的事会反复试探优惠空间。',
    age: 34,
    occupation: '培训机构家长',
    voice: 'longxiaoxia_v2',
    archetype: '教培家长 · 价格敏感型',
    calm: '语气和善，围绕价格、优惠、收费方式反复试探',
    guarded: '开始拿别家机构比较，暗示不给优惠就不报名',
    annoyed: '觉得没占到便宜、没被尊重，表示要再考虑或直接离开',
    loadedKnowledge: KB_ALL,
  },
  {
    id: 'persona-parent-hesitant',
    name: '李国强',
    background:
      '7岁女孩的爸爸，38岁，事业单位职员；性格谨慎，家里大事要和爱人商量，习惯用「回去商量一下」拖延决策。',
    age: 38,
    occupation: '培训机构家长',
    voice: 'longxiaocheng_v2',
    archetype: '教培家长 · 犹豫商量型',
    calm: '态度客气，愿意听介绍，但反复强调要和爱人商量',
    guarded: '回避当场决定，找各种理由拖延',
    annoyed: '被催促后产生抵触，明确说要回去考虑',
    loadedKnowledge: KB_ALL,
  },
  {
    id: 'persona-parent-busy',
    name: '张敏',
    background:
      '5岁男孩的妈妈，33岁，互联网公司项目经理；工作繁忙经常加班，认可教育但总觉得抽不出时间，容易对推销不耐烦。',
    age: 33,
    occupation: '培训机构家长',
    voice: 'longxiaoxia_v2',
    archetype: '教培家长 · 忙碌职场型',
    calm: '愿意简短沟通，但反复提到没时间、工作忙',
    guarded: '用「太忙了」「在加班」婉拒进一步沟通',
    annoyed: '觉得对方不体谅自己的处境，直接结束对话',
    loadedKnowledge: KB_ALL,
  },
  {
    id: 'persona-parent-rational',
    name: '陈静怡',
    background:
      '8岁女孩的妈妈，36岁，会计师；理性严谨，报班前会做足功课，关注师资、课程体系、教学效果等硬指标，喜欢横向对比机构。',
    age: 36,
    occupation: '培训机构家长',
    voice: 'longxiaoxia_v2',
    archetype: '教培家长 · 理性对比型',
    calm: '有条理地提问师资、体系、效果等硬指标',
    guarded: '拿周边机构逐条对比，追问细节和数据',
    annoyed: '发现回答含糊或夸大，对机构失去信任',
    loadedKnowledge: ['本地培训机构的口碑与价格区间', '各家机构的师资宣传口径'],
  },
  {
    id: 'persona-parent-interest',
    name: '刘悦',
    background:
      '6岁女孩的妈妈，32岁，全职妈妈；特别在意孩子的兴趣和天赋，担心逼孩子学会适得其反，报班决策很大程度看孩子喜不喜欢。',
    age: 32,
    occupation: '培训机构家长',
    voice: 'longxiaoxia_v2',
    archetype: '教培家长 · 兴趣天赋型',
    calm: '围绕孩子兴趣、天赋、性别适配等问题交流',
    guarded: '担心孩子不喜欢、坐不住，犹豫是否值得试',
    annoyed: '觉得对方在逼单、不尊重孩子意愿，终止沟通',
    loadedKnowledge: KB_ALL,
  },
  {
    id: 'persona-parent-skeptic',
    name: '赵永刚',
    background:
      '9岁男孩的爸爸，40岁，个体商户；见多识广、防备心强，习惯用质疑和抬杠试探销售虚实，对夸大宣传极为反感。',
    age: 40,
    occupation: '培训机构家长',
    voice: 'longtian_v2',
    archetype: '教培家长 · 质疑挑剔型',
    calm: '不断抛出尖锐问题，试探销售的专业度和诚实度',
    guarded: '对回答挑刺，追问「真的吗」「你确定？」',
    annoyed: '认定销售在忽悠，言辞变冲，准备走人',
    loadedKnowledge: KB_ALL,
  },
  {
    id: 'persona-parent-practical',
    name: '孙丽',
    background:
      '7岁男孩的妈妈，35岁，小学教师；务实细致，关心上课安排、请假补课、退费、停车等具体事务，问题多但都有实际关切。',
    age: 35,
    occupation: '培训机构家长',
    voice: 'longxiaoxia_v2',
    archetype: '教培家长 · 务实事务型',
    calm: '逐个询问课程安排、补课、退费等事务性问题',
    guarded: '对不清晰的答复反复追问，要求给出确定说法',
    annoyed: '觉得机构安排不靠谱，降低报名意愿',
    loadedKnowledge: KB_ALL,
  },
  {
    id: 'persona-parent-closing',
    name: '周婷',
    background:
      '6岁男孩的妈妈，31岁，自由职业者；孩子试听后很喜欢，本人报名意向强，但下决定前仍有一点犹豫，容易被细节打动。',
    age: 31,
    occupation: '培训机构家长',
    voice: 'longxiaoxia_v2',
    archetype: '教培家长 · 高意向犹豫型',
    calm: '明显有意向，主动询问报名流程和合同细节',
    guarded: '交了定金或口头答应后又有些摇摆，需要临门一脚',
    annoyed: '被过度催促缴费后产生反感，甚至反悔',
    loadedKnowledge: KB_ALL,
  },
];

export const SALES_FAQ_ITEMS: SalesFaqItem[] = [
  {
    num: 1,
    name: '谈判成交·价格优惠请求',
    category: '谈判成交场景',
    personaTitle: '试听课后谈单中，试探性问能不能优惠',
    personaId: 'persona-parent-price',
    skillPointIds: ['sp-objection', 'sp-value', 'sp-closing'],
    difficulty: 3,
    coverageTopics: [
      '假定成交原则：默认对方已决定报名',
      '强调价格统一对所有学生公平',
      '用赠送礼品替代价格优惠',
      '言语幽默并给足客户面子',
    ],
    question: '报名价格能不能优惠点？',
    faq: 'xx妈妈，感谢您的信任和支持，选择在我们这里学习。我们价格都是统一的，对所有学生都公平嘛，但是您既然开口了，学校的东西您随便选一件带走，算作我对您的信任和厚爱的感谢，比如xx也是挺精美的，或者您把我们xx老师带回家去，不占地还能辅导孩子学习，不过您千万别说是我建议的，我怕老师来找我麻烦~',
    why: '第一句话是销售中的假定成交原则，既然对方希望优惠，我们就假定他已经决定成交。需要分析对方希望优惠的心理：大部分情况下并不是因为缺那点钱，而是因为想占点便宜。表示价格都是统一的，就是为了告诉她没有吃亏。相反如果给予客户优惠，客户会担心我们给予其他家长更多优惠，反而不能满足她想占便宜的心理需求。我们聪明地采用送她东西的方法，并且言语中给足了客户面子，这样客户觉得自己占了便宜、受到足够的尊重，自然反而不会太在意这点便宜了。',
  },
  {
    num: 2,
    name: '通用应答·超出专业知识的问题',
    category: '通用场景',
    personaTitle: '问了一个销售专业之外的问题',
    personaId: 'persona-parent-rational',
    skillPointIds: ['sp-compliance', 'sp-objection'],
    difficulty: 2,
    coverageTopics: [
      '诚实承认不知道，不凭猜想说谎',
      '承诺在限定时间内联系专业人士',
      '约定给客户明确答复',
    ],
    question: '（抛出超出销售专业知识的问题）这个你怎么看？',
    faq: '抱歉，我不知道，我会在xx分钟内帮您联系专业人士，然后给您答复。',
    why: '回答不知道会让客户觉得销售不够专业，但这是事前准备的问题。如果真的遇到无法回答的问题，销售人员应该诚实地回答不知道，这样更有助于建立客户的信任。如果凭着猜想说谎，被看出来就会彻底失去这个客户。',
  },
  {
    num: 3,
    name: '拓客·孩子学的东西太多',
    category: '地推电销拓客场景',
    personaTitle: '地推现场，家长嫌孩子课程已经很多',
    personaId: 'persona-parent-busy',
    skillPointIds: ['sp-objection', 'sp-need'],
    difficulty: 2,
    coverageTopics: [
      '肯定家长重视孩子教育的观念',
      '说明课程每周占用时间不多',
      '邀请先体验看孩子兴趣再决定',
    ],
    question: '孩子学的太多了。',
    faq: '太好了！说明您重视孩子的教育嘛，我们培训机构就是为了您这种有观念的家长开的！其实我们xx课程每周占用的时间不算很多，您可以让孩子体验一下，看看孩子的兴趣再决定。',
  },
  {
    num: 5,
    name: '拓客·孩子太小了',
    category: '地推电销拓客场景',
    personaTitle: '地推现场，家长觉得孩子年龄太小',
    personaId: 'persona-parent-skeptic',
    skillPointIds: ['sp-objection'],
    difficulty: 2,
    coverageTopics: [
      '先认同家长的判断',
      '说明当前年龄正是该科目的黄金学习年龄',
      '邀请带孩子亲身体验，眼见为实',
      '给出双向选择：效果好就赢在起跑线，确实小就大一点再学',
    ],
    question: '我们的孩子太小了。',
    faq: '您说的对！小朋友确实挺小的，但对于我们这个科目来说，xx岁就是孩子学习的黄金年龄！耳听为虚，眼见为实，我建议您带孩子过来亲身体验一下，如果您觉得效果好，我们可以让孩子赢在起跑线上，如果确实太小了，可以让孩子大一点再学。',
  },
  {
    num: 6,
    name: '拓客·家长太忙了',
    category: '地推电销拓客场景',
    personaTitle: '电销中，家长以忙为由推脱',
    personaId: 'persona-parent-busy',
    skillPointIds: ['sp-empathy', 'sp-objection'],
    difficulty: 2,
    coverageTopics: [
      '肯定忙碌说明生活充实',
      '点出忙也是为了孩子',
      '引导为孩子教育抽出一两个小时陪孩子',
    ],
    question: '我太忙了。',
    faq: '太好了！忙碌的生活都是丰富多彩的，说明您过得充实嘛。但是您忙不也是为了孩子嘛，我们也是为了孩子的教育，相信为了孩子的教育您肯定能抽出一两个小时的时间陪陪孩子的。',
  },
  {
    num: 7,
    name: '电销·家长想学但孩子不喜欢',
    category: '电销场景',
    personaTitle: '电话里，家长有意向但说孩子不喜欢',
    personaId: 'persona-parent-interest',
    skillPointIds: ['sp-objection', 'sp-need'],
    difficulty: 3,
    coverageTopics: [
      '认同要尊重孩子意愿，赶鸭子上架效果不好',
      '自信预判孩子体验后会觉得好玩',
      '提出电话里先教孩子一个基本知识试探兴趣',
      '孩子喜欢就试一下，不喜欢也尊重他',
    ],
    question: '我倒是挺希望孩子学的，但孩子不喜欢。',
    faq: '您说的对！孩子还是需要尊重，赶鸭子上架，学习效果也不好。xx妈妈，您相信我，您带孩子过来以后，孩子肯定会跟您说：哎哟妈妈，xx太好玩了，我要学xx。（客户一般就会乐了）然后提出建议：要不这样，我在电话里跟孩子简单教孩子一个xx的基本知识，如果孩子喜欢咱们就让他试一下，如果孩子不喜欢咱们也尊重他，您看呢？（很多客户都会同意）',
  },
  {
    num: 8,
    name: '通用咨询·一周上几次课',
    category: '通用场景',
    personaTitle: '咨询课程安排频率',
    personaId: 'persona-parent-practical',
    skillPointIds: ['sp-clarity', 'sp-value'],
    difficulty: 1,
    coverageTopics: [
      '建议刚开始一周一次课',
      '解释教学要符合孩子自然成长规律、兴趣最重要',
      '坦诚多排课学校反而多赚钱，但不给孩子压力',
      '有基础后可商量每周增加一次课',
    ],
    question: '一周上几次课？',
    faq: '刚开始建议一周上一次课，因为红烧肉吃多了也会腻嘛，如果你们一周上两三次，我们学校还能多赚点钱。但是我们觉得教学要符合孩子的自然成长规律，刚开始不要给孩子太大的压力，兴趣最重要嘛，孩子逆反了影响兴趣就不好了。以后孩子有一定基础了要重点培养，也可以商量每周增加一次课。（具体内容可根据实际情况调整）',
  },
  {
    num: 9,
    name: '通用咨询·缺课与寒暑假安排',
    category: '通用场景',
    personaTitle: '担心孩子缺课和假期上课安排',
    personaId: 'persona-parent-practical',
    skillPointIds: ['sp-clarity'],
    difficulty: 2,
    coverageTopics: [
      '平行班调班补课不落下进度',
      '寒暑假采取冬夏令营连续上课形式',
      '20~30天内任选10天参加，学习出行两不误',
      '实在补不了可人性化冻结课时',
    ],
    question: '孩子缺课怎么办？我们寒暑假怎么办？',
    faq: '我们有很多的平行班，缺课的话会给孩子调到平行班进行补课，让孩子不落下进度，这样学得更好。寒暑假我们会采取冬夏令营的形式进行上课，因为寒暑假每周还是固定时间上课的话，有的孩子回老家或者出去玩，一个班的进度不一样，会影响孩子学习效果，所以冬夏令营采取连续的20~30天的上课形式，让家长任选10天参加，这样做到学习出行两不误。当然，如果孩子实在补不了，您放心，我们会人性化处理，把孩子的课冻结，就是上几次课算几次课。补充：集训上课时间为上午9点到11点半，下午1点半到4点，中午安排孩子们一起吃饭休息，半天全天都可以参加。很多孩子集训一天，家长说放到车里就睡着了，但是第二天还是嚷嚷着要来上课。',
  },
  {
    num: 10,
    name: '通用异议·家离得有点远',
    category: '通用场景',
    personaTitle: '嫌机构离家远',
    personaId: 'persona-parent-practical',
    skillPointIds: ['sp-value', 'sp-objection'],
    difficulty: 2,
    coverageTopics: [
      '承认这是一个问题',
      '重新定义：远不远是值不值得的问题',
      '好学校值得在孩子的教育路上花一点时间',
      '承诺学校会让家长觉得值得',
    ],
    question: '我们家有点远。',
    faq: '是的，这是一个问题。其实远不远就是一个值不值得的问题，如果一家学校对孩子的成长有帮助，那么在孩子的教育路上花一点时间，我们相信也是值得的；如果一家学校不好，就算开在您家门口，您也不会把孩子送过去耽误孩子。您相信我，我们学校肯定会让您觉得值得的。',
  },
  {
    num: 11,
    name: '通用咨询·学费能不能退',
    category: '通用场景',
    personaTitle: '担心报名后退费难',
    personaId: 'persona-parent-practical',
    skillPointIds: ['sp-compliance'],
    difficulty: 2,
    coverageTopics: [
      '承诺随时无成本退费',
      '坦诚这对机构是挑战但对教学有信心',
      '本着契约精神及时办理',
    ],
    question: '学费能不能退呀？',
    faq: '我们的学费可以随时无成本退费，这对我们是个挑战，但我们对教学有信心。因为学生基数大嘛，难免有退费的，我们都会本着契约精神，及时办理。',
  },
  {
    num: 12,
    name: '通用异议·学这个是不是很费时间',
    category: '通用场景',
    personaTitle: '担心学习耗时太长',
    personaId: 'persona-parent-skeptic',
    skillPointIds: ['sp-clarity', 'sp-value'],
    difficulty: 1,
    coverageTopics: [
      '承认一分耕耘一分收获',
      '区分高手比赛与入门学习的时间差异',
      '说明入门只需5-10分钟一局',
    ],
    question: '学xx是不是很费时间呀？下一盘棋要好几个小时吧？',
    faq: '其实一分耕耘，一分收获，学任何东西都是这样，xx也概莫能外。学习的时间因人而异吧，对于高手比赛而言，xx要四五个小时左右，但对于孩子而言，入门也就是游戏，只需要5-10分钟。',
  },
  {
    num: 13,
    name: '拓客·别人都免费你们还要钱',
    category: '地推电销场景',
    personaTitle: '地推现场，拿免费活动对比质疑收费',
    personaId: 'persona-parent-price',
    skillPointIds: ['sp-value', 'sp-objection'],
    difficulty: 3,
    coverageTopics: [
      '指出免费的东西大家不珍惜',
      '收费是希望家长重视，且是象征性的',
      '承诺让家长觉得值得',
      '抬升家长：为了孩子的教育不会在乎这个钱',
    ],
    question: '你们还要钱呀，别人都是免费的。',
    faq: '免费的东西大家都不珍惜，我们也是希望家长能重视这件事情。您过来以后我们一定会让您觉得值得，如果您觉得不值得的话您肯定不会花时间过来，您说是吧。我们这个本来也是在搞活动，收费也是象征性的。为了孩子的教育，您肯定不会在乎这个钱对吧。',
  },
  {
    num: 14,
    name: '通用咨询·什么时候可以试听',
    category: '通用场景',
    personaTitle: '询问试听时间安排',
    personaId: 'persona-parent-practical',
    skillPointIds: ['sp-need', 'sp-closing'],
    difficulty: 1,
    coverageTopics: [
      '以家长方便为准',
      '立即给出可选择的几个时间段',
      '当场锁定试听时间',
    ],
    question: '什么时候可以试听呀？',
    faq: '您看什么时候方便，我们可以现在给您定时间，现在还有这个、这个、这个时间可以选择，尽量方便您嘛。',
  },
  {
    num: 15,
    name: '通用异议·两小时孩子坐得住吗',
    category: '通用场景',
    personaTitle: '质疑课时太长孩子坐不住',
    personaId: 'persona-parent-skeptic',
    skillPointIds: ['sp-objection', 'sp-value'],
    difficulty: 2,
    coverageTopics: [
      '实话实说孩子确实会有不专注的情况',
      '用看动画片的例子说明喜欢玩是孩子的天性',
      '介绍寓教于乐、把知识点变成故事和游戏的教学方式',
    ],
    question: '你们一节课2个小时，孩子能坐得住吗？',
    faq: '实话实说，孩子确实会有不专注的情况发生，毕竟孩子年龄还小嘛。但是我们会以寓教于乐的方式教学。小孩学习不能坚持很长时间，但是看动画片可以一看就是半天，因为喜欢玩是孩子的自然天性。所以我们认为教学要把知识点变成一个个故事和游戏，适应孩子的自然天性，这样孩子就相对能够集中注意力。',
  },
  {
    num: 16,
    name: '线下谈单·学费怎么收',
    category: '线下谈单场景',
    personaTitle: '到店谈单，询问收费方式',
    personaId: 'persona-parent-price',
    skillPointIds: ['sp-value', 'sp-closing'],
    difficulty: 3,
    coverageTopics: [
      '分课包逐个介绍',
      '坦诚说明试听当天报名优惠政策的商业原因',
      '用大众点评榜单等背书建立信任',
      '坦诚机构也重视经济效益',
    ],
    question: '学费怎么收呀？',
    faq: '我们分x种课包（逐个介绍）。为什么要定试听当天报名有优惠的政策呢，我也坦诚和您沟通：因为很多孩子也喜欢、家长也认可，但是时间长了很多事情就不了了之了。我们很重视孩子的教学，我们是大众点评上北京棋类评价榜的第一名——实话实说，很多点评都是我们请家长帮忙写的。但是我们毕竟是一个商业组织，经济效益还是蛮重要的，所以我们统一制定了当天报名有优惠的政策，鼓励家长在孩子喜欢、家长也认可的前提下决定当天报名。',
  },
  {
    num: 17,
    name: '拓客·要回去考虑一下',
    category: '地推电销场景',
    personaTitle: '地推/电话中，说要回去商量',
    personaId: 'persona-parent-hesitant',
    skillPointIds: ['sp-objection', 'sp-closing'],
    difficulty: 3,
    coverageTopics: [
      '先认同：幸福美满的家庭就是商量出来的',
      '指出还没看到孩子上课和老师教学，无从考虑',
      '引导上完体验课了解情况后再考虑',
    ],
    question: '我们要考虑一下，回去商量一下。',
    faq: '幸福美满的家庭就是商量出来的。但是今天您也没看到孩子上课喜不喜欢，您也没看到老师上课教学情况，您考虑什么呢？我给您个建议，等您上完体验课，等您了解情况以后，您再考虑，您说呢？',
  },
  {
    num: 18,
    name: '谈判·试听后仍要回去商量',
    category: '谈判场景',
    personaTitle: '试听结束，仍说要回去和爱人商量',
    personaId: 'persona-parent-hesitant',
    skillPointIds: ['sp-closing', 'sp-objection'],
    difficulty: 4,
    coverageTopics: [
      '挖掘并询问真实顾虑',
      '建议现场给妈妈打电话沟通',
      '告知试听当天报名有优惠',
      '坚持服务：提出晚上到府上给孩子再上一节试听课',
      '指出决策人不在场无法获得专业答复、对其不公平',
    ],
    question: '（来试听之后）我回去还要商量一下。',
    faq: '大哥，能不能跟我说说您有什么顾虑吗？（没什么）别这样嘛，您尽管说，没事。（我想回去和他妈妈商量一下）太好了，妈妈都是教育部长，要不您跟妈妈打个电话，因为试听当天报名有优惠嘛。我理解这种情况，但是有一件事我想坚持为您服务：我希望今天晚一点你们方便的时候，我和老师到您府上给孩子上一节试听课，这是我的专业职责。而且孩子妈妈有任何问题的话，我不在场，您可能也没有办法给出专业的答复，在你们没有了解实际情况下做决定，对你们来说是不公平的。',
  },
  {
    num: 19,
    name: '通用咨询·你们有什么优势',
    category: '通用场景',
    personaTitle: '直接询问机构优势',
    personaId: 'persona-parent-rational',
    skillPointIds: ['sp-value'],
    difficulty: 2,
    coverageTopics: [
      '机构好坏看软件和硬件',
      '强调软件即师资力量是决定因素',
      '介绍明星教师团队',
    ],
    question: '你们这有什么优势吗？',
    faq: '我觉得一家机构的好坏无非就是它的软件和硬件，但是最重要的还是软件，也就是师资力量，它可能是决定一家机构质量的决定因素。我们有一个xx的教师团队。',
  },
  {
    num: 20,
    name: '通用异议·孩子课业压力大',
    category: '通用场景',
    personaTitle: '担心占用孩子学习时间',
    personaId: 'persona-parent-busy',
    skillPointIds: ['sp-value', 'sp-empathy'],
    difficulty: 2,
    coverageTopics: [
      '承认这是一个问题',
      '定位课程为素质教育',
      '说明不是所有时间都用在功课上才符合教育本质',
      '磨刀不误砍柴工，对成长和成绩都有帮助',
    ],
    question: '我们孩子课业压力比较大。',
    faq: '是的，这是一个问题。我们觉得学这个是素质教育，如果把所有时间都用在功课上，这也未必符合教育的本质。有些孩子把所有时间都花在学习上，学习成绩不一定好。有时候把更多的时间放在素质教育上，磨刀不误砍柴工，对孩子未来的成长以及学习成绩也会有很大的帮助。',
  },
  {
    num: 21,
    name: '拓客·最近不能来要过段时间',
    category: '地推电销场景',
    personaTitle: '说最近没空，要过段时间',
    personaId: 'persona-parent-practical',
    skillPointIds: ['sp-objection', 'sp-closing'],
    difficulty: 1,
    coverageTopics: [
      '告知体验课长期有效',
      '引导先购买，什么时候来都行',
    ],
    question: '我们得过段时间，因为最近不能来。',
    faq: '没事，我们的体验课是长期有效的，您购买以后呢，什么时候来都行。',
  },
  {
    num: 22,
    name: '通用咨询·孩子太小能学吗',
    category: '通用场景',
    personaTitle: '担心孩子年龄不达标',
    personaId: 'persona-parent-skeptic',
    skillPointIds: ['sp-compliance', 'sp-objection'],
    difficulty: 2,
    coverageTopics: [
      '小于适龄：坦诚不建议现在报名，对孩子负责',
      '大于适龄：没问题，同年龄段孩子很多',
      '建议先参加体验课，眼见为实',
      '觉得太小也可以过段时间再学',
    ],
    question: '孩子太小能学吗？',
    faq: '分两种情况：1. 小于可以学的年龄——我不建议孩子现在上线上课，你们报名我们还能多赚点钱，但是我们觉得应该对您孩子负责，要符合孩子的自然成长规律，我建议可以让孩子以后上线下课。2. 大于可以学的年龄——没问题的，我们这个年龄段孩子很多的。我给您个建议，您让孩子参加体验课试试，您要觉得孩子能学，您就让他学，到时候您要觉得孩子太小，也可以过段时间再学。眼见为实，耳听为虚嘛。',
  },
  {
    num: 23,
    name: '拓客·这是学什么的怎么学',
    category: '地推电销场景',
    personaTitle: '地推现场随口问课程是什么',
    personaId: 'persona-parent-practical',
    skillPointIds: ['sp-clarity', 'sp-value'],
    difficulty: 1,
    coverageTopics: [
      '介绍活动课：4次、每次40分钟、一对一教学',
      '说明学完能掌握基础知识、下完一盘简单的棋',
      '孩子喜欢且认可老师可长期学',
      '不合适也没关系，听完自己做决定',
    ],
    question: '怎么学呀？噢，英语/围棋/羽毛球呀~~',
    faq: '是的，我们活动课是4次，每次40分钟，一对一教学。孩子听完这4次课以后呢，会学到基础的围棋知识，可以让孩子下完一盘简单的棋。到时候您要觉得孩子喜欢、我们老师教得好，您可以让孩子长期在这边学；到时候您要觉得不合适，也没关系，您听完以后自己做决定。',
  },
  {
    num: 24,
    name: '通用异议·在家自己教孩子',
    category: '通用场景',
    personaTitle: '打算自己在家教孩子',
    personaId: 'persona-parent-rational',
    skillPointIds: ['sp-value'],
    difficulty: 1,
    coverageTopics: [
      '肯定在家自学也可以',
      '指出专业培训机构效率更高',
      '强调可以节约孩子的时间',
    ],
    question: '我在家自己教孩子就行了。',
    faq: '在家自学也可以，但是在专业的培训机构学，可能效率会高一些，可以节约孩子的时间。',
  },
  {
    num: 25,
    name: '通用异议·孩子大了还适合学吗',
    category: '通用场景',
    personaTitle: '担心孩子年龄偏大错过学习时机',
    personaId: 'persona-parent-skeptic',
    skillPointIds: ['sp-objection', 'sp-value'],
    difficulty: 1,
    coverageTopics: [
      '举大龄学员成功案例（五十多岁学员达到高水平）',
      '说明大一点的孩子理解能力更强，有优势',
    ],
    question: '我们孩子那么大了，现在学还合适吗？',
    faq: '我们学校有一个最大的学生，已经五十多岁了，学了大概六七年，现在已经有xxx的水平了。其实大一点的孩子学，理解能力会更强一些，是有优势的。',
  },
];
