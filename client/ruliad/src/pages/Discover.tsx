import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// 模拟信息流数据
const FEED_DATA = [
  { id: 'f1', user: '林晓雯', avatar: '林', role: 'SaaS 销售', scenario: '向 CFO 谈年度订阅', score: 92, mode: '通话', likes: 128, time: '2 小时前' },
  { id: 'f2', user: '陈志远', avatar: '陈', role: '课程顾问', scenario: '高异议家长试听转化', score: 88, mode: '语音', likes: 96, time: '4 小时前' },
  { id: 'f3', user: '王雪琪', avatar: '王', role: '地产销售', scenario: '客户嫌贵犹豫时逼定', score: 85, mode: '文字', likes: 74, time: '6 小时前' },
  { id: 'f4', user: '赵明轩', avatar: '赵', role: '医疗器械销售', scenario: '向采购主任报价谈判', score: 79, mode: '通话', likes: 52, time: '昨天' },
];

const LEADERBOARD_DATA = [
  { rank: 1, name: '林晓雯', score: 1842, delta: '+128', avatar: '林', trend: 'up' as const },
  { rank: 2, name: '陈志远', score: 1756, delta: '+96', avatar: '陈', trend: 'up' as const },
  { rank: 3, name: '王雪琪', score: 1698, delta: '+74', avatar: '王', trend: 'up' as const },
  { rank: 4, name: '赵明轩', score: 1620, delta: '-12', avatar: '赵', trend: 'down' as const },
  { rank: 5, name: '李子豪', score: 1580, delta: '+36', avatar: '李', trend: 'up' as const },
];

const TABS = ['信息流', '榜单'] as const;
type Tab = typeof TABS[number];

export default function Discover() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('信息流');
  const [likes, setLikes] = useState<Record<string, boolean>>({});

  const toggleLike = (id: string) => {
    setLikes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="px-4 py-4">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-text-primary text-xl font-bold">发现</h1>
        <span className="text-text-tertiary text-xs">与同路人共同成长</span>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 bg-dark-panel rounded-full p-1 mb-5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-full transition-all ${
              tab === t ? 'bg-coral text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* 信息流 */}
      {tab === '信息流' && (
        <div className="space-y-3">
          {FEED_DATA.map((item) => (
            <div
              key={item.id}
              className="bg-dark-card rounded-2xl p-4 border border-white/5"
            >
              {/* 头部：用户信息 */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-coral/30 to-cat-ground/20 flex items-center justify-center text-text-primary font-bold text-sm">
                  {item.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-text-primary text-sm font-medium truncate">{item.user}</span>
                    <span className="text-text-tertiary text-xs">{item.role}</span>
                  </div>
                  <span className="text-text-tertiary text-xs">{item.time}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  item.mode === '通话' ? 'bg-coral/15 text-coral' :
                  item.mode === '语音' ? 'bg-cat-inquiry/15 text-cat-inquiry' :
                  'bg-cat-ground/15 text-cat-ground'
                }`}>
                  {item.mode}
                </span>
              </div>

              {/* 对练卡片内容 */}
              <div
                onClick={() => navigate('/scenario/sc-hero')}
                className="bg-dark-panel rounded-xl p-3 mb-3 cursor-pointer hover:bg-dark-elevated transition-colors"
              >
                <h4 className="text-text-primary text-sm font-medium line-clamp-1">{item.scenario}</h4>
                <div className="flex items-center gap-3 mt-2">
                  <span className="font-din text-xl font-bold text-coral">
                    {item.score}
                    <span className="text-xs text-text-tertiary ml-0.5">分</span>
                  </span>
                  <span className="text-text-tertiary text-xs">评定：{
                    item.score >= 90 ? '卓越' :
                    item.score >= 80 ? '优秀' : '达标'
                  }</span>
                </div>
              </div>

              {/* 操作区 */}
              <div className="flex items-center gap-4">
                <button
                  onClick={() => toggleLike(item.id)}
                  className={`flex items-center gap-1.5 text-xs transition-colors ${
                    likes[item.id] ? 'text-coral' : 'text-text-tertiary hover:text-coral'
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={likes[item.id] ? '#E85C62' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  <span>{likes[item.id] ? item.likes + 1 : item.likes}</span>
                </button>
                <button className="flex items-center gap-1.5 text-text-tertiary hover:text-text-primary text-xs transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>评论</span>
                </button>
                <button className="flex items-center gap-1.5 text-text-tertiary hover:text-coral text-xs transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                  <span>收藏</span>
                </button>
                <button className="flex items-center gap-1.5 text-text-tertiary hover:text-warning text-xs transition-colors ml-auto">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                    <line x1="4" y1="22" x2="4" y2="15" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 榜单 */}
      {tab === '榜单' && (
        <div>
          {/* 榜单说明 */}
          <div className="bg-dark-panel rounded-2xl p-4 mb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-warning/20 flex items-center justify-center text-lg">🏆</div>
              <div>
                <h3 className="text-text-primary text-sm font-semibold">规则与评级榜单</h3>
                <p className="text-text-tertiary text-xs">基于用户模拟练习的综合表现统计</p>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-text-secondary">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-coral" />通话
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-cat-inquiry" />语音
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-cat-ground" />文字
              </span>
            </div>
          </div>

          {/* 榜单列表 */}
          <div className="bg-dark-card rounded-2xl overflow-hidden border border-white/5">
            {LEADERBOARD_DATA.map((item, idx) => (
              <div
                key={item.rank}
                className={`flex items-center gap-3 px-4 py-3 ${
                  idx < LEADERBOARD_DATA.length - 1 ? 'border-b border-white/5' : ''
                } hover:bg-dark-elevated transition-colors`}
              >
                {/* 排名 */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  item.rank === 1 ? 'bg-warning/20 text-warning' :
                  item.rank === 2 ? 'bg-dark-elevated text-text-secondary' :
                  item.rank === 3 ? 'bg-warning-soft text-warning' :
                  'bg-dark-panel text-text-tertiary'
                }`}>
                  {item.rank}
                </div>

                {/* 头像 */}
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-coral/20 to-cat-ground/15 flex items-center justify-center text-text-primary font-bold text-sm">
                  {item.avatar}
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <span className="text-text-primary text-sm font-medium block truncate">{item.name}</span>
                  <span className="text-text-tertiary text-xs">总分 {item.score}</span>
                </div>

                {/* 趋势 */}
                <span className={`text-xs font-medium flex items-center gap-0.5 ${
                  item.trend === 'up' ? 'text-success' : 'text-coral'
                }`}>
                  {item.trend === 'up' ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  )}
                  {item.delta}
                </span>
              </div>
            ))}
          </div>

          {/* 底部提示 */}
          <p className="text-center text-text-tertiary text-xs mt-4">
            榜单数据每日凌晨 0 点刷新
          </p>
        </div>
      )}

      {/* 公共工具样式 */}
      <style>{`
        .line-clamp-1 {
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
        }
      `}</style>
    </div>
  );
}
