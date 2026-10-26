import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchGrowth } from '../api';
import type { GrowthData } from '../types';

// 徽章数据
const BADGES = [
  { icon: '🎯', name: '首次练习', unlocked: true },
  { icon: '🔥', name: '连续 7 天', unlocked: true },
  { icon: '📞', name: '通话 10 场', unlocked: true },
  { icon: '🌙', name: '深夜练习', unlocked: true },
  { icon: '🛡️', name: '异议突破 80 分', unlocked: false },
  { icon: '👑', name: '满分王者', unlocked: false },
  { icon: '🎓', name: '构建大师', unlocked: false },
  { icon: '🏆', name: '排行榜前三', unlocked: false },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<GrowthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');

  useEffect(() => {
    fetchGrowth()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  // 计算概览数据
  const totalSessions = data.sessions.length;
  const avgScore = totalSessions > 0
    ? Math.round(data.sessions.reduce((sum, s) => sum + s.totalScore, 0) / totalSessions)
    : 0;
  const totalHours = 6.5;
  const streakDays = 6;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink">能力看板</h1>
        <div className="flex items-center gap-1 bg-white rounded-xl p-0.5 border border-gray-100">
          {(['7', '30', '90'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                period === p ? 'bg-coral text-white shadow-sm' : 'text-ink-secondary hover:bg-gray-50'
              }`}
            >
              {p}天
            </button>
          ))}
        </div>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-6 max-md:grid-cols-2">
        <StatCard
          label="能力总分"
          value={String(avgScore)}
          unit="分"
          color="coral"
          sub={`↑ 较上${period}天 +5`}
          subColor="text-success"
        />
        <StatCard
          label="本周练习"
          value={String(Math.min(totalSessions, 9))}
          unit="次"
          color="blue"
          sub="目标 10 次"
          subColor="text-ink-secondary"
        />
        <StatCard
          label="累计时长"
          value={String(totalHours)}
          unit="小时"
          color="green"
          sub={`共 ${totalSessions} 场`}
          subColor="text-ink-secondary"
        />
        <StatCard
          label="连续练习"
          value={String(streakDays)}
          unit="天"
          color="amber"
          sub="最长纪录 12 天"
          subColor="text-ink-secondary"
        />
      </div>

      {/* 多维能力分析 */}
      <SectionTitle icon="🕸" title="多维能力分析" subtitle={`近 ${period} 天 · 全部模式`} />
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
        <div className="grid grid-cols-[320px_1fr] gap-6 items-center max-lg:grid-cols-1">
          {/* 雷达图 */}
          <RadarChart skills={data.skills} />
          {/* 维度列表 */}
          <div className="space-y-2">
            {data.skills.slice(0, 6).map((skill, idx) => {
              const isWeak = skill.currentLevel <= 1;
              const trends = ['上升', '小幅提升', '下滑', '持平偏上', '稳步上升', '优势维度'];
              return (
                <div key={skill.skillPointId} className="flex items-center gap-3 py-2 border-b border-dashed border-gray-100 last:border-0">
                  <span className="w-16 text-sm font-semibold text-ink">{skill.name}</span>
                  <span className={`w-8 text-sm font-din font-bold ${isWeak ? 'text-coral' : 'text-ink'}`}>
                    {skill.score || Math.round(skill.currentLevel * 25 + 25)}
                  </span>
                  {/* Mini trend sparkline */}
                  <MiniTrend up={idx % 3 !== 1} />
                  <span className={`text-xs ml-auto ${idx === 2 ? 'text-coral' : 'text-success'}`}>
                    {trends[idx]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 专项能力训练 */}
      <SectionTitle icon="🎯" title="专项能力训练" subtitle="针对最弱维度推荐场景" />
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
        {data.skills.filter((s) => s.currentLevel <= 1).slice(0, 2).map((skill) => {
          const score = skill.score || Math.round(skill.currentLevel * 25 + 25);
          return (
            <div key={skill.skillPointId} className="mb-6 last:mb-0 pb-6 last:pb-0 border-b border-gray-50 last:border-0">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-ink">{skill.name}</span>
                  <span className="px-2 py-0.5 bg-coral/10 text-coral text-xs rounded-full">{score} 分 · 待提升</span>
                </div>
              </div>
              <p className="text-sm text-ink-secondary mb-4">
                {skill.name === '异议处理'
                  ? '诊断：被「竞品更便宜」类对比带偏节奏，倾向先解释价格而不是先认可再重构价值。'
                  : '诊断：能识别信号，但常错过最佳时机。'}
              </p>
              <div className="flex gap-3 flex-wrap">
                <MiniScenarioCard
                  category="客户主动咨询"
                  categoryColor="cat-ground"
                  name="客户拿着竞品方案来比价"
                  onClick={() => navigate('/practice/new')}
                />
                <MiniScenarioCard
                  category="电话销售"
                  categoryColor="coral"
                  name="向谨慎的采购总监报价"
                  onClick={() => navigate('/practice/new')}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 练习热力 */}
      <SectionTitle icon="🗓" title="练习热力" subtitle="近 12 周" />
      <div className="bg-white rounded-2xl shadow-sm p-5 mb-6">
        <Heatmap />
        <div className="flex items-center gap-2 text-xs text-ink-secondary mt-3">
          少
          <i className="w-3 h-3 rounded-sm bg-gray-100" />
          <i className="w-3 h-3 rounded-sm" style={{ background: '#FFDDD7' }} />
          <i className="w-3 h-3 rounded-sm" style={{ background: '#FFB3A8' }} />
          <i className="w-3 h-3 rounded-sm" style={{ background: '#FF8A7B' }} />
          <i className="w-3 h-3 rounded-sm bg-coral" />
          多
        </div>
      </div>

      {/* 成长里程碑 */}
      <SectionTitle icon="🏅" title="成长里程碑" subtitle={`已解锁 ${BADGES.filter((b) => b.unlocked).length} / ${BADGES.length}`} />
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
        <div className="flex gap-6 flex-wrap justify-center">
          {BADGES.map((badge) => (
            <div key={badge.name} className={`flex flex-col items-center gap-2 w-20 ${!badge.unlocked ? 'opacity-50 grayscale' : ''}`}>
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl ${
                badge.unlocked
                  ? 'bg-coral-light border-2 border-coral'
                  : 'bg-gray-50 border-2 border-gray-200'
              }`}>
                {badge.icon}
              </div>
              <span className="text-[11px] text-ink-secondary text-center">{badge.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 场景类别表现 */}
      <SectionTitle icon="📊" title="场景类别平均分" />
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <div className="flex items-end gap-6 h-40 justify-center">
          {[
            { name: '电话销售', score: 78, color: 'bg-cat-phone' },
            { name: '客户咨询', score: 82, color: 'bg-cat-inquiry' },
            { name: '成交谈判', score: 65, color: 'bg-cat-deal' },
            { name: '地推破冰', score: 74, color: 'bg-cat-ground' },
          ].map((cat) => (
            <div key={cat.name} className="flex flex-col items-center gap-2">
              <span className="text-xs font-din font-bold text-ink">{cat.score}</span>
              <div className={`w-14 rounded-xl ${cat.color} transition-all`} style={{ height: `${(cat.score / 100) * 120}px` }} />
              <span className="text-[11px] text-ink-secondary">{cat.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== 子组件 =====

function StatCard({ label, value, unit, color, sub, subColor }: {
  label: string; value: string; unit: string; color: string; sub: string; subColor: string;
}) {
  const colorMap: Record<string, string> = {
    coral: 'from-coral/10 to-coral/5 border-coral/20',
    blue: 'from-cat-ground/10 to-cat-ground/5 border-cat-ground/20',
    green: 'from-success/10 to-success/5 border-success/20',
    amber: 'from-warning/10 to-warning/5 border-warning/20',
  };
  const textColorMap: Record<string, string> = {
    coral: 'text-coral', blue: 'text-cat-ground', green: 'text-success', amber: 'text-warning',
  };

  return (
    <div className={`bg-gradient-to-br ${colorMap[color]} border rounded-2xl p-5`}>
      <p className="text-xs text-ink-secondary mb-2">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`text-3xl font-din font-bold ${textColorMap[color]}`}>{value}</span>
        <span className="text-sm text-ink-secondary">{unit}</span>
      </div>
      <p className={`text-xs mt-1 ${subColor}`}>{sub}</p>
    </div>
  );
}

function SectionTitle({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-bold text-ink flex items-center gap-2">
        <span>{icon}</span> {title}
      </h2>
      {subtitle && <span className="text-xs text-ink-secondary">{subtitle}</span>}
    </div>
  );
}

function RadarChart({ skills }: { skills: GrowthData['skills'] }) {
  const size = 220;
  const center = size / 2;
  const maxRadius = 80;

  if (skills.length === 0) return null;

  const points = skills.slice(0, 6);
  const angleStep = (2 * Math.PI) / points.length;

  return (
    <div className="flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* 网格 */}
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <polygon
            key={ratio}
            fill="none"
            stroke="#e5e2de"
            strokeWidth="1"
            points={points.map((_, i) => {
              const angle = angleStep * i - Math.PI / 2;
              const r = maxRadius * ratio;
              return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
            }).join(' ')}
          />
        ))}
        {/* 轴线 */}
        {points.map((_, i) => {
          const angle = angleStep * i - Math.PI / 2;
          return (
            <line key={i} x1={center} y1={center}
              x2={center + maxRadius * Math.cos(angle)}
              y2={center + maxRadius * Math.sin(angle)}
              stroke="#e5e2de" strokeWidth="1" />
          );
        })}
        {/* 数据区域 */}
        <polygon
          fill="rgba(255, 111, 97, 0.15)"
          stroke="#FF6F61"
          strokeWidth="2"
          points={points.map((s, i) => {
            const angle = angleStep * i - Math.PI / 2;
            const r = maxRadius * (s.currentLevel / 3);
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
          }).join(' ')}
        />
        {/* 数据点 */}
        {points.map((s, i) => {
          const angle = angleStep * i - Math.PI / 2;
          const r = maxRadius * (s.currentLevel / 3);
          return (
            <circle key={i}
              cx={center + r * Math.cos(angle)}
              cy={center + r * Math.sin(angle)}
              r="4" fill="#FF6F61" />
          );
        })}
        {/* 标签 */}
        {points.map((s, i) => {
          const angle = angleStep * i - Math.PI / 2;
          const labelR = maxRadius + 24;
          const isWeak = s.currentLevel <= 1;
          return (
            <text key={i}
              x={center + labelR * Math.cos(angle)}
              y={center + labelR * Math.sin(angle)}
              textAnchor="middle" dominantBaseline="middle"
              fontSize="10"
              fill={isWeak ? '#FF6F61' : '#8A8580'}
              fontWeight={isWeak ? '700' : '400'}
            >
              {s.name}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function MiniTrend({ up }: { up: boolean }) {
  const points = up
    ? '0,18 12,14 24,15 36,9 48,10 60,5'
    : '0,5 12,10 24,9 36,12 48,15 60,18';
  return (
    <svg width="60" height="24">
      <polyline points={points} fill="none" stroke={up ? '#2FB67C' : '#FF6F61'} strokeWidth="2" />
    </svg>
  );
}

function MiniScenarioCard({ category, categoryColor, name, onClick }: {
  category: string; categoryColor: string; name: string; onClick: () => void;
}) {
  return (
    <div className="flex-1 min-w-[200px] border border-gray-100 rounded-xl p-3 flex flex-col gap-1">
      <span className={`px-2 py-0.5 bg-${categoryColor}/10 text-${categoryColor} text-xs rounded-full w-fit font-medium`}>{category}</span>
      <span className="font-medium text-sm text-ink mt-1">{name}</span>
      <button
        onClick={onClick}
        className="mt-2 px-3 py-1 bg-coral text-white text-xs rounded-lg font-medium w-fit hover:bg-coral-hover transition-colors"
      >
        去训练
      </button>
    </div>
  );
}

function Heatmap() {
  // 生成 12 周 x 7 天的热力数据
  const data: number[] = [];
  for (let i = 0; i < 84; i++) {
    data.push(Math.random());
  }

  return (
    <div className="flex gap-1 overflow-x-auto pb-2">
      {Array.from({ length: 12 }).map((_, week) => (
        <div key={week} className="flex flex-col gap-1">
          {Array.from({ length: 7 }).map((_, day) => {
            const r = data[week * 7 + day];
            let cls = 'bg-gray-100';
            if (r > 0.86) cls = 'bg-coral';
            else if (r > 0.7) cls = '';
            else if (r > 0.52) cls = '';
            else if (r > 0.36) cls = '';
            const colors = ['', '', '', 'bg-coral', 'bg-coral', 'bg-coral'];
            const bgColors = [
              'bg-gray-100',
              '#FFDDD7',
              '#FFB3A8',
              '#FF8A7B',
              '#FF6B5B',
              '#FF6F61',
            ];
            let bg = bgColors[0];
            if (r > 0.86) bg = bgColors[5];
            else if (r > 0.7) bg = bgColors[4];
            else if (r > 0.52) bg = bgColors[3];
            else if (r > 0.36) bg = bgColors[2];

            return (
              <div
                key={day}
                className="w-3.5 h-3.5 rounded-sm"
                style={{ background: bg }}
                title={`周${week + 1} 周${day + 1}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
