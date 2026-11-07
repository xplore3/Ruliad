import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/* ════════════════════════════════════════════════════ */

const C = {
  bg: '#F7F7F8',
  card: '#FFFFFF',
  warm: '#F1F2F4',
  line: '#EBEBEF',
  coral: '#FF6B5B',
  coralDark: '#E85A4A',
  coralSoft: '#FFF0EE',
  green: '#2FAE7B',
  text: '#1F2329',
  textSub: '#6B7280',
  textDim: '#9CA1AB',
};

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 11h6M11 8v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconBolt() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="currentColor" fillOpacity="0.15" />
    </svg>
  );
}

function IconTool() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
      <path d="M14 7l3-3 3 3-3 3-3-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 10L3 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 14l-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconAward() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
      <circle cx="12" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 14l-1.5 7L12 19l4.5 2L15 14" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 6l-1.5-3M16 6l1.5-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
      <path d="M4 20V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="7" y="11" width="3" height="6" rx="0.5" fill="currentColor" fillOpacity="0.4" />
      <rect x="12" y="7" width="3" height="10" rx="0.5" fill="currentColor" fillOpacity="0.4" />
      <rect x="17" y="13" width="3" height="4" rx="0.5" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

function IconScene() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
      <rect x="3" y="3" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8.5" cy="10" r="1.5" fill="currentColor" fillOpacity="0.4" />
      <circle cx="15.5" cy="10" r="1.5" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

function IconExpert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 21c0-3.87 3.13-7 7-7s7 3.13 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 5l3-1M18 4v3M18 4l1.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconMetric() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3v9l6 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 12l3.5 3.5L17 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconDoc({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" stroke={color} strokeWidth="1.8" />
      <path d="M14 3v5h5" stroke={color} strokeWidth="1.8" />
      <path d="M9 13h6M9 17h6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconArrows() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
      <path d="M3 8h14l-3-3M21 16h-14l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" />
    </svg>
  );
}

/* 技术底座 5 项技术 */
const TECH_ITEMS = [
  { name: '认知计算', nameEn: 'Cognitive Computing' },
  { name: '情感计算', nameEn: 'Affective Computing' },
  { name: '认知—情绪—行为建模', nameEn: 'Cognition–Emotion–Behavior Modeling' },
  { name: '主体性计算', nameEn: 'Subjecthood Computing' },
  { name: '模拟技术', nameEn: 'Scenario Modeling & Agent Simulation' },
];

function TechCard({ item, index }: { item: { name: string; nameEn: string }; index: number }) {
  return (
    <div
      className="group flex w-full items-center gap-3 rounded-2xl border border-[var(--color-line)] px-6 py-4 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] lg:w-[300px] lg:shrink-0"
      style={{ backgroundColor: C.card }}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: index % 2 === 0 ? C.coral : C.green }}>
        {index + 1}
      </div>
      <div>
        <div className="text-sm font-bold" style={{ color: C.text }}>{item.name}</div>
        <div className="text-[11px] tracking-wide" style={{ color: C.textDim }}>{item.nameEn}</div>
      </div>
    </div>
  );
}

function IconCompass({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
      <path d="M16 8l-2 6-6 2 2-6 6-2z" stroke={color} strokeWidth="1.5" fill={color} fillOpacity="0.2" />
    </svg>
  );
}

function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null);

  const navItems: { label: string; href?: string; items?: { label: string; href: string; desc?: string }[] }[] = [
    {
      label: '产品',
      items: [
        { label: '带练', href: '#loop', desc: '实景训练闭环，从练过到练成' },
        { label: '模拟推演', href: '#tech', desc: '场景化模拟交互与指标复盘' },
      ],
    },
    {
      label: '解决方案',
      items: [
        { label: '线下门店', href: '#pillars', desc: '门店销售团队能力建设' },
        { label: '企业单位', href: '#deliverables', desc: '企业级销售训练闭环交付' },
      ],
    },
    {
      label: '技术',
      items: [
        { label: '认知计算', href: '#tech', desc: '理解判断依据与决策过程' },
        { label: '情感计算', href: '#tech', desc: '识别互动中的情绪状态变化' },
        { label: '主体性计算', href: '#tech', desc: '让模拟对象自主反应' },
        { label: '场景模拟', href: '#tech', desc: '真实业务场景的可扩展建模' },
      ],
    },
    {
      label: '资源',
      items: [
        { label: '产品白皮书', href: '#deliverables', desc: '了解训练体系与效果承诺' },
        { label: '技术文档', href: '#tech', desc: '认知计算与模拟技术底座' },
        { label: '社媒', href: '#about', desc: '关注我们获取最新动态' },
      ],
    },
    { label: '关于我们', href: '#about' },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-white/60 backdrop-blur-xl" style={{ backgroundColor: 'rgba(255,255,255,0.92)' }}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#hero" className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Graspit" className="h-9 w-9 rounded-xl" />
          <span className="text-lg font-bold tracking-tight" style={{ color: C.coral }}>Graspit</span>
        </a>
        <div className="hidden items-center gap-7 lg:flex">
          {navItems.map((item) => (
            <div key={item.label} className="relative"
              onMouseEnter={() => item.items ? setDropdownOpen(item.label) : setDropdownOpen(null)}
              onMouseLeave={() => setDropdownOpen(null)}>
              {item.items ? (
                <button className="flex items-center gap-1 text-sm font-medium transition cursor-pointer"
                  style={{ color: dropdownOpen === item.label ? C.coral : C.textSub }}>
                  {item.label}
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 transition-transform" style={{ transform: dropdownOpen === item.label ? 'rotate(180deg)' : 'none' }}>
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : (
                <a href={item.href} className="text-sm font-medium transition" style={{ color: C.textSub }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = C.text)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = C.textSub)}>
                  {item.label}
                </a>
              )}
              {item.items && dropdownOpen === item.label && (
                <div className="absolute left-1/2 top-full -translate-x-1/2 pt-3">
                  <div className="rounded-2xl border border-[var(--color-line)] p-2 shadow-lg min-w-[220px]"
                    style={{ backgroundColor: C.card }}>
                    {item.items.map((sub) => (
                      <a key={sub.label} href={sub.href}
                        className="flex flex-col gap-0.5 rounded-xl px-4 py-2.5 transition hover:bg-[var(--color-coral-soft)]"
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = C.coralSoft; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                        <span className="text-sm font-medium" style={{ color: C.text }}>{sub.label}</span>
                        {sub.desc && <span className="text-xs leading-snug" style={{ color: C.textDim }}>{sub.desc}</span>}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <a href="https://train.grasp.chat" target="_blank" rel="noopener noreferrer"
            className="hidden sm:inline-flex rounded-full border border-white/60 px-5 py-2 text-sm font-semibold transition hover:border-[var(--color-coral)] hover:text-[var(--color-coral)]"
            style={{ backgroundColor: '#fff', color: C.text }}>
            免费试用
          </a>
          <a href="mailto:bd@grasp.chat?subject=预约演示"
            className="rounded-full px-5 py-2 text-sm font-bold transition"
            style={{ backgroundColor: C.coral, color: '#fff' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.coralDark)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = C.coral)}>
            预约演示
          </a>
          <button className="lg:hidden" onClick={() => setMobileOpen(!mobileOpen)} style={{ color: C.textSub }}>
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
              {mobileOpen ? (
                <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="border-t border-white/60 px-6 py-4 lg:hidden" style={{ backgroundColor: C.card }}>
          {navItems.map((item) => (
            <div key={item.label} className="border-b border-[var(--color-line)] last:border-b-0">
              {item.items ? (
                <div className="py-2">
                  <div className="text-sm font-semibold mb-1" style={{ color: C.text }}>{item.label}</div>
                  <div className="pl-3 space-y-1">
                    {item.items.map((sub) => (
                      <a key={sub.label} href={sub.href} className="block py-1.5 text-xs" style={{ color: C.textSub }} onClick={() => setMobileOpen(false)}>
                        {sub.label}
                      </a>
                    ))}
                  </div>
                </div>
              ) : (
                <a href={item.href} className="block py-2 text-sm" style={{ color: C.textSub }} onClick={() => setMobileOpen(false)}>
                  {item.label}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

function RadarChart() {
  const dimensions = [
    { label: '场景应对', value: 0.78 },
    { label: '异议处理', value: 0.65 },
    { label: '需求挖掘', value: 0.82 },
    { label: '节奏把控', value: 0.70 },
    { label: '信任建立', value: 0.75 },
    { label: '筹码管理', value: 0.60 },
  ];
  const cx = 120, cy = 120, r = 80;
  const n = dimensions.length;
  const getPoint = (index: number, value: number) => {
    const angle = (Math.PI * 2 * index) / n - Math.PI / 2;
    return { x: cx + r * value * Math.cos(angle), y: cy + r * value * Math.sin(angle) };
  };
  const pathData = dimensions.map((d, i) => {
    const p = getPoint(i, d.value);
    return `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`;
  }).join(' ') + ' Z';
  return (
    <svg viewBox="0 0 240 240" className="w-full max-w-[240px]">
      {[0.25, 0.5, 0.75, 1].map((level) => (
        <polygon key={level}
          points={dimensions.map((_, i) => { const p = getPoint(i, level); return `${p.x},${p.y}`; }).join(' ')}
          fill="none" stroke="#EBEBEF" strokeWidth="1" />
      ))}
      {dimensions.map((_, i) => { const p = getPoint(i, 1); return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#EBEBEF" strokeWidth="1" />; })}
      <path d={pathData} fill="rgba(255,107,91,0.12)" stroke={C.coral} strokeWidth="2" />
      {dimensions.map((d, i) => { const p = getPoint(i, d.value); return <circle key={i} cx={p.x} cy={p.y} r="4" fill={C.coral} stroke="#fff" strokeWidth="2" />; })}
      {dimensions.map((d, i) => { const p = getPoint(i, 1.22); return <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fill={C.textSub} fontSize="9">{d.label}</text>; })}
    </svg>
  );
}

function ComparisonChart() {
  return (
    <svg viewBox="0 0 280 120" className="w-full max-w-[280px]">
      <path d="M10,95 L50,85 L90,90 L130,80 L170,82 L210,75 L250,78 L270,72" fill="none" stroke="#D8DAE0" strokeWidth="2" strokeDasharray="4 3" />
      <path d="M10,78 L50,55 L90,50 L130,42 L170,38 L210,32 L250,28 L270,22" fill="none" stroke={C.coral} strokeWidth="2.5" />
      {[[10,78],[50,55],[90,50],[130,42],[170,38],[210,32],[250,28],[270,22]].map(([x,y], i) => (<circle key={i} cx={Number(x)} cy={Number(y)} r="3" fill={C.coral} />))}
      <text x="10" y="14" fill={C.textDim} fontSize="8">训练前</text>
      <circle cx="50" cy="11" r="3" fill="#D8DAE0" />
      <text x="160" y="14" fill={C.coral} fontSize="8">训练后</text>
      <circle cx="200" cy="11" r="3" fill={C.coral} />
    </svg>
  );
}

function SectionTitle({ title, subtitle, id }: { title: string; subtitle?: string; id?: string }) {
  return (
    <div className="text-center" id={id}>
      <h2 className="text-3xl font-bold leading-tight md:text-4xl" style={{ color: C.text }}>{title}</h2>
      {subtitle && <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed md:text-lg" style={{ color: C.textSub }}>{subtitle}</p>}
    </div>
  );
}

export default function App() {
  const location = useLocation();

  // 主页各 section 对应的 ID 列表
  const ANCHOR_IDS = ['hero', 'loop', 'tech', 'pillars', 'deliverables', 'about'];

  useEffect(() => {
    if (location.pathname === '/') {
      // 在根路由下，通过 hash 定位，如 #loop → 滚动到 id="loop"
      const id = location.hash.replace('#', '');
      if (id && ANCHOR_IDS.includes(id)) {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }
    } else if (ANCHOR_IDS.includes(location.pathname)) {
      // HashRouter 将 #loop 解析为 pathname=loop，通过 * 兜底回到此页后需手动滚动
      requestAnimationFrame(() => {
        const el = document.getElementById(location.pathname);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [location]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: C.bg, color: C.text }}>
      <Navbar />

      {/* ════════ 一、首屏 Hero ════════ */}
      <section id="hero" className="relative overflow-hidden px-6 pt-16 pb-20 md:pt-24 md:pb-28">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/4 top-0 h-[400px] w-[500px] -translate-x-1/2 rounded-full blur-[140px]" style={{ backgroundColor: 'rgba(255,107,91,0.06)' }} />
          <div className="absolute right-0 top-1/3 h-[300px] w-[400px] rounded-full blur-[120px]" style={{ backgroundColor: 'rgba(47,174,123,0.04)' }} />
        </div>
        <div className="relative mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] px-4 py-1.5 text-xs backdrop-blur-sm"
              style={{ backgroundColor: '#fff', color: C.textSub }}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: C.green }} />
              指导 · 示范 · 陪练 · 模拟 · 预测
            </div>
            <h1 className="mt-8 text-3xl font-black leading-tight tracking-tight md:text-5xl lg:text-[3.4rem]">
              实景训练，指标复盘，<br />改善可证，专家辅助。
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed md:text-lg" style={{ color: C.text }}>
              基于真实业务场景、可解释指标与专家辅助，构建销售能力可度量、可追溯、可持续改善的训练闭环。
            </p>
            <p className="mt-4 max-w-xl text-sm leading-relaxed italic" style={{ color: C.textDim }}>
              不止于陪练的销售能力训练。从"练过"走向"练成"，从经验判断走向数据验证。
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <a href="mailto:bd@grasp.chat?subject=预约演示"
                className="group inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-bold shadow-lg transition hover:scale-105"
                style={{ backgroundColor: C.coral, color: '#fff', boxShadow: '0 8px 22px -8px rgba(255,107,91,.45)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = C.coralDark; e.currentTarget.style.boxShadow = '0 10px 28px -8px rgba(255,107,91,.55)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = C.coral; e.currentTarget.style.boxShadow = '0 8px 22px -8px rgba(255,107,91,.45)'; }}>
                预约演示
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 transition group-hover:translate-x-0.5">
                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
              <a href="https://train.grasp.chat" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] px-7 py-3.5 text-base font-semibold transition hover:border-[var(--color-coral)] hover:text-[var(--color-coral)]"
                style={{ backgroundColor: '#fff', color: C.text }}>
                免费试用
              </a>
            </div>
          </div>
          <div className="hidden justify-center lg:flex">
            <div className="relative w-full max-w-[520px]">
              <div className="rounded-2xl border border-[var(--color-line)] p-6 shadow-[var(--shadow-card)]" style={{ backgroundColor: C.card }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: C.coral }} />
                    <span className="text-sm font-semibold" style={{ color: C.text }}>能力指标雷达图</span>
                  </div>
                  <span className="text-xs" style={{ color: C.textDim }}>前后对比曲线</span>
                </div>
                <div className="grid grid-cols-2 gap-4 items-center">
                  <RadarChart />
                  <ComparisonChart />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════ 二、AI时代的机会陈述 ════════ */}
      <section className="px-6 py-24" style={{ backgroundColor: '#fff' }}>
        <div className="mx-auto max-w-6xl">
          <SectionTitle
            title="AI时代，销售能力建设需要新的机制"
            subtitle="AI没有替代销售，而是让组织和个人的销售能力有更大提升空间、更快提升速度、更好用的提升工具。"
            id="ai-opportunity"
          />
          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: <IconSearch />, title: '提升空间更大', desc: 'AI可以拆解复杂销售能力，识别个人与团队的能力短板，让训练从通用内容转向针对性提升。', color: C.coral },
              { icon: <IconBolt />, title: '提升速度更快', desc: '通过高频实景训练、即时反馈与指标复盘，缩短从"知道"到"做到"的周期。', color: C.green },
              { icon: <IconTool />, title: '提升工具更好用', desc: '场景、内容、目标均可定制，训练工具更贴近真实业务，更容易嵌入日常销售管理。', color: C.coral },
              { icon: <IconAward />, title: '销冠经验更好传递', desc: '将销冠的判断、话术、应对策略转化为可训练场景与可解释指标，让个人经验成为组织能力。', color: C.green },
              { icon: <IconChart />, title: '能力提升可视化、数据化', desc: '训练进度、能力维度、前后对比、改善计划均可记录、可分析、可汇报。', color: C.coral },
            ].map((item, i) => (
              <div key={i}
                className="rounded-2xl border border-[var(--color-line)] p-7 transition hover:-translate-y-1 hover:shadow-[var(--shadow-card)]"
                style={{ backgroundColor: C.card }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = item.color === C.coral ? '#FFD9D2' : '#C8E8D8'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-line)'; }}>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ color: item.color }}>
                  {item.icon}
                </div>
                <h3 className="text-lg font-bold" style={{ color: C.text }}>{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: C.textSub }}>{item.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-12 text-center text-base italic" style={{ color: C.textDim }}>
            企业需要的并非更多课程，而是一套能够承载AI能力、又能落到真实业务中的训练机制。
          </p>
        </div>
      </section>

      {/* ════════ 三、主张与训练闭环 ════════ */}
      <section className="px-6 py-24" id="loop">
        <div className="mx-auto max-w-5xl">
          <SectionTitle
            title="可度量、可追溯、可改善的训练闭环"
            subtitle="基于真实业务场景开展训练，以可解释指标作为复盘依据，结合专家反馈形成改善方案，构建销售能力可度量、可追溯、可持续改善的训练闭环。"
          />
          {/* 五步闭环 */}
          <div className="mt-14 flex flex-col items-center gap-4 lg:flex-row lg:items-stretch lg:gap-0">
            {[
              { step: '01', title: '场景设定', desc: '明确训练场景、任务目标与能力要求', icon: <IconScene /> },
              { step: '02', title: '内容讲授', desc: '专家拆解能力维度与关键方法', icon: <IconDoc /> },
              { step: '03', title: '实景演练', desc: '在真实案例与真实业务场景中反复训练', icon: <IconExpert /> },
              { step: '04', title: '指标复盘', desc: '依据可解释指标定位问题、分析原因', icon: <IconMetric /> },
              { step: '05', title: '改善计划', desc: '基于复盘结果明确下一阶段训练重点', icon: <IconCheck /> },
            ].map((item, i) => (
              <div key={i} className="flex flex-1 flex-col items-center">
                <div className="relative w-full lg:h-full">
                  <div className="mx-auto max-w-[180px] rounded-2xl border border-[var(--color-line)] p-5 text-center shadow-[var(--shadow-card)] lg:h-full"
                    style={{ backgroundColor: C.card }}>
                    <div className="mb-3 text-xs font-bold tracking-widest" style={{ color: C.coral }}>{item.step}</div>
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl" style={{ backgroundColor: C.coralSoft, color: C.coral }}>
                      {item.icon}
                    </div>
                    <h4 className="text-base font-bold" style={{ color: C.text }}>{item.title}</h4>
                    <p className="mt-2 text-xs leading-relaxed" style={{ color: C.textDim }}>{item.desc}</p>
                  </div>
                </div>
                {i < 4 && (
                  <div className="my-3 lg:hidden" style={{ color: C.textDim }}>
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                      <path d="M12 5v14m-6-6 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
                {i < 4 && (
                  <div className="absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-1/2 lg:block" style={{ color: C.textDim }}>
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-10 text-center text-sm" style={{ color: C.textSub }}>
            场景明确，能力可量化，反馈有依据，改善可对比，进阶有计划。
          </p>
        </div>
      </section>

      {/* ════════ 四、四个支撑 ════════ */}

      {/* ════════ 五、技术底座 ════════ */}
      <section className="px-6 py-24" id="tech">
        <div className="mx-auto max-w-6xl">
          <SectionTitle
            title="技术底座"
            subtitle="以认知计算与模拟技术为底座，使训练场景可构建、训练对象可模拟、训练过程可解释、训练结果可验证。"
          />
          {/* 第一行 2 个、第二行 3 个；移动端每行 1 个 */}
          <div className="mt-14 flex flex-col items-center gap-4">
            <div className="flex w-full flex-col items-center gap-4 lg:flex-row lg:items-stretch lg:justify-center">
              {TECH_ITEMS.slice(0, 2).map((item, i) => (
                <TechCard key={i} item={item} index={i} />
              ))}
            </div>
            <div className="flex w-full flex-col items-center gap-4 lg:flex-row lg:items-stretch lg:justify-center">
              {TECH_ITEMS.slice(2).map((item, i) => (
                <TechCard key={i + 2} item={item} index={i + 2} />
              ))}
            </div>
          </div>
          <div className="mt-10 text-center">
            <a href="#/tech" className="inline-flex items-center gap-2 text-sm font-semibold transition hover:opacity-80" style={{ color: C.coral }}>
              了解技术详情
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* ════════ 六、交付与证据 ════════ */}
      <section className="px-6 py-24" style={{ backgroundColor: '#fff' }} id="deliverables">
        <div className="mx-auto max-w-5xl">
          <SectionTitle
            title="面向结果的交付物"
          />
          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              { title: '场景任务书', desc: '场景清晰', icon: <IconDoc color={C.coral} /> },
              { title: '能力指标表', desc: '能力可量化', icon: <IconChart /> },
              { title: '专家复盘记录', desc: '反馈有依据', icon: <IconExpert /> },
              { title: '前后对比报告', desc: '改善可对比', icon: <IconArrows /> },
              { title: '改善计划', desc: '进阶有计划', icon: <IconCheck /> },
            ].map((item, i) => (
              <div key={i}
                className="flex items-start gap-4 rounded-2xl border border-[var(--color-line)] p-6 transition hover:-translate-y-1 hover:shadow-[var(--shadow-card)]"
                style={{ backgroundColor: C.card }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#FFD9D2'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-line)'; }}>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ color: C.coral }}>
                  {item.icon}
                </div>
                <div>
                  <h3 className="text-lg font-bold" style={{ color: C.text }}>{item.title}</h3>
                  <p className="mt-1 text-sm" style={{ color: C.textSub }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-10 text-center text-base font-medium" style={{ color: C.coral }}>
            无场景不训练，无指标不复盘，无对比不结案，无计划不续训。
          </p>
        </div>
      </section>

      {/* ════════ 七、适用对象 ════════ */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <SectionTitle
            title="不同的用户，同样的价值"
          />
          <div className="mt-14 grid gap-8 lg:grid-cols-2">
            {/* 面向机构 */}
            <div className="rounded-2xl border border-[var(--color-line)] p-8 shadow-[var(--shadow-card)]" style={{ backgroundColor: C.card }}>
              <div className="mb-4 inline-flex rounded-full px-4 py-1.5 text-xs font-semibold" style={{ backgroundColor: C.coralSoft, color: C.coral }}>
                面向机构
              </div>
              <h3 className="text-xl font-bold" style={{ color: C.text }}>让销售能力建设从经验驱动走向有据可循、有径可改、有效可证。</h3>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: C.textSub }}>
                适合培训负责人、销售负责人与决策层：团队能力可度量、培训投入可交代、改善路径可复制。
              </p>
              <a href="https://train.grasp.chat" target="_blank" rel="noopener noreferrer"
                className="mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition hover:scale-105"
                style={{ backgroundColor: C.coral, color: '#fff' }}>
                免费试用
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
            {/* 开始训练 */}
            <div className="rounded-2xl border border-[var(--color-line)] p-8 shadow-[var(--shadow-card)]" style={{ backgroundColor: C.card }}>
              <div className="mb-4 inline-flex rounded-full px-4 py-1.5 text-xs font-semibold" style={{ backgroundColor: 'rgba(47,174,123,0.12)', color: C.green }}>
                开始训练
              </div>
              <h3 className="text-xl font-bold" style={{ color: C.text }}>在真实业务场景中训练，以清晰指标验证每一次进阶。</h3>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: C.textSub }}>
                适合销售从业者、转岗者与进阶者：在低风险环境中训练真实场景，以可解释反馈获得成长证据。
              </p>
              <a href="https://train.grasp.chat"
                className="mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition hover:scale-105"
                style={{ backgroundColor: C.green, color: '#fff' }}>
                开始训练
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ════════ 八、落地场景与案例 ════════ */}
      <section className="px-6 py-24" style={{ backgroundColor: '#fff' }}>
        <div className="mx-auto max-w-6xl">
          <SectionTitle
            title="落地场景与案例"
            subtitle="越早建立能力基线，越早形成可复制改善路径，越早实现AI赋能销售"
          />
          {/* 场景卡片 */}
          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {/* 教育培训机构 */}
            <div className="group rounded-2xl border border-[var(--color-line)] shadow-[var(--shadow-card)] overflow-hidden transition hover:-translate-y-1"
              style={{ backgroundColor: C.card }}>
              <div className="relative h-44 overflow-hidden">
                <img src="/weiqi.png" alt="教育培训机构" className="h-full w-full object-cover transition group-hover:scale-105" />
              </div>
              <div className="p-6">
                <h3 className="text-lg font-bold" style={{ color: C.text }}>教育培训机构</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: C.textSub }}>
                  学员模拟面对家长咨询、课程试听谈判、续费沟通等场景，AI扮演不同性格的家长角色，训练顾问的表达说服力和异议处理能力。
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['课程咨询模拟', '续费谈判训练', '家长异议应对'].map((tag) => (
                    <span key={tag} className="rounded-full px-3 py-1 text-xs" style={{ backgroundColor: C.coralSoft, color: C.coral }}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
            {/* 健身和体能训练机构 */}
            <div className="group rounded-2xl border border-[var(--color-line)] shadow-[var(--shadow-card)] overflow-hidden transition hover:-translate-y-1"
              style={{ backgroundColor: C.card }}>
              <div className="relative h-44 overflow-hidden">
                <img src="/sports.png" alt="健身和体能训练机构" className="h-full w-full object-cover transition group-hover:scale-105" />
              </div>
              <div className="p-6">
                <h3 className="text-lg font-bold" style={{ color: C.text }}>健身和体能训练机构</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: C.textSub }}>
                  销售人员面对潜在会员进行课程推荐、价格谈判和体验课转化，AI模拟不同健身需求的客户，提升私教顾问的成单能力。
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['会员需求挖掘', '价格谈判模拟', '体验课转化'].map((tag) => (
                    <span key={tag} className="rounded-full px-3 py-1 text-xs" style={{ backgroundColor: 'rgba(47,174,123,0.12)', color: C.green }}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
            {/* 反诈宣传 */}
            <div className="group rounded-2xl border border-[var(--color-line)] shadow-[var(--shadow-card)] overflow-hidden transition hover:-translate-y-1"
              style={{ backgroundColor: C.card }}>
              <div className="relative h-44 overflow-hidden">
                <img src="/anti-fraud.png" alt="反诈宣传" className="h-full w-full object-cover transition group-hover:scale-105" />
              </div>
              <div className="p-6">
                <h3 className="text-lg font-bold" style={{ color: C.text }}>反诈宣传</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: C.textSub }}>
                  警务人员与社区工作者在模拟对话中识别诈骗话术套路，AI扮演各类诈骗分子，训练工作人员的快速识别、劝阻和沟通能力。
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['诈骗话术识别', '劝阻沟通训练', '应急反应模拟'].map((tag) => (
                    <span key={tag} className="rounded-full px-3 py-1 text-xs" style={{ backgroundColor: C.coralSoft, color: C.coral }}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* 客户证言 */}
          <div className="mt-16 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--color-line)] p-7 shadow-[var(--shadow-card)]" style={{ backgroundColor: C.card }}>
              <svg viewBox="0 0 24 24" fill="none" className="mb-4 h-8 w-8" style={{ color: C.coral, opacity: 0.4 }}>
                <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" fill="currentColor" />
              </svg>
              <p className="text-sm leading-relaxed" style={{ color: C.text }}>
                "过去培训效果靠感觉，现在每个阶段都有指标和对比，下一步的规划和安排就更清楚。"
              </p>
              <p className="mt-4 text-xs" style={{ color: C.textDim }}>—— 某机构销售负责人</p>
            </div>
            <div className="rounded-2xl border border-[var(--color-line)] p-7 shadow-[var(--shadow-card)]" style={{ backgroundColor: C.card }}>
              <svg viewBox="0 0 24 24" fill="none" className="mb-4 h-8 w-8" style={{ color: C.green, opacity: 0.4 }}>
                <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" fill="currentColor" />
              </svg>
              <p className="text-sm leading-relaxed" style={{ color: C.text }}>
                "知道了自己差在哪个维度、为什么差、下一步练什么。"
              </p>
              <p className="mt-4 text-xs" style={{ color: C.textDim }}>—— 个人学员</p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════ 九、最终 CTA ════════ */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-black leading-tight md:text-4xl" style={{ color: C.text }}>
            从"练过"，到"练成"。
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed" style={{ color: C.textSub }}>
            预约一次演示，看看你的销售能力如何被度量、被解释、被改善。
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a href="mailto:bd@grasp.chat?subject=预约演示"
              className="rounded-full px-8 py-4 text-base font-bold shadow-lg transition hover:scale-105"
              style={{ backgroundColor: C.coral, color: '#fff' }}>
              预约演示
            </a>
            <a href="https://train.grasp.chat" target="_blank" rel="noopener noreferrer"
              className="rounded-full border px-7 py-3.5 text-base font-semibold transition"
              style={{ borderColor: C.line, backgroundColor: '#fff', color: C.text }}>
              免费试用
            </a>
          </div>
        </div>
      </section>

      {/* ════════ 十、页脚 ════════ */}
      <footer id="about" className="border-t px-6 py-16" style={{ borderColor: C.line, backgroundColor: '#fff' }}>
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
            {/* 品牌 */}
            <div className="lg:col-span-1">
              <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="Graspit" className="h-8 w-8 rounded-xl" />
                <span className="text-lg font-bold tracking-tight" style={{ color: C.coral }}>Graspit</span>
              </div>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: C.textSub }}>
                实景训练，指标复盘，改善可证，专家辅助。
              </p>
            </div>
            {/* 产品 */}
            <div>
              <h4 className="text-sm font-semibold" style={{ color: C.text }}>产品</h4>
              <ul className="mt-4 space-y-2.5 text-sm" style={{ color: C.textSub }}>
                <li><a href="#loop" className="transition hover:text-[var(--color-coral)]">带练</a></li>
                <li><a href="#tech" className="transition hover:text-[var(--color-coral)]">模拟推演</a></li>
              </ul>
            </div>
            {/* 解决方案 */}
            <div>
              <h4 className="text-sm font-semibold" style={{ color: C.text }}>解决方案</h4>
              <ul className="mt-4 space-y-2.5 text-sm" style={{ color: C.textSub }}>
                <li><a href="#pillars" className="transition hover:text-[var(--color-coral)]">线下门店</a></li>
                <li><a href="#deliverables" className="transition hover:text-[var(--color-coral)]">企业单位</a></li>
              </ul>
            </div>
            {/* 技术 */}
            <div>
              <h4 className="text-sm font-semibold" style={{ color: C.text }}>技术</h4>
              <ul className="mt-4 space-y-2.5 text-sm" style={{ color: C.textSub }}>
                <li><a href="#tech" className="transition hover:text-[var(--color-coral)]">认知计算</a></li>
                <li><a href="#tech" className="transition hover:text-[var(--color-coral)]">情感计算</a></li>
                <li><a href="#tech" className="transition hover:text-[var(--color-coral)]">主体性计算</a></li>
                <li><a href="#tech" className="transition hover:text-[var(--color-coral)]">场景模拟</a></li>
              </ul>
            </div>
            {/* 资源 + 关于我们 */}
            <div>
              <h4 className="text-sm font-semibold" style={{ color: C.text }}>资源</h4>
              <ul className="mt-4 space-y-2.5 text-sm" style={{ color: C.textSub }}>
                <li><a href="#deliverables" className="transition hover:text-[var(--color-coral)]">产品白皮书</a></li>
                <li><a href="#tech" className="transition hover:text-[var(--color-coral)]">技术文档</a></li>
                <li><a href="#about" className="transition hover:text-[var(--color-coral)]">社媒</a></li>
              </ul>
              <h4 className="mt-6 text-sm font-semibold" style={{ color: C.text }}>关于我们</h4>
              <ul className="mt-4 space-y-2.5 text-sm" style={{ color: C.textSub }}>
                <li><a href="mailto:bd@grasp.chat" className="transition hover:text-[var(--color-coral)]">联系我们</a></li>
              </ul>
            </div>
          </div>
          {/* 联系方式 */}
          <div className="mt-12 border-t pt-8" style={{ borderColor: C.line }}>
            <div className="flex flex-col items-center gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-col items-center gap-4 md:items-start">
                <span className="text-sm font-medium" style={{ color: C.text }}>关注我们</span>
                <div className="flex gap-5">
                  <div className="flex flex-col items-center gap-1.5">
                    <img src="/qrcode_grasp.jpg" alt="公众号" className="h-20 w-20 rounded-lg border border-[var(--color-line)]" />
                    <span className="text-xs" style={{ color: C.textDim }}>公众号</span>
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <img src="/douyin_qrcode.jpg" alt="抖音" className="h-20 w-20 rounded-lg border border-[var(--color-line)]" />
                    <span className="text-xs" style={{ color: C.textDim }}>抖音</span>
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <img src="/xiaohongshu_qrcode.jpg" alt="小红书" className="h-20 w-20 rounded-lg border border-[var(--color-line)]" />
                    <span className="text-xs" style={{ color: C.textDim }}>小红书</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-1 text-sm md:items-end">
                <span style={{ color: C.textSub }}>联系我们：bd@grasp.chat</span>
              </div>
            </div>
          </div>
          {/* 底栏 */}
          <div className="mt-8 border-t pt-6 flex flex-col items-center justify-between gap-3 text-xs sm:flex-row" style={{ borderColor: C.line, color: C.textDim }}>
            <span>&copy; 2026 Graspit. All rights reserved.</span>
            <span>京ICP备2025130300号-6</span>
          </div>
        </div>
      </footer>
    </div>
  );
}