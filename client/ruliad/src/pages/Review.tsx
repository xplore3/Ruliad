import { useParams, useNavigate } from 'react-router-dom';

const SCORE = 76;
const PREV_SCORE = 68;
const GRADE: string = 'B';

const STAGES = [
  { name: '开场破冰', score: 85, color: 'bg-success', note: '用行业新闻开场，10 秒内建立相关性。' },
  { name: '需求挖掘', score: 72, color: 'bg-warning', note: '问出停机损失是好问题，但未追问决策链。' },
  { name: '价值呈现', score: 88, color: 'bg-success', note: '「响应时效 vs 停机损失」的量化类价比价有效。' },
  { name: '异议处理', score: 58, color: 'bg-coral', note: '面对压价先解释了 40 秒价格构成，应先认可再重构价值。' },
  { name: '推进成交', score: 70, color: 'bg-warning', note: '抓住了「写进合同」的信号，但未顺势约定二次面谈时间。' },
];

const METRICS = [
  { label: '情绪稳定', value: '82', unit: '', feedback: '被压价时语气平稳 ✓', ok: true },
  { label: '语速', value: '156', unit: 'WPM', feedback: '目标 140–170 ✓', ok: true },
  { label: '填充词', value: '7', unit: '次', feedback: '「那个」「嗯」偏多 ⚠', ok: false },
  { label: '倾听占比', value: '38', unit: '%', feedback: '建议提升到 45% ⚠', ok: false },
];

const DIMENSIONS = [
  { name: '需求挖掘', score: 72, feedback: '多问一句「谁还参与决策」' },
  { name: '价值表达', score: 88, feedback: '保持量化类比打法' },
  { name: '异议处理', score: 58, feedback: '先认可情绪，再重构价值，最后给证据', isWeak: true },
  { name: '推进成交', score: 70, feedback: '识别承诺信号后立即约下一步' },
  { name: '倾听共情', score: 74, feedback: '对方说完停 1 秒再接话' },
  { name: '表达清晰', score: 85, feedback: '减少填充词即可上 90' },
];

const RECOMMENDED_SCENARIOS = [
  { category: '客户主动咨询', categoryColor: 'cat-ground', name: '客户拿着竞品方案来比价', desc: '不诋毁竞品的对比表达 · 进阶' },
  { category: '电话销售', categoryColor: 'coral', name: '向谨慎的采购总监报价', desc: '压价场景专项 · 进阶' },
];

const KEY_CLIP = {
  yourLine: '王总，我们这个价格确实不是最低的，但是我们的故障响应是 2 小时到场，行业里普遍是隔天……',
  problem: '被「竞品更便宜」带偏了节奏，先解释价格构成。应该先认可对方处境（价格敏感是合理的），重构价值而不是辩护价格。',
  better: '王总您顾虑价格我完全理解，很多制造业客户最早也这样想。不过后来他们算了一笔账——我们 2 小时到场和隔天响应的差距，一次停机就覆盖了采购差价。',
};

export default function Review() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const scoreDiff = SCORE - PREV_SCORE;
  const gradeColor = GRADE === 'S' || GRADE === 'A' ? 'text-success' : GRADE === 'B' || GRADE === 'C' ? 'text-warning' : 'text-coral';

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* 返回顶部栏 */}
      <header className="h-12 bg-dark-bg border-b border-white/6 flex items-center px-4 sticky top-0 z-40">
        <button
          onClick={() => navigate('/profile')}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          返回记录
        </button>
        <span className="ml-auto px-2.5 py-1 bg-success/15 text-success text-xs rounded-full font-medium">报告已生成</span>
      </header>

      <div className="max-w-[640px] mx-auto px-4 py-6">
        {/* 总分头部 */}
        <div className="bg-dark-card rounded-2xl p-5 mb-5 border border-white/5">
          <div className="flex items-center gap-5">
            {/* 环形进度 */}
            <div className="relative w-[110px] h-[110px] shrink-0">
              <svg width="110" height="110" viewBox="0 0 110 110">
                <defs>
                  <linearGradient id="scoreGradDark" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#E85C62" />
                    <stop offset="100%" stopColor="#F5A623" />
                  </linearGradient>
                </defs>
                <circle cx="55" cy="55" r="44" fill="none" stroke="#323742" strokeWidth="8" />
                <circle
                  cx="55" cy="55" r="44"
                  fill="none"
                  stroke="url(#scoreGradDark)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(SCORE / 100) * 276.5} 276.5`}
                  transform="rotate(-90 55 55)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-din font-bold text-text-primary">{SCORE}</span>
                <span className="text-[10px] text-text-tertiary">本次得分</span>
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-base font-bold text-text-primary">本次练习 {SCORE} 分</span>
                <span className={`text-xs font-semibold ${scoreDiff > 0 ? 'text-success' : 'text-coral'}`}>
                  {scoreDiff > 0 ? `↑${scoreDiff}` : '持平'} 较上次
                </span>
                <span className={`text-xs font-din font-bold ${gradeColor}`}>评级 {GRADE}</span>
              </div>
              <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">
                价值表达有亮点——停机成本类比打得准；但异议处理被「竞品便宜 20%」带偏了节奏。
              </p>
              <p className="text-[11px] text-text-tertiary mt-1.5">王建国 · 电话销售 · 📞 通话模式 · 今天 14:32 · 用时 8 分 24 秒</p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => navigate('/practice/new')}
              className="px-4 py-2 bg-coral text-white rounded-full text-xs font-medium hover:bg-coral-hover transition-colors"
            >
              再练一次
            </button>
            <button className="px-4 py-2 bg-dark-panel text-text-secondary rounded-full text-xs hover:bg-dark-elevated transition-colors">
              ↺ 回放
            </button>
          </div>
        </div>

        {/* 过程阶段拆解 */}
        <SectionTitle title="过程阶段拆解" />
        <div className="bg-dark-card rounded-2xl p-4 mb-5 border border-white/5">
          {STAGES.map((stage) => (
            <div key={stage.name} className="mb-3 last:mb-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-text-primary w-16 shrink-0">{stage.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-dark-panel overflow-hidden">
                  <div className={`h-full rounded-full ${stage.color}`} style={{ width: `${stage.score}%` }} />
                </div>
                <span className={`text-xs font-din font-bold w-8 text-right ${stage.color.replace('bg-', 'text-')}`}>{stage.score}</span>
              </div>
              <p className="text-[11px] text-text-tertiary mt-1 ml-[calc(4rem+12px)]">{stage.note}</p>
            </div>
          ))}
        </div>

        {/* 状态维度 */}
        <SectionTitle title="状态维度" />
        <div className="grid grid-cols-4 gap-2 mb-5">
          {METRICS.map((m) => (
            <div key={m.label} className="bg-dark-card rounded-xl p-3 text-center border border-white/5">
              <div className="text-[10px] text-text-tertiary mb-0.5">{m.label}</div>
              <div className="text-lg font-din font-bold text-text-primary">
                {m.value}<small className="text-[10px] text-text-tertiary ml-0.5">{m.unit}</small>
              </div>
              <div className={`text-[10px] mt-0.5 ${m.ok ? 'text-success' : 'text-warning'}`}>{m.feedback}</div>
            </div>
          ))}
        </div>

        {/* 表现维度 */}
        <SectionTitle title="表现维度" />
        <div className="bg-dark-card rounded-2xl p-4 mb-5 border border-white/5">
          <div className="grid grid-cols-[180px_1fr] gap-4 items-center">
            {/* 雷达图 */}
            <div className="flex items-center justify-center">
              <svg width="170" height="170" viewBox="0 0 170 170">
                {[1, 2, 3].map((level) => (
                  <polygon
                    key={level}
                    fill="none"
                    stroke="#323742"
                    points={getHexPoints(85, 85, 70 - level * 16).map((p) => `${p.x},${p.y}`).join(' ')}
                  />
                ))}
                {getHexPoints(85, 85, 70).map((p, i) => (
                  <line key={i} x1="85" y1="85" x2={p.x} y2={p.y} stroke="#323742" />
                ))}
                <polygon
                  fill="rgba(232,92,98,0.15)"
                  stroke="#E85C62"
                  strokeWidth="2"
                  points={getHexDataPoints(85, 85, 70, DIMENSIONS.map((d) => d.score / 100)).map((p) => `${p.x},${p.y}`).join(' ')}
                />
              </svg>
            </div>
            {/* 维度列表 */}
            <div className="space-y-2.5">
              {DIMENSIONS.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className={`w-7 text-right text-xs font-din font-bold ${d.isWeak ? 'text-coral' : 'text-text-primary'}`}>{d.score}</span>
                  <span className={`text-xs flex-1 ${d.isWeak ? 'text-coral font-medium' : 'text-text-primary'}`}>{d.name}</span>
                  <span className="text-[11px] text-text-tertiary truncate max-w-[140px]">{d.feedback}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 关键片段点评 */}
        <SectionTitle title="关键片段点评" />
        <div className="bg-dark-card rounded-2xl p-4 mb-5 space-y-3 border border-white/5">
          <QuoteBlock title="你说的话" content={KEY_CLIP.yourLine} type="quote" />
          <QuoteBlock title="AI 点评" content={KEY_CLIP.problem} type="problem" />
          <QuoteBlock title="推荐说法" content={KEY_CLIP.better} type="better" />
          <div className="flex items-center gap-2 pt-1">
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-coral/15 text-coral text-xs rounded-lg font-medium hover:bg-coral/25 transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              播放该片段
            </button>
          </div>
        </div>

        {/* 改进建议 */}
        <SectionTitle title="下一步" />
        <div className="bg-dark-card rounded-2xl p-4 mb-5 border border-white/5">
          <p className="text-xs text-text-secondary mb-3">
            薄弱维度 <span className="text-coral font-semibold">异议处理 58 分</span>，推荐针对性训练：
          </p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {RECOMMENDED_SCENARIOS.map((s) => (
              <div key={s.name} className="bg-dark-panel rounded-xl p-3 border border-white/5">
                <span className={`px-2 py-0.5 bg-${s.categoryColor}/15 text-${s.categoryColor} text-[11px] rounded-full font-medium`}>{s.category}</span>
                <h4 className="text-xs font-medium text-text-primary mt-1.5">{s.name}</h4>
                <p className="text-[11px] text-text-tertiary mt-0.5">{s.desc}</p>
                <button
                  onClick={() => navigate('/practice/new')}
                  className="mt-2 px-3 py-1 bg-coral text-white text-[11px] rounded-lg font-medium hover:bg-coral-hover transition-colors"
                >
                  去练习
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="px-3 py-1.5 bg-dark-panel text-text-secondary text-xs rounded-full hover:bg-dark-elevated transition-colors">
              查看完整回放
            </button>
            <button
              onClick={() => navigate('/practice/new')}
              className="px-3 py-1.5 bg-dark-panel text-text-secondary text-xs rounded-full hover:bg-dark-elevated transition-colors"
            >
              再练一次
            </button>
            <button className="px-3 py-1.5 bg-dark-panel text-text-secondary text-xs rounded-full hover:bg-dark-elevated transition-colors">
              分享报告
            </button>
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between pb-6">
          <button
            onClick={() => navigate('/home')}
            className="px-4 py-2 bg-dark-panel text-text-secondary text-xs rounded-full hover:bg-dark-elevated transition-colors"
          >
            返回首页
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 bg-coral/15 text-coral text-xs rounded-full font-medium hover:bg-coral/25 transition-colors"
          >
            查看能力看板
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h3 className="text-text-primary text-sm font-semibold mb-2">{title}</h3>
  );
}

function QuoteBlock({ title, content, type }: { title: string; content: string; type: 'quote' | 'problem' | 'better' }) {
  const styles = {
    quote: 'bg-dark-panel border-l-coral',
    problem: 'bg-coral/8 border-l-coral',
    better: 'bg-success/8 border-l-success',
  };
  const titleColors = {
    quote: 'text-text-secondary',
    problem: 'text-coral',
    better: 'text-success',
  };

  return (
    <div className={`border-l-4 pl-3 py-2 pr-3 rounded-r-xl ${styles[type]}`}>
      <div className={`text-[11px] font-medium mb-1 ${titleColors[type]}`}>{title}</div>
      <p className="text-xs text-text-primary leading-relaxed">{content}</p>
    </div>
  );
}

function getHexPoints(cx: number, cy: number, r: number) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return points;
}

function getHexDataPoints(cx: number, cy: number, r: number, values: number[]) {
  return values.map((v, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    return { x: cx + r * v * Math.cos(angle), y: cy + r * v * Math.sin(angle) };
  });
}
