import { useState, useEffect } from 'react';

/* ── 色板常量 ── */
const C = {
  ink950: '#0B0F1A',
  ink900: '#0F1420',
  ink850: '#141B2D',
  ink800: '#1A2236',
  ink700: '#232E48',
  ink600: '#2E3A56',
  accent: '#E85C62',
  accentLight: '#F07380',
  accentDark: '#D04A52',
  mint: '#34D399',
  mintLight: '#4ADE94',
  textMain: '#F2F4F8',
  textSub: '#9BA3B5',
  textDim: '#6B7384',
};

/* ──────────────────────────────────────────────
 * 导航栏配置
 * ────────────────────────────────────────────── */
type NavItem = { label: string; href: string; children?: { label: string; href: string }[] };

const NAV_ITEMS: NavItem[] = [
  {
    label: '产品',
    href: '#products',
    children: [
      { label: 'AI陪练', href: '#products' },
      { label: '辅导与能力画像', href: '#products' },
      { label: '推演沙盘', href: '#products' },
    ],
  },
  {
    label: '解决方案',
    href: '#solutions',
    children: [
      { label: '企业', href: '#solutions' },
      { label: '线下门店', href: '#solutions' },
      { label: '事业单位', href: '#solutions' },
    ],
  },
  {
    label: '技术',
    href: '#tech',
    children: [
      { label: '认知工程', href: '#tech' },
      { label: '主体性计算', href: '#tech' },
      { label: '博弈主体建模引擎', href: '#tech' },
    ],
  },
  {
    label: '资源',
    href: '#evidence',
    children: [
      { label: '白皮书', href: '#evidence' },
      { label: '案例', href: '#evidence' },
      { label: 'ROI测算工具', href: '#evidence' },
      { label: '社媒', href: '#evidence' },
    ],
  },
  { label: '关于我们', href: '#about' },
];

/* ──────────────────────────────────────────────
 * 第二屏数据
 * ────────────────────────────────────────────── */
const PROBLEM_COLS = [
  {
    tag: '正在发生的事',
    items: [
      '81%的销售团队已使用AI，但仅12%用于辅导与能力发展。',
      '79%的培训不围绕真实客户对话构建。',
      '50%的销售人员希望获得更多培训或指导。',
    ],
    color: C.accent,
  },
  {
    tag: '留下的缺口',
    items: [
      '基础话术培训的需求在下降——话术正在被AI商品化。',
      '企业用Agentic AI替代标准化流程，剩下的核心瓶颈是人（Humanware）。',
    ],
    color: C.mint,
  },
  {
    tag: '我们的判断',
    items: [
      '未来员工必须拥有两项不可外包的能力：复杂人际博弈，以及驾驭AI协同作战。',
      '这两项能力无法通过听课获得，只能在模拟对抗中练出来。',
    ],
    color: C.textMain,
  },
];

const SPECTRUM = [
  { label: '邮件SDR', replaceable: true },
  { label: '基础话术', replaceable: true },
  { label: '产品问答', replaceable: true },
  { label: '复杂谈判', replaceable: false },
  { label: '多筹码博弈', replaceable: false },
  { label: '人机协同作战', replaceable: false },
];

/* ──────────────────────────────────────────────
 * 第三屏：三层训练系统
 * ────────────────────────────────────────────── */
const TRAINING_LAYERS = [
  {
    name: '推演沙盘',
    oneLiner: '把大客户攻坚和年度规划搬进沙盘',
    features: '多回合博弈 · 多筹码管理 · AI竞对 + AI客户',
    ability: '复杂人际博弈',
    image: '/images/layer-sandbox.svg',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
        <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 14l3-3 3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    name: '辅导',
    oneLiner: '让能力变化看得见、说得清',
    features: '多维能力画像 · 经理干预建议 · 效果归因',
    ability: '校准与反馈',
    image: '/images/layer-coaching.svg',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
        <path d="M9 17v-6m4 6V8m4 9v-4M5 21h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    name: '陪练',
    oneLiner: '在能施压的AI客户面前，磨练几次',
    features: '对抗性对话 · 语音/文字 · 长记忆 · 角色一致性',
    ability: '基础对抗与AI协同',
    image: '/images/layer-practice.svg',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
        <path d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.7 9.7 0 0 1-4-.85L3 20l1.35-3.5A7.6 7.6 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

/* ──────────────────────────────────────────────
 * 第五屏：数据卡
 * ────────────────────────────────────────────── */
const DATA_CARDS = [
  { num: '3.7×', desc: '与AI有效配合的销售，达成配额的可能性', source: '（n=1,026）', isThirdParty: true },
  { num: '+57%', desc: '积极使用AI辅导的组织，高配额达成率优势', source: '（n=312）', isThirdParty: true },
  { num: '62.1%', desc: '一线人员期待"技能可视化/评分化"', source: '（n=300）', isThirdParty: true },
];

/* ──────────────────────────────────────────────
 * 第六屏：解决方案
 * ────────────────────────────────────────────── */
const SOLUTIONS = [
  {
    tag: '企业',
    title: '销售组织的能力标准化',
    points: ['销冠能力复制', '新人上手周期缩短', '大客户攻坚推演'],
    cta: '了解企业方案 →',
    color: C.accent,
    image: '/images/sol-enterprise.svg',
  },
  {
    tag: '线下门店',
    title: '店员当天能用的销售训练',
    points: ['5分钟一局', '游戏化', '手机即练'],
    cta: '了解门店方案 →',
    color: C.mint,
    image: '/images/sol-store.svg',
  },
  {
    tag: '事业单位',
    title: '合规可控的政务与党建实训',
    points: ['窗口沟通陪练', '党建流程推演', '私有化部署'],
    cta: '了解政务方案 →',
    color: C.textMain,
    image: '/images/sol-gov.svg',
  },
];

/* ──────────────────────────────────────────────
 * 第七屏：信任与合规
 * ────────────────────────────────────────────── */
const TRUST_ITEMS = [
  {
    title: '私有化部署',
    desc: '数据不出域，全量日志可审计',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: '信创适配',
    desc: '支持国产AI处理器推理部署',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
        <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 22V12M3 7l9 5 9-5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: '内容校准',
    desc: '政务场景经专家审核后进入训练',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    title: '合规框架',
    desc: '遵循《人工智能拟人化互动服务管理暂行办法》',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
        <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M5 21h14a2 2 0 0 0 2-2V8l-5-5H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
];

/* ════════════════════════════════════════════════════
 * 组件
 * ════════════════════════════════════════════════════ */

/* ── 导航栏下拉菜单 ── */
function NavDropdown({ item }: { item: NavItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="flex items-center gap-1 text-sm transition"
        style={{ color: open ? C.textMain : C.textSub }}
      >
        {item.label}
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && item.children && (
        <div
          className="absolute left-0 top-full z-50 mt-2 min-w-[180px] rounded-xl border border-white/10 py-2 shadow-2xl"
          style={{ backgroundColor: C.ink800 }}
        >
          {item.children.map((child) => (
            <a
              key={child.label}
              href={child.href}
              className="block px-4 py-2 text-sm transition hover:bg-white/5"
              style={{ color: C.textSub }}
              onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = C.textSub; }}
            >
              {child.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 首屏动态对话示意 ── */
function HeroDemo() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 1600),
      setTimeout(() => setPhase(3), 2400),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="relative">
      {/* AI 客户对话卡 */}
      <div
        className="animate-bubble-in rounded-2xl border border-white/10 p-5 shadow-2xl"
        style={{ backgroundColor: C.ink800, maxWidth: 340 }}
      >
        <div className="mb-3 flex items-center gap-2">
          <div className="h-8 w-8 rounded-full" style={{ backgroundColor: C.accent }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: C.textMain }}>AI 客户 · 王总</div>
            <div className="text-xs" style={{ color: C.textDim }}>采购总监 · 制造业</div>
          </div>
        </div>

        {phase >= 1 && (
          <div className="animate-bubble-in mb-3 rounded-xl rounded-tl-none px-4 py-3" style={{ backgroundColor: C.ink700 }}>
            <p className="text-sm leading-relaxed" style={{ color: C.textMain }}>
              这个价格我们接受不了，你们再降15%否则免谈。
            </p>
          </div>
        )}

        {phase >= 2 && (
          <div className="animate-bubble-in mb-3 flex justify-end">
            <div className="rounded-xl rounded-tr-none px-4 py-3" style={{ backgroundColor: 'rgba(232,92,98,0.15)' }}>
              <p className="text-sm leading-relaxed" style={{ color: C.textMain }}>
                王总，价格不是唯一筹码。如果我们把交付周期缩短30天…
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 浮出能力评分卡 */}
      {phase >= 3 && (
        <div
          className="animate-score-roll absolute -right-4 top-1/2 -translate-y-1/2 rounded-xl border border-white/10 p-4 shadow-2xl"
          style={{ backgroundColor: C.ink850, minWidth: 160 }}
        >
          <div className="text-xs" style={{ color: C.textSub }}>能力评分</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-3xl font-black" style={{ color: C.accent }}>72</span>
            <span className="text-sm" style={{ color: C.textSub }}>分</span>
          </div>
          <div className="mt-1 text-xs" style={{ color: C.textDim }}>异议处理</div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: C.ink600 }}>
            <div className="h-full rounded-full" style={{ width: '72%', backgroundColor: C.accent }} />
          </div>
        </div>
      )}

      {/* 远处沙盘看板 */}
      <div
        className="absolute -bottom-6 -left-6 rounded-lg border border-white/5 p-3 opacity-40 shadow-lg"
        style={{ backgroundColor: C.ink850, minWidth: 120 }}
      >
        <div className="text-xs font-semibold" style={{ color: C.textSub }}>沙盘看板</div>
        <div className="mt-1 flex gap-1">
          {[40, 65, 30].map((h, i) => (
            <div key={i} className="w-2 rounded-t" style={{ height: h, backgroundColor: C.mint }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── 替代光谱条 ── */
function ReplaceSpectrum() {
  return (
    <div className="mt-10">
      <div className="mb-3 flex items-center justify-between text-xs" style={{ color: C.textDim }}>
        <span>高可替代</span>
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
            <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          需求结构迁移
        </span>
        <span>不可替代</span>
      </div>
      <div className="flex items-center gap-0 overflow-hidden rounded-xl border border-white/10" style={{ backgroundColor: C.ink800 }}>
        {SPECTRUM.map((s, i) => (
          <div
            key={s.label}
            className="flex-1 px-3 py-3 text-center text-xs transition"
            style={{
              backgroundColor: s.replaceable ? 'rgba(155,163,181,0.08)' : 'rgba(232,92,98,0.12)',
              color: s.replaceable ? C.textDim : C.textMain,
              borderRight: i < SPECTRUM.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
            }}
          >
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
 * 主 App
 * ════════════════════════════════════════════════════ */
export default function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen" style={{ backgroundColor: C.ink900, color: C.textMain }}>
      {/* ════════ 顶部固定导航栏 ════════ */}
      <nav
        className="sticky top-0 z-50 border-b border-white/5 backdrop-blur-xl"
        style={{ backgroundColor: 'rgba(15,20,32,0.88)' }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          {/* Logo */}
          <a href="#hero" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Grasp" className="h-9 w-9 rounded-xl" />
            <span className="text-lg font-bold tracking-tight" style={{ color: C.textMain }}>Grasp</span>
          </a>

          {/* 桌面端导航 */}
          <div className="hidden items-center gap-6 lg:flex" style={{ color: C.textSub }}>
            {NAV_ITEMS.map((item) =>
              item.children ? (
                <NavDropdown key={item.label} item={item} />
              ) : (
                <a
                  key={item.label}
                  href={item.href}
                  className="text-sm transition"
                  onMouseEnter={(e) => (e.currentTarget.style.color = C.textMain)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = C.textSub)}
                >
                  {item.label}
                </a>
              )
            )}
          </div>

          {/* 右侧 CTA */}
          <div className="flex items-center gap-3">
            <a
              href="https://train.grasp.chat"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden rounded-full border border-white/15 px-5 py-2 text-sm font-semibold transition hover:border-white/30 sm:inline-flex"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: C.textMain }}
            >
              免费试用
            </a>
            <a
              href="#cta"
              className="rounded-full px-5 py-2 text-sm font-bold transition"
              style={{ backgroundColor: C.accent, color: C.ink950 }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.accentLight)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = C.accent)}
            >
              预约演示
            </a>
            {/* 移动端菜单按钮 */}
            <button
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{ color: C.textSub }}
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* 移动端展开菜单 */}
        {mobileMenuOpen && (
          <div className="border-t border-white/5 px-6 py-4 lg:hidden" style={{ backgroundColor: C.ink850 }}>
            {NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="block py-2 text-sm"
                style={{ color: C.textSub }}
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </div>
        )}
      </nav>

      {/* ════════ 第一屏：Hero ════════ */}
      <section id="hero" className="relative overflow-hidden px-6 pt-20 pb-20 md:pt-28 md:pb-28">
        <div className="pointer-events-none absolute inset-0">
          <img
            src="/images/hero-bg.svg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            className="absolute left-1/2 top-0 h-[400px] w-[600px] -translate-x-1/2 rounded-full blur-[120px]"
            style={{ backgroundColor: 'rgba(232,92,98,0.10)' }}
          />
          <div
            className="absolute right-0 top-1/3 h-[300px] w-[400px] rounded-full blur-[100px]"
            style={{ backgroundColor: 'rgba(52,211,153,0.06)' }}
          />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          {/* 左侧文案 */}
          <div>
            <div
              className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-1.5 text-xs backdrop-blur-sm"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', color: C.textSub }}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: C.mint }} />
              陪练 · 指导 · 模拟 · 预测
            </div>

            <h1 className="mt-8 text-4xl font-black leading-tight tracking-tight md:text-6xl">
              训练AI无法替代的人
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed md:text-xl" style={{ color: C.textMain }}>
              能力训练平台——基于认知建模，在AI客户面前练判断、练筹码、练情绪管理，覆盖销售、汇报、谈判、客服、事件应对等多种场景。
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <a
                href="https://train.grasp.chat"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-base font-bold shadow-lg transition hover:scale-105"
                style={{ backgroundColor: C.accent, color: C.ink950, boxShadow: '0 10px 30px rgba(232,92,98,0.2)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = C.accentLight;
                  e.currentTarget.style.boxShadow = '0 10px 40px rgba(232,92,98,0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = C.accent;
                  e.currentTarget.style.boxShadow = '0 10px 30px rgba(232,92,98,0.2)';
                }}
              >
                立即试用
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 transition group-hover:translate-x-0.5">
                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
              <a
                href="#cta"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-7 py-3.5 text-base font-semibold backdrop-blur-sm transition hover:border-white/30"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: C.textMain }}
              >
                预约场景演示
              </a>
            </div>

            {/* 信任条 */}
            <div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs" style={{ color: C.textDim }}>
              {['销售谈判', '客户攻坚', '跟进与报价', '门店成交', '窗口沟通与汇报'].map((t, i) => (
                <span key={t} className="flex items-center gap-2">
                  {i > 0 && <span style={{ color: C.textDim }}>·</span>}
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* 右侧动态示意 */}
          <div className="hidden justify-center lg:flex">
            <HeroDemo />
          </div>
        </div>
      </section>

      {/* ════════ 第二屏：Humanware 时代的断层 ════════ */}
      <section className="relative overflow-hidden px-6 py-24" style={{ backgroundColor: C.ink950 }}>
        <img
          src="/images/gap-bg.svg"
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
        />
        <div className="relative mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold md:text-4xl">话术已经被AI学会，难的是 "怎么应对人"</h2>
            <p className="mt-3" style={{ color: C.textSub }}>
              基础话术正在被AI商品化，业务的核心瓶颈已迁移到不可外包的能力上
            </p>
          </div>

          {/* 三栏并置 */}
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {PROBLEM_COLS.map((col) => (
              <div
                key={col.tag}
                className="rounded-2xl border border-white/8 p-6"
                style={{ backgroundColor: C.ink850 }}
              >
                <div className="mb-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: `${col.color}20`, color: col.color }}>
                  {col.tag}
                </div>
                <ul className="space-y-3">
                  {col.items.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed" style={{ color: C.textMain }}>
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: col.color }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* 替代光谱 */}
          <ReplaceSpectrum />
        </div>
      </section>

      {/* ════════ 第三屏：三层训练系统 ════════ */}
      <section id="products" className="px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold md:text-4xl">
              陪练针对日常，辅导应对实战，沙盘用以事前
            </h2>
            <p className="mt-3" style={{ color: C.textSub }}>
              多级AI系统，从基础对抗到复杂博弈
            </p>
          </div>

          {/* 三层堆叠卡片（从下到上） */}
          <div className="mt-14 space-y-4">
            {[...TRAINING_LAYERS].reverse().map((layer) => (
              <div
                key={layer.name}
                className="group relative overflow-hidden rounded-2xl border border-white/8 p-6 transition md:p-8"
                style={{ backgroundColor: C.ink850 }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${C.accent}40`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
              >
                <img
                  src={layer.image}
                  alt=""
                  className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-64 object-cover opacity-25 md:block lg:w-80"
                  style={{
                    WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,0.9), transparent)',
                    maskImage: 'linear-gradient(to left, rgba(0,0,0,0.9), transparent)',
                  }}
                />
                <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-4">
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${C.accent}15`, color: C.accent }}
                    >
                      {layer.icon}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold" style={{ color: C.textMain }}>{layer.name}</h3>
                      <p className="mt-1 text-sm" style={{ color: C.textSub }}>{layer.oneLiner}</p>
                    </div>
                  </div>
                  <div className="md:text-right">
                    <p className="text-sm" style={{ color: C.textMain }}>{layer.features}</p>
                    <p className="mt-1 text-xs" style={{ color: C.textDim }}>
                      对应能力：<span style={{ color: C.mint }}>{layer.ability}</span>
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 底部一行 */}
          <div className="mt-8 text-center">
            <p className="text-sm" style={{ color: C.textSub }}>
              客户画像｜实时通话｜认知可视化｜实时指导｜专家校准｜推演沙盘｜主体性博弈
            </p>
            <a
              href="#products"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold transition"
              style={{ color: C.accent }}
              onMouseEnter={(e) => (e.currentTarget.style.color = C.accentLight)}
              onMouseLeave={(e) => (e.currentTarget.style.color = C.accent)}
            >
              查看产品详情 →
            </a>
          </div>
        </div>
      </section>

      {/* ════════ 第四屏：认知工程与主体性计算 ════════ */}
      <section id="tech" className="px-6 py-24" style={{ backgroundColor: C.ink950 }}>
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold leading-tight md:text-4xl">
              不是"更会说话的AI"，是"会判断、会权衡、会记忆的博弈主体"
            </h2>
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            {/* 认知工程 */}
            <div
              className="relative overflow-hidden rounded-2xl border border-white/8 p-8"
              style={{ backgroundColor: C.ink850 }}
            >
              <img
                src="/images/tech-cognitive.svg"
                alt=""
                className="pointer-events-none absolute -right-8 -top-8 w-48 opacity-20 lg:w-60"
                style={{
                  WebkitMaskImage: 'radial-gradient(circle at 60% 40%, black 30%, transparent 70%)',
                  maskImage: 'radial-gradient(circle at 60% 40%, black 30%, transparent 70%)',
                }}
              />
              <div className="relative">
              <div
                className="mb-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                style={{ backgroundColor: `${C.accent}20`, color: C.accent }}
              >
                方法论
              </div>
              <h3 className="text-2xl font-bold">认知工程</h3>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: C.textSub }}>
                认知工程不训练"话术熟练度"，而是训练判断力、策略选择和情绪管理，是基于Humanware(人件)的工程。每一次训练都是一次完整的认知任务：
              </p>
              {/* 四阶段 */}
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {['感知', '判断', '决策', '反馈'].map((stage, i) => (
                  <div key={stage} className="flex items-center gap-2">
                    <span
                      className="rounded-lg px-3 py-1.5 text-sm font-medium"
                      style={{ backgroundColor: C.ink700, color: C.textMain }}
                    >
                      {stage}
                    </span>
                    {i < 3 && (
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" style={{ color: C.textDim }}>
                        <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs" style={{ color: C.textDim }}>
                客户信号 → 意图与筹码 → 策略选择 → 结果归因。训练数据沉淀的是认知轨迹，而非对话文本。
              </p>
              </div>
            </div>

            {/* 主体性计算 */}
            <div
              className="relative overflow-hidden rounded-2xl border border-white/8 p-8"
              style={{ backgroundColor: C.ink850 }}
            >
              <img
                src="/images/tech-agency.svg"
                alt=""
                className="pointer-events-none absolute -bottom-10 -right-10 w-52 opacity-20 lg:w-64"
                style={{
                  WebkitMaskImage: 'radial-gradient(circle at 40% 60%, black 30%, transparent 72%)',
                  maskImage: 'radial-gradient(circle at 40% 60%, black 30%, transparent 72%)',
                }}
              />
              <div className="relative">
              <div
                className="mb-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                style={{ backgroundColor: `${C.mint}20`, color: C.mint }}
              >
                技术内核
              </div>
              <h3 className="text-2xl font-bold">主体性计算</h3>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: C.textSub }}>
                主体性计算建模的是"客户如何判断、如何权衡、如何记忆"，而非"客户如何说话"。
              </p>
              <div className="mt-6 space-y-2">
                {[
                  { label: '信念', desc: '客户对市场和产品的固有认知' },
                  { label: '意图', desc: '真实诉求与表面诉求的偏差' },
                  { label: '筹码权重', desc: '价格、交付、服务在决策中的权重' },
                  { label: '记忆', desc: '跨会话记住上次报价和异议' },
                  { label: '策略倾向', desc: '在对抗中选择的博弈策略' },
                ].map((item) => (
                  <div key={item.label} className="flex items-baseline gap-2 text-sm">
                    <span className="font-semibold" style={{ color: C.mint }}>{item.label}</span>
                    <span style={{ color: C.textSub }}>—— {item.desc}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs" style={{ color: C.textDim }}>
                博弈主体建模引擎使 AI 客户和 AI 对手在跨会话中保持行为一致性。
              </p>
              </div>
            </div>
          </div>

          {/* 底部一行 */}
          <div className="mt-8 text-center">
            <p className="text-sm" style={{ color: C.textSub }}>
              认知工程是方法，主体性计算是底座，Humanware是框架
            </p>
            <a
              href="#evidence"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold transition"
              style={{ color: C.accent }}
              onMouseEnter={(e) => (e.currentTarget.style.color = C.accentLight)}
              onMouseLeave={(e) => (e.currentTarget.style.color = C.accent)}
            >
              阅读技术白皮书 →
            </a>
          </div>
        </div>
      </section>

      {/* ════════ 第五屏：效果归因 ════════ */}
      <section id="evidence" className="px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold md:text-4xl">
              训练效果不靠感觉，靠归因链路
            </h2>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {DATA_CARDS.map((card) => (
              <div
                key={card.num}
                className="rounded-2xl border border-white/8 p-8 text-center"
                style={{ backgroundColor: C.ink850 }}
              >
                <div className="text-5xl font-black md:text-6xl" style={{ color: C.accent }}>
                  {card.num}
                </div>
                <p className="mt-4 text-sm leading-relaxed" style={{ color: C.textMain }}>
                  {card.desc}
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: card.isThirdParty ? C.mint : C.accent }}
                  />
                  <span className="text-xs" style={{ color: C.textDim }}>
                    {card.source}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <a
              href="#cta"
              className="inline-flex items-center gap-1 text-sm font-semibold transition"
              style={{ color: C.accent }}
              onMouseEnter={(e) => (e.currentTarget.style.color = C.accentLight)}
              onMouseLeave={(e) => (e.currentTarget.style.color = C.accent)}
            >
              了解效果归因方法论 →
            </a>
          </div>
        </div>
      </section>

      {/* ════════ 第六屏：解决方案 ════════ */}
      <section id="solutions" className="px-6 py-24" style={{ backgroundColor: C.ink950 }}>
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold md:text-4xl">
              不同的场景，同一套底座，不同的训练重点
            </h2>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {SOLUTIONS.map((sol) => (
              <div
                key={sol.tag}
                className="group overflow-hidden rounded-2xl border border-white/8 transition"
                style={{ backgroundColor: C.ink850 }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${sol.color}30`; e.currentTarget.style.transform = 'translateY(-4px)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <div className="relative h-36 overflow-hidden">
                  <img
                    src={sol.image}
                    alt={sol.title}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: 'linear-gradient(to bottom, rgba(20,27,45,0) 45%, #141B2D 100%)' }}
                  />
                </div>
                <div className="p-8">
                <div
                  className="mb-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ backgroundColor: `${sol.color}20`, color: sol.color }}
                >
                  {sol.tag}
                </div>
                <h3 className="text-xl font-bold" style={{ color: C.textMain }}>{sol.title}</h3>
                <ul className="mt-4 space-y-2">
                  {sol.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-sm" style={{ color: C.textSub }}>
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" style={{ color: sol.color }}>
                        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {p}
                    </li>
                  ))}
                </ul>
                <a
                  href="#cta"
                  className="mt-6 inline-flex text-sm font-semibold transition"
                  style={{ color: sol.color }}
                >
                  {sol.cta}
                </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ 第七屏：信任与合规 ════════ */}
      <section className="relative overflow-hidden px-6 py-24">
        <img
          src="/images/trust-bg.svg"
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-60"
        />
        <div className="relative mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold md:text-4xl">产品化与定制化结合</h2>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_ITEMS.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/8 p-6 text-center"
                style={{ backgroundColor: C.ink850 }}
              >
                <div
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: `${C.mint}15`, color: C.mint }}
                >
                  {item.icon}
                </div>
                <h3 className="mt-4 text-base font-bold" style={{ color: C.textMain }}>{item.title}</h3>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: C.textSub }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ 第八屏：行动号召 ════════ */}
      <section id="cta" className="relative overflow-hidden px-6 py-24" style={{ backgroundColor: C.ink950 }}>
        <img
          src="/images/cta-bg.svg"
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold md:text-4xl">
            从一个场景开始，验证AI的效果
          </h2>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href="#cta"
              className="group inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-bold shadow-lg transition hover:scale-105"
              style={{ backgroundColor: C.accent, color: C.ink950, boxShadow: '0 10px 30px rgba(232,92,98,0.2)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = C.accentLight; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = C.accent; }}
            >
              预约30分钟场景演示
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 transition group-hover:translate-x-0.5">
                <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a
              href="#cta"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-8 py-4 text-base font-semibold transition hover:border-white/30"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: C.textMain }}
            >
              下载行业场景清单（PDF）
            </a>
          </div>
        </div>
      </section>

      {/* ════════ Footer ════════ */}
      <footer id="about" className="border-t border-white/5 px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-4">
            {/* 公司信息 */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="Grasp" className="h-8 w-8 rounded-lg" />
                <span className="font-bold" style={{ color: C.textMain }}>Grasp</span>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-relaxed" style={{ color: C.textSub }}>
                训练AI无法替代的人。 <br />以认知工程为方法，以主体性计算为内核。
              </p>
            </div>

            {/* 联系方式 */}
            <div>
              <h4 className="text-sm font-semibold" style={{ color: C.textMain }}>联系方式</h4>
              <ul className="mt-3 space-y-2 text-xs" style={{ color: C.textSub }}>
                <li>咨询：bd@grasp.chat</li>
                <li>
                  免费试用：
                  <a
                    href="https://train.grasp.chat"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition hover:text-white"
                    style={{ color: C.accent }}
                  >
                    train.grasp.chat
                  </a>
                </li>
              </ul>
            </div>

            {/* 社交链接 */}
            <div>
              <h4 className="text-sm font-semibold" style={{ color: C.textMain }}>关注我们</h4>
              <div className="mt-3 flex gap-3">
                {[
                  { label: '公众号', img: '/qrcode_grasp.jpg' },
                  { label: '小红书', img: '/xiaohongshu_qrcode.jpg' },
                  { label: '抖音', img: '/douyin_qrcode.jpg' },
                ].map((s) => (
                  <a key={s.label} href="#" className="block">
                    <img src={s.img} alt={s.label} className="h-16 w-16 rounded-lg" />
                    <span className="mt-1 block text-center text-xs" style={{ color: C.textDim }}>{s.label}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-white/5 pt-6 text-xs md:flex-row" style={{ color: C.textDim }}>
            <span>©2026 Grasp · AI驱动的能力训练平台</span>
            <div className="flex gap-4">
              <a href="#" className="transition hover:text-white">隐私政策</a>
              <a href="#" className="transition hover:text-white">服务条款</a>
              <span>京ICP备2025130300号-6</span>
            </div>
          </div>
        </div>
      </footer>

      {/* ════════ 移动端底部固定 CTA ════════ */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 px-6 py-3 lg:hidden"
        style={{ backgroundColor: 'rgba(15,20,32,0.95)' }}
      >
        <a
          href="https://train.grasp.chat"
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-full py-3 text-center text-base font-bold"
          style={{ backgroundColor: C.accent, color: C.ink950 }}
        >
          立即试用
        </a>
      </div>
    </div>
  );
}
