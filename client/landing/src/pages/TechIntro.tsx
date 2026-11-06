import { useNavigate } from 'react-router-dom';

const C = {
  bg: '#F7F7F8',
  card: '#FFFFFF',
  line: '#EBEBEF',
  coral: '#FF6B5B',
  coralDark: '#E85A4A',
  coralSoft: '#FFF0EE',
  green: '#2FAE7B',
  text: '#1F2329',
  textSub: '#6B7280',
  textDim: '#9CA1AB',
  purple: '#7C5CFC',
  amber: '#F5A623',
};

const TECH_ITEMS = [
  {
    name: '认知计算',
    nameEn: 'Cognitive Computing',
    subtitle: '理解判断依据与决策过程',
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="h-10 w-10">
        <circle cx="20" cy="20" r="16" stroke={C.coral} strokeWidth="2" />
        <circle cx="20" cy="14" r="4" fill={C.coral} fillOpacity="0.3" stroke={C.coral} strokeWidth="1.5" />
        <circle cx="13" cy="24" r="3" fill={C.coral} fillOpacity="0.2" stroke={C.coral} strokeWidth="1.5" />
        <circle cx="27" cy="24" r="3" fill={C.coral} fillOpacity="0.2" stroke={C.coral} strokeWidth="1.5" />
        <path d="M20 18v6M17 24h6" stroke={C.coral} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    color: C.coral,
    soft: C.coralSoft,
    what: '认知计算让系统理解人在信息加工、判断与决策中的认知过程。传统培训只看"说了什么"，认知计算进一步解释"为何这样判断"。',
    how: '通过建模学员在对话中的信息处理路径、判断依据与决策逻辑，将复盘从行为层深入到认知层。系统不仅记录答案，还能还原思考过程。',
    value: '使指标具备可解释性——学员不仅能知道"做得好不好"，还能理解"为什么好/不好"，从而获得可复用的认知提升路径，而非仅靠经验积累。',
  },
  {
    name: '情感计算',
    nameEn: 'Affective Computing',
    subtitle: '识别互动中的情绪状态变化',
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="h-10 w-10">
        <circle cx="20" cy="20" r="16" stroke={C.green} strokeWidth="2" />
        <path d="M13 18c0-2 2-3 3-3s1 2 3 2 2-3 4-3 3 1 3 3c0 4-3 8-6 8s-6-4-6-7z" stroke={C.green} strokeWidth="1.5" fill={C.green} fillOpacity="0.15" />
        <circle cx="26" cy="12" r="4" fill={C.green} fillOpacity="0.3" stroke={C.green} strokeWidth="1" />
      </svg>
    ),
    color: C.green,
    soft: 'rgba(47,174,123,0.08)',
    what: '情感计算识别与建模训练过程中的情绪状态及其变化——包括犹豫、抵触、信任建立与节奏波动。',
    how: '结合语音特征、对话节奏与非语言线索，实时捕捉学员在互动中的情绪走向，将隐性状态转为可量化维度。',
    value: '销售互动中的情绪变化往往先于语言表达。将情绪维度纳入指标，使复盘更接近真实互动，帮助学员感知并调节情绪状态。',
  },
  {
    name: '认知—情绪—行为建模',
    nameEn: 'Cognition–Emotion–Behavior Modeling',
    subtitle: '联动系统揭示行为成因',
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="h-10 w-10">
        <circle cx="13" cy="14" r="5" stroke={C.purple} strokeWidth="1.5" fill={C.purple} fillOpacity="0.1" />
        <circle cx="27" cy="14" r="5" stroke={C.purple} strokeWidth="1.5" fill={C.purple} fillOpacity="0.1" />
        <circle cx="20" cy="27" r="5" stroke={C.purple} strokeWidth="1.5" fill={C.purple} fillOpacity="0.1" />
        <path d="M13 19v6M27 19v6M13 25h14" stroke={C.purple} strokeWidth="1.5" />
      </svg>
    ),
    color: C.purple,
    soft: 'rgba(124,92,252,0.08)',
    what: '将认知判断、情绪反应与外显行为作为联动系统进行建模——三者相互影响、共同决定销售互动质量。',
    how: '分析特定认知偏差如何引发情绪变化，进而导致特定行为表现。建立"想什么→感觉什么→做什么"的完整因果链。',
    value: '解释"为什么这个行为会发生"，而不只评价"这个行为好不好"。改善建议因此具备因果依据，帮助学员从根源调整而非仅纠正表面行为。',
  },
  {
    name: '主体性计算',
    nameEn: 'Subjecthood Computing',
    subtitle: '让模拟对象具备自主意识',
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="h-10 w-10">
        <circle cx="20" cy="14" r="6" stroke={C.amber} strokeWidth="1.5" fill={C.amber} fillOpacity="0.15" />
        <path d="M10 32c0-5.5 4.5-10 10-10s10 4.5 10 10" stroke={C.amber} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="20" cy="12" r="1.5" fill={C.amber} />
        <path d="M25 8l4-2M29 6l-2 4" stroke={C.amber} strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
    color: C.amber,
    soft: 'rgba(245,166,35,0.08)',
    what: '让模拟对象具备自主目标、意图与反应，而非按固定脚本运行。"客户"会因学员的表达而改变态度与策略。',
    how: '为每个模拟角色设定目标函数、性格参数与反应策略，形成自主决策循环。不同角色应对同一话术会产生差异化反应。',
    value: '训练的是应对能力，而非背诵话术。学员在高度仿真的博弈环境中适应真实销售互动的不确定性，培养灵活应变的销售素养。',
  },
  {
    name: '模拟技术',
    nameEn: 'Scenario Modeling & Agent Simulation',
    subtitle: '场景模型与主体模拟',
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="h-10 w-10">
        <rect x="8" y="8" width="10" height="10" rx="2" stroke={C.coral} strokeWidth="1.5" fill={C.coral} fillOpacity="0.08" />
        <rect x="22" y="8" width="10" height="10" rx="2" stroke={C.coral} strokeWidth="1.5" fill={C.coral} fillOpacity="0.08" />
        <rect x="8" y="22" width="10" height="10" rx="2" stroke={C.coral} strokeWidth="1.5" fill={C.coral} fillOpacity="0.08" />
        <rect x="22" y="22" width="10" height="10" rx="2" stroke={C.coral} strokeWidth="1.5" fill={C.coral} fillOpacity="0.08" />
        <path d="M18 13h4M13 18v4M27 18v4M18 27h4" stroke={C.coral} strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
    color: C.coral,
    soft: C.coralSoft,
    what: '以场景模型构建真实业务情境，以主体模拟生成具有自主反应的交互对象，实现训练环境的可扩展和可定制。',
    how: '场景模型定义业务背景、客户画像与复杂度梯度；主体模拟基于认知—情感—行为模型，生成与场景匹配的自主交互对象。',
    value: '场景可复现、可对比、可扩展；训练对象可模拟不同角色与难度。真实感与规模化训练由此兼得，是大规模落地实景训练的前提条件。',
  },
];

export default function TechIntro() {
  const navigate = useNavigate();

  return (
    <div style={{ backgroundColor: C.bg, minHeight: '100vh' }}>
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-white/60 backdrop-blur-xl" style={{ backgroundColor: 'rgba(255,255,255,0.92)' }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-lg font-bold transition hover:opacity-70"
            style={{ color: C.text }}
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <polyline points="15 18 9 12 15 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            返回首页
          </button>
          <a
            href="https://train.grasp.chat"
            className="rounded-full px-5 py-2 text-sm font-bold text-white transition hover:opacity-90"
            style={{ backgroundColor: C.coral }}
          >
            开始训练
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        {/* 页面标题 */}
        <div className="text-center">
          <span className="inline-block rounded-full px-4 py-1.5 text-xs font-semibold tracking-wider" style={{ backgroundColor: C.coralSoft, color: C.coral }}>
            TECH FOUNDATION
          </span>
          <h1 className="mt-4 text-3xl font-bold md:text-4xl" style={{ color: C.text }}>
            认知计算与模拟技术底座
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed" style={{ color: C.textSub }}>
            实景训练之所以可执行，指标复盘之所以可解释，改善结果之所以可验证，来自底层对认知、情绪、行为与模拟交互的建模能力。
          </p>
        </div>

        {/* 技术卡片 */}
        <div className="mt-16 space-y-8">
          {TECH_ITEMS.map((item, i) => (
            <article
              key={i}
              className="group overflow-hidden rounded-2xl border transition hover:shadow-lg"
              style={{ borderColor: C.line, backgroundColor: C.card }}
            >
              {/* 卡片头部 */}
              <div className="flex items-center gap-4 p-6 pb-4" style={{ backgroundColor: item.soft }}>
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: C.card }}>
                  {item.icon}
                </div>
                <div>
                  <div className="text-xs font-medium tracking-wide" style={{ color: item.color }}>{item.nameEn}</div>
                  <h2 className="text-xl font-bold" style={{ color: C.text }}>{item.name}</h2>
                </div>
              </div>
              {/* 卡片内容 */}
              <div className="grid gap-5 p-6 md:grid-cols-3">
                <div className="rounded-xl p-4" style={{ backgroundColor: C.bg }}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: item.color }}>是</span>
                    <span className="text-sm font-semibold" style={{ color: C.text }}>是什么</span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: C.textSub }}>{item.what}</p>
                </div>
                <div className="rounded-xl p-4" style={{ backgroundColor: C.bg }}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: item.color }}>怎</span>
                    <span className="text-sm font-semibold" style={{ color: C.text }}>怎么做</span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: C.textSub }}>{item.how}</p>
                </div>
                <div className="rounded-xl p-4" style={{ backgroundColor: C.bg }}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: item.color }}>值</span>
                    <span className="text-sm font-semibold" style={{ color: C.text }}>为何重要</span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: C.textSub }}>{item.value}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

      </main>
    </div>
  );
}
