import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { usePageTrack } from '../track';
import type { RoleCard, Scenario, ScenariosResponse } from '../types';

/** 陪练员头像（本地中国人形象照片，按性格选择） */
const AVATAR_MAP: Record<string, string> = {
  '林知夏': '/avatars/woman-1.jpg',
  '陈一鸣': '/avatars/man-1.jpg',
  '周思远': '/avatars/man-3.jpg',
};

function avatarUrl(name: string): string {
  return AVATAR_MAP[name] ?? '/avatars/woman-2.jpg';
}

const DEMO_CARDS: RoleCard[] = [
  {
    id: 'demo-1',
    name: '林知夏',
    title: '采购总监 · 企业软件',
    tags: ['预算敏感', '理性谨慎'],
    target: '用价值回应价格异议',
    source: '案例库 v1',
    difficulty: '高压',
    industry: '企业软件',
    role: '采购',
    avatar: avatarUrl('林知夏'),
  },
  {
    id: 'demo-2',
    name: '陈一鸣',
    title: '技术负责人 · 金融科技',
    tags: ['技术深度', '效率优先'],
    target: '从技术债切入推动决策',
    source: '案例库 v1',
    difficulty: '进阶',
    industry: '金融',
    role: '负责人',
    avatar: avatarUrl('陈一鸣'),
  },
  {
    id: 'demo-3',
    name: '周思远',
    title: '运营总监 · 电商',
    tags: ['增长导向', '数据驱动'],
    target: '用 ROI 证明投入回报',
    source: '案例库 v1',
    difficulty: '进阶',
    industry: '企业软件',
    role: '使用者',
    avatar: avatarUrl('周思远'),
  },
];

/** 滑动阈值：拖拽超过此距离则判定为滑走 */
const SWIPE_THRESHOLD = 80;

export default function Home() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<RoleCard[]>(DEMO_CARDS);
  const [index, setIndex] = useState(0);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const [exiting, setExiting] = useState<'left' | 'right' | null>(null);
  const [hintVisible, setHintVisible] = useState(true);
  const startRef = useRef({ x: 0, y: 0 });
  usePageTrack('/');

  useEffect(() => {
    api.get<ScenariosResponse>('/scenarios').then((res) => {
      setScenarios(res.data.scenarios);
    }).catch(() => {});

    api.get<{ cards: RoleCard[] }>('/role-cards').then((res) => {
      if (res.data.cards && res.data.cards.length > 0) {
        setCards(res.data.cards);
      }
    }).catch(() => {});
  }, []);

  // 自动隐藏滑动手势提示
  useEffect(() => {
    if (!hintVisible) return;
    const timer = setTimeout(() => setHintVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [hintVisible]);

  const current = cards[index];
  const next = cards[index + 1];

  const goPractice = () => {
    if (!current) return;
    const scenario = scenarios.find((s) => s.id === current.id);
    if (scenario) {
      navigate(`/mode/${scenario.id}`);
    } else if (current.scenarioId) {
      navigate(`/mode/${current.scenarioId}`);
    } else {
      navigate(`/role/${current.id}`);
    }
  };

  // 左滑：下一张卡片
  const goNext = () => {
    if (index >= cards.length - 1) return;
    setExiting('left');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIndex((i) => Math.min(i + 1, cards.length - 1));
        setExiting(null);
        setDrag({ dx: 0, dy: 0, active: false });
      });
    });
  };

  // 右滑：上一张卡片
  const goPrev = () => {
    if (index <= 0) return;
    setExiting('right');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIndex((i) => Math.max(0, i - 1));
        setExiting(null);
        setDrag({ dx: 0, dy: 0, active: false });
      });
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (exiting || !current) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, dy: 0, active: true });
    if (hintVisible) setHintVisible(false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.active || exiting) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    setDrag({ dx, dy, active: true });
  };

  const onPointerUp = () => {
    if (!drag.active || exiting) return;
    const { dx } = drag;
    if (dx > SWIPE_THRESHOLD) {
      // 右滑 → 上一张
      goPrev();
    } else if (dx < -SWIPE_THRESHOLD) {
      // 左滑 → 下一张
      goNext();
    } else {
      setDrag({ dx: 0, dy: 0, active: false });
    }
  };

  const cardStyle = exiting
    ? exiting === 'left'
      ? { transform: `translateX(-200vw) rotate(-30deg)`, opacity: 0, transition: 'transform 0.3s ease-in, opacity 0.2s ease-out', willChange: 'transform, opacity' }
      : { transform: `translateX(200vw) rotate(30deg)`, opacity: 0, transition: 'transform 0.3s ease-in, opacity 0.2s ease-out', willChange: 'transform, opacity' }
    : drag.active
      ? { transform: `translateX(${drag.dx}px) translateY(${drag.dy * 0.3}px) rotate(${drag.dx * 0.05}deg)`, willChange: 'transform' }
      : { transform: 'translateX(0) rotate(0)' };

  const nextCardStyle = exiting === 'left'
    ? { transform: 'scale(1)', opacity: 1, transition: 'transform 0.3s ease-in, opacity 0.3s ease-in', willChange: 'transform, opacity' }
    : { transform: 'scale(0.95)', opacity: 0.6, transition: 'none' };

  const prevOpacity = Math.max(0, Math.min(1, drag.dx / SWIPE_THRESHOLD));
  const nextOpacity = Math.max(0, Math.min(1, -drag.dx / SWIPE_THRESHOLD));

  return (
    <div className="flex flex-col" style={{ backgroundColor: '#17191F' }}>
      {/* 顶部 */}
      <div className="px-5 pb-6 pt-4" style={{ backgroundColor: '#17191F' }}>
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Grasp" className="h-8 w-8 rounded-full" />
          <p className="text-sm" style={{ color: '#A4A7B3' }}>Grasp</p>
        </div>
        <p className="mt-1.5 text-lg font-bold" style={{ color: '#F7F7FA' }}>你的专属陪练员与指导参谋</p>
      </div>

      {/* 滑卡区域 */}
      <div className="px-4 pb-4">
        <div
          className="relative h-[calc(100dvh-160px)] w-full touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* 下下张卡（最底层占位） */}
          {cards[index + 2] && (
            <div className="absolute inset-0 scale-90 rounded-3xl opacity-30 shadow-md" style={{ backgroundColor: '#22252D' }} />
          )}

          {/* 下一张卡（当前卡正下方） */}
          {next && (
            <div className="absolute inset-0 rounded-3xl shadow-lg overflow-hidden" style={{ ...nextCardStyle, backgroundColor: '#22252D' }}>
              <CardImage card={next} />
            </div>
          )}

          {/* 当前卡 */}
          {current ? (
            <div
              key={current.id}
              className="absolute inset-0 flex flex-col overflow-hidden rounded-3xl shadow-xl"
              style={{ ...cardStyle, backgroundColor: '#22252D' }}
            >
              {/* 图片铺满上半部分 */}
              <CardImage card={current} />

              {/* 信息区 —— 精简版 */}
              <div className="flex flex-1 flex-col justify-center px-5 py-4">
                {/* 难度标签 */}
                <div className="flex items-center gap-2">
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: 'rgba(232,92,98,0.12)', color: '#E85C62' }}>
                    {current.difficulty}
                  </span>
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: '#A4A7B3' }}>
                    {current.industry}
                  </span>
                </div>

                {/* 姓名 + 职位 */}
                <h2 className="mt-3 text-xl font-bold" style={{ color: '#F7F7FA' }}>{current.name}</h2>
                <p className="mt-1 text-sm" style={{ color: '#A4A7B3' }}>{current.title}</p>

                {/* 标签 */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {current.tags.map((tag) => (
                    <span key={tag} className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: 'rgba(232,92,98,0.1)', color: '#E85C62' }}>
                      {tag}
                    </span>
                  ))}
                </div>

                {/* 对练目标（一句话） */}
                <p className="mt-3 text-xs" style={{ color: '#6B6E7A' }}>
                  目标：{current.target}
                </p>
              </div>

              {/* 左滑标记（下一张） */}
              <div
                className="pointer-events-none absolute left-5 top-5 z-20 -rotate-12 rounded-lg border-2 px-3 py-1 text-sm font-bold"
                style={{ opacity: nextOpacity, borderColor: '#A4A7B3', color: '#A4A7B3' }}
              >
                下一位
              </div>
              {/* 右滑标记（上一张） */}
              <div
                className="pointer-events-none absolute right-5 top-5 z-20 rotate-12 rounded-lg border-2 px-3 py-1 text-sm font-bold"
                style={{ opacity: prevOpacity, borderColor: '#A4A7B3', color: '#A4A7B3' }}
              >
                上一位
              </div>

              {/* 滑动手势提示 */}
              {hintVisible && !drag.active && (
                <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center">
                  <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium animate-pulse" style={{ backgroundColor: 'rgba(232,92,98,0.85)', color: '#F7F7FA' }}>
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    左右滑动切换角色
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>
                </div>
              )}

              {/* 底部操作区 - 只保留"去对练" */}
              <div className="pointer-events-auto absolute inset-x-0 bottom-4 z-20 flex items-center justify-center">
                <button
                  className="flex h-12 items-center gap-2 rounded-full px-8 shadow-lg transition active:scale-90"
                  style={{ backgroundColor: '#E85C62' }}
                  onClick={goPractice}
                  disabled={!current || !!exiting}
                  aria-label="去对练"
                >
                  <svg className="h-5 w-5" style={{ color: '#17191F' }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  <span className="text-sm font-bold" style={{ color: '#17191F' }}>去对练</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl shadow-xl" style={{ backgroundColor: '#22252D' }}>
              <p className="text-sm" style={{ color: '#A4A7B3' }}>没有更多推荐了</p>
              <button
                className="mt-3 rounded-full px-5 py-2 text-sm font-medium"
                style={{ backgroundColor: '#E85C62', color: '#17191F' }}
                onClick={() => setIndex(0)}
              >
                重新开始
              </button>
            </div>
          )}
        </div>

        {/* 底部页码指示器 */}
        {cards.length > 1 && (
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {cards.map((_, i) => (
              <div
                key={i}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: i === index ? 20 : 6,
                  backgroundColor: i === index ? '#E85C62' : 'rgba(255,255,255,0.2)',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 卡片图片组件：铺满卡片上半部分 */
function CardImage({ card }: { card: RoleCard }) {
  const [imgError, setImgError] = useState(false);
  const fallbackUrl = '/avatars/man-2.jpg';

  return (
    <div className="relative h-[240px] w-full shrink-0 overflow-hidden" style={{ backgroundColor: '#2A2D36' }}>
      <img
        src={imgError ? fallbackUrl : card.avatar}
        alt={card.name}
        className="h-full w-full object-cover"
        onError={() => setImgError(true)}
      />
      {/* 底部渐变遮罩 */}
      <div className="absolute inset-x-0 bottom-0 h-20" style={{ background: 'linear-gradient(to top, #22252D, transparent)' }} />
    </div>
  );
}
