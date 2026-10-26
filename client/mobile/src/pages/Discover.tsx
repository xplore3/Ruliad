import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageTrack } from '../track';

// ==================== 类型 ====================
interface FeedItem {
  id: string;
  avatar: string;
  author: string;
  title: string;
  scoreDelta: string;
  note: string;
  likes: number;
  mode: string;
  rule: string;
  streak: number;
  points: number;
}

interface RankUser {
  id: string;
  name: string;
  avatar: string;
  points: number;
  practiceCount: number;
  bestScore: number;
  streak: number;
}

interface Achievement {
  id: string;
  icon: string;
  name: string;
  desc: string;
  unlocked: boolean;
  progress?: number;
  total?: number;
}

interface DailyChallenge {
  id: string;
  title: string;
  desc: string;
  reward: number;
  done: boolean;
  icon: string;
}

// ==================== 演示数据 ====================
const DEMO_FEED: FeedItem[] = [
  {
    id: '1', avatar: '陈', author: '小陈的成长记录',
    title: '异议处理，终于突破了',
    scoreDelta: '68 → 82',
    note: '先倾听，再回应，是这周最大的收获。',
    likes: 24, mode: '语音对话', rule: '规则 v1', streak: 7, points: 320,
  },
  {
    id: '2', avatar: '宁', author: '阿宁 · 连续练习',
    title: '完成 7 天采购场景训练',
    scoreDelta: '从急着介绍产品，到真正理解客户。',
    note: '理解客户比说服客户更重要。',
    likes: 18, mode: '文字对话', rule: 'SPIN v1', streak: 7, points: 280,
  },
  {
    id: '3', avatar: '周', author: '小周的成长',
    title: '需求挖掘的质变',
    scoreDelta: '72 → 85',
    note: '不要急着推方案，先问清楚问题。',
    likes: 12, mode: '语音对话', rule: '规则 v1', streak: 3, points: 195,
  },
];

const DEMO_RANKING: RankUser[] = [
  { id: 'r1', name: '林小满', avatar: '林', points: 890, practiceCount: 34, bestScore: 92, streak: 12 },
  { id: 'r2', name: '小陈', avatar: '陈', points: 720, practiceCount: 28, bestScore: 85, streak: 7 },
  { id: 'r3', name: '阿宁', avatar: '宁', points: 650, practiceCount: 25, bestScore: 80, streak: 7 },
  { id: 'r4', name: '我', avatar: '周', points: 520, practiceCount: 20, bestScore: 85, streak: 3 },
  { id: 'r5', name: '大李', avatar: '李', points: 480, practiceCount: 18, bestScore: 78, streak: 5 },
  { id: 'r6', name: '阿杰', avatar: '杰', points: 410, practiceCount: 15, bestScore: 75, streak: 2 },
  { id: 'r7', name: '小美', avatar: '美', points: 350, practiceCount: 13, bestScore: 72, streak: 4 },
  { id: 'r8', name: '大伟', avatar: '伟', points: 290, practiceCount: 11, bestScore: 68, streak: 1 },
];

const DEMO_ACHIEVEMENTS: Achievement[] = [
  { id: 'a1', icon: '🔥', name: '连击达人', desc: '连续练习 7 天', unlocked: true },
  { id: 'a2', icon: '🏆', name: '高分选手', desc: '单次得分 ≥ 85', unlocked: true },
  { id: 'a3', icon: '📚', name: '勤奋学员', desc: '累计练习 20 次', unlocked: true },
  { id: 'a4', icon: '🎤', name: '语音先锋', desc: '完成 5 次语音对练', unlocked: true },
  { id: 'a5', icon: '💎', name: '满分传奇', desc: '单次得分 ≥ 95', unlocked: false },
  { id: 'a6', icon: '⚡', name: '闪电连击', desc: '连续练习 30 天', unlocked: false, progress: 12, total: 30 },
  { id: 'a7', icon: '🎯', name: '全场景通', desc: '通关所有场景', unlocked: false, progress: 2, total: 5 },
  { id: 'a8', icon: '🌟', name: '周榜首', desc: '登上周榜第一', unlocked: false },
  { id: 'a9', icon: '🎖', name: '百日坚持', desc: '累计练习 100 次', unlocked: false, progress: 20, total: 100 },
];

const DEMO_CHALLENGES: DailyChallenge[] = [
  { id: 'c1', title: '完成 1 次对练', desc: '任意模式，练起来就行', reward: 30, done: false, icon: '✅' },
  { id: 'c2', title: '得分 ≥ 80', desc: '挑战高分，突破自己', reward: 50, done: false, icon: '🎯' },
  { id: 'c3', title: '完成语音对练', desc: '开口说，才是真的练', reward: 40, done: true, icon: '🎤' },
  { id: 'c4', title: '连续 3 天打卡', desc: '今日打卡，保持连击', reward: 20, done: true, icon: '🔥' },
];

const MY_POINTS = 520;
const MY_STREAK = 3;

// ==================== 主组件 ====================
type Tab = 'feed' | 'ranking' | 'achievements';

export default function Discover() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('feed');
  const [feedTab, setFeedTab] = useState<'recommend' | 'following'>('recommend');
  const [feed] = useState(DEMO_FEED);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [rankingPeriod, setRankingPeriod] = useState<'week' | 'total'>('week');
  usePageTrack('/discover');

  return (
    <div className="flex flex-col" style={{ backgroundColor: '#17191F', minHeight: '100vh' }}>
      {/* 顶部 */}
      <div className="px-5 pb-3 pt-4" style={{ backgroundColor: '#17191F' }}>
        <h1 className="text-base font-bold" style={{ color: '#F7F7FA' }}>发现</h1>

        {/* 我的积分卡片 */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-xl px-3 py-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <span className="text-sm">⭐</span>
            <span className="text-sm font-bold" style={{ color: '#F7F7FA' }}>{MY_POINTS}</span>
            <span className="text-xs" style={{ color: '#A4A7B3' }}>积分</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl px-3 py-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <span className="text-sm">🔥</span>
            <span className="text-sm font-bold" style={{ color: '#F7F7FA' }}>{MY_STREAK}</span>
            <span className="text-xs" style={{ color: '#A4A7B3' }}>连击</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl px-3 py-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <span className="text-sm">🏅</span>
            <span className="text-sm font-bold" style={{ color: '#F7F7FA' }}>第4名</span>
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="mt-3 flex gap-4">
          <button
            className="text-sm font-bold transition"
            style={{ color: tab === 'feed' ? '#E85C62' : '#A4A7B3' }}
            onClick={() => setTab('feed')}
          >
            推荐
          </button>
          <button
            className="text-sm font-bold transition"
            style={{ color: tab === 'ranking' ? '#E85C62' : '#A4A7B3' }}
            onClick={() => setTab('ranking')}
          >
            排行榜
          </button>
          <button
            className="text-sm font-bold transition"
            style={{ color: tab === 'achievements' ? '#E85C62' : '#A4A7B3' }}
            onClick={() => setTab('achievements')}
          >
            成就
          </button>
        </div>
      </div>

      {/* 内容区 */}
      {tab === 'feed' && (
        <FeedTab
          feed={feed}
          feedTab={feedTab}
          setFeedTab={setFeedTab}
          followed={followed}
          setFollowed={setFollowed}
          liked={liked}
          setLiked={setLiked}
          navigate={navigate}
        />
      )}

      {tab === 'ranking' && (
        <RankingTab
          ranking={DEMO_RANKING}
          period={rankingPeriod}
          setPeriod={setRankingPeriod}
          myId="r4"
        />
      )}

      {tab === 'achievements' && (
        <AchievementsTab challenges={DEMO_CHALLENGES} achievements={DEMO_ACHIEVEMENTS} />
      )}
    </div>
  );
}

// ==================== 推荐动态 Tab ====================
function FeedTab({
  feed, feedTab, setFeedTab, followed, setFollowed, liked, setLiked, navigate,
}: {
  feed: FeedItem[];
  feedTab: 'recommend' | 'following';
  setFeedTab: (t: 'recommend' | 'following') => void;
  followed: Set<string>;
  setFollowed: React.Dispatch<React.SetStateAction<Set<string>>>;
  liked: Set<string>;
  setLiked: React.Dispatch<React.SetStateAction<Set<string>>>;
  navigate: (path: string) => void;
}) {
  return (
    <>
      {/* 子 Tab */}
      <div className="flex gap-4 px-5 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          className="text-xs font-bold"
          style={{ color: feedTab === 'recommend' ? '#E85C62' : '#A4A7B3' }}
          onClick={() => setFeedTab('recommend')}
        >
          推荐
        </button>
        <button
          className="text-xs font-bold"
          style={{ color: feedTab === 'following' ? '#E85C62' : '#A4A7B3' }}
          onClick={() => setFeedTab('following')}
        >
          关注
        </button>
      </div>

      {/* 每日挑战入口 */}
      <div className="mx-4 mt-3 rounded-2xl p-3" style={{ backgroundColor: 'rgba(232,92,98,0.08)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm">🎁</span>
          <p className="text-xs font-bold" style={{ color: '#E85C62' }}>每日挑战</p>
          <span className="ml-auto rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: 'rgba(232,92,98,0.15)', color: '#E85C62' }}>
            2/4 已完成
          </span>
        </div>
        <p className="mt-1 text-xs" style={{ color: '#A4A7B3' }}>完成今日挑战，最高可得 140 积分</p>
      </div>

      <div className="space-y-4 p-4">
        {feed.map((item) => (
          <div key={item.id} className="rounded-2xl p-4" style={{ backgroundColor: '#22252D', border: '1px solid rgba(255,255,255,0.04)' }}>
            {/* 作者 */}
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: 'rgba(232,92,98,0.12)', color: '#E85C62' }}>
                {item.avatar}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold" style={{ color: '#F7F7FA' }}>{item.author}</p>
                  {item.streak >= 3 && (
                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: 'rgba(232,92,98,0.1)', color: '#E85C62' }}>
                      🔥{item.streak}
                    </span>
                  )}
                </div>
                <p className="text-xs" style={{ color: '#A4A7B3' }}>{item.mode} · {item.rule}</p>
              </div>
              <button
                className="rounded-full px-3 py-1 text-xs font-medium transition"
                style={followed.has(item.id)
                  ? { backgroundColor: 'rgba(255,255,255,0.06)', color: '#A4A7B3' }
                  : { border: '1px solid #E85C62', color: '#E85C62' }
                }
                onClick={() =>
                  setFollowed((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
              >
                {followed.has(item.id) ? '已关注' : '关注'}
              </button>
            </div>

            {/* 成果 */}
            <div className="mt-3 rounded-xl px-4 py-3" style={{ backgroundColor: 'rgba(232,92,98,0.06)' }}>
              <p className="text-sm font-bold" style={{ color: '#F7F7FA' }}>{item.title}</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-sm font-bold" style={{ color: '#E85C62' }}>{item.scoreDelta}</p>
                <span className="flex items-center gap-0.5 text-xs" style={{ color: '#E85C62' }}>
                  <span>⭐</span>
                  <span className="font-bold">+{item.points}</span>
                </span>
              </div>
            </div>

            {/* 心得 */}
            <p className="mt-3 text-xs leading-relaxed" style={{ color: '#A4A7B3' }}>{item.note}</p>

            {/* 互动 */}
            <div className="mt-3 flex items-center gap-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <button
                className="flex items-center gap-1.5 text-xs transition"
                style={{ color: liked.has(item.id) ? '#E85C62' : '#A4A7B3' }}
                onClick={() =>
                  setLiked((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
              >
                <svg className="h-4 w-4" fill={liked.has(item.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                {item.likes + (liked.has(item.id) ? 1 : 0)}
              </button>
              <button
                className="ml-auto rounded-full px-3 py-1 text-xs font-medium"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: '#A4A7B3' }}
                onClick={() => navigate(`/discover/${item.id}`)}
              >
                查看成果 ›
              </button>
            </div>
          </div>
        ))}
        <p className="py-4 text-center text-xs" style={{ color: '#A4A7B3', opacity: 0.5 }}>公开成果 · 演示内容</p>
      </div>
    </>
  );
}

// ==================== 排行榜 Tab ====================
function RankingTab({
  ranking, period, setPeriod, myId,
}: {
  ranking: RankUser[];
  period: 'week' | 'total';
  setPeriod: (p: 'week' | 'total') => void;
  myId: string;
}) {
  const sorted = [...ranking].sort((a, b) => b.points - a.points);
  const myIndex = sorted.findIndex((u) => u.id === myId);
  const top3 = sorted.slice(0, 3);

  return (
    <div className="p-4">
      {/* 周榜/总榜 切换 */}
      <div className="mb-4 flex justify-center gap-2">
        <button
          className="rounded-full px-4 py-1.5 text-xs font-bold transition"
          style={period === 'week' ? { backgroundColor: '#E85C62', color: '#17191F' } : { backgroundColor: '#22252D', color: '#A4A7B3' }}
          onClick={() => setPeriod('week')}
        >
          周榜
        </button>
        <button
          className="rounded-full px-4 py-1.5 text-xs font-bold transition"
          style={period === 'total' ? { backgroundColor: '#E85C62', color: '#17191F' } : { backgroundColor: '#22252D', color: '#A4A7B3' }}
          onClick={() => setPeriod('total')}
        >
          总榜
        </button>
      </div>

      {/* 前三名领奖台 */}
      <div className="mb-4 flex items-end justify-center gap-2">
        {/* 第 2 名（左） */}
        {top3[1] && (
          <div className="flex flex-col items-center">
            <div className="mb-1 text-base">🥈</div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: '#F7F7FA' }}>
              {top3[1].avatar}
            </div>
            <p className="mt-1 text-xs font-bold" style={{ color: '#F7F7FA' }}>{top3[1].name}</p>
            <p className="text-xs" style={{ color: '#E85C62' }}>⭐{top3[1].points}</p>
            <div className="mt-1 flex h-16 w-16 items-start justify-center rounded-t-lg pt-1" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
              <span className="text-xs font-bold" style={{ color: '#A4A7B3' }}>2</span>
            </div>
          </div>
        )}
        {/* 第 1 名（中间，最高） */}
        {top3[0] && (
          <div className="flex flex-col items-center">
            <div className="mb-1 text-lg">🥇</div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: 'rgba(232,92,98,0.15)', color: '#E85C62' }}>
              {top3[0].avatar}
            </div>
            <p className="mt-1 text-xs font-bold" style={{ color: '#F7F7FA' }}>{top3[0].name}</p>
            <p className="text-xs" style={{ color: '#E85C62' }}>⭐{top3[0].points}</p>
            <div className="mt-1 flex h-20 w-16 items-start justify-center rounded-t-lg pt-1" style={{ backgroundColor: 'rgba(232,92,98,0.12)' }}>
              <span className="text-xs font-bold" style={{ color: '#E85C62' }}>1</span>
            </div>
          </div>
        )}
        {/* 第 3 名（右） */}
        {top3[2] && (
          <div className="flex flex-col items-center">
            <div className="mb-1 text-base">🥉</div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(232,92,98,0.12)', color: '#E85C62' }}>
              {top3[2].avatar}
            </div>
            <p className="mt-1 text-xs font-bold" style={{ color: '#F7F7FA' }}>{top3[2].name}</p>
            <p className="text-xs" style={{ color: '#E85C62' }}>⭐{top3[2].points}</p>
            <div className="mt-1 flex h-12 w-16 items-start justify-center rounded-t-lg pt-1" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <span className="text-xs font-bold" style={{ color: '#A4A7B3' }}>3</span>
            </div>
          </div>
        )}
      </div>

      {/* 排行列表 */}
      <div className="space-y-2">
        {sorted.map((user, i) => {
          const isMe = user.id === myId;
          return (
            <div
              key={user.id}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={isMe
                ? { border: '2px solid #E85C62', backgroundColor: 'rgba(232,92,98,0.06)' }
                : { backgroundColor: '#22252D' }
              }
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={i < 3 ? { backgroundColor: 'rgba(232,92,98,0.12)', color: '#E85C62' } : { backgroundColor: 'rgba(255,255,255,0.06)', color: '#A4A7B3' } }>
                {i + 1}
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(232,92,98,0.1)', color: '#E85C62' }}>
                {user.avatar}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-bold" style={{ color: '#F7F7FA' }}>
                    {isMe ? '我' : user.name}
                  </p>
                  {user.streak >= 3 && (
                    <span className="shrink-0 text-[10px]">🔥{user.streak}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs" style={{ color: '#A4A7B3' }}>
                  <span>练{user.practiceCount}次</span>
                  <span>·</span>
                  <span>最高{user.bestScore}分</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold" style={{ color: '#E85C62' }}>{user.points}</p>
                <p className="text-[10px]" style={{ color: '#A4A7B3' }}>积分</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 我的排名 */}
      <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: '#22252D' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs" style={{ color: '#A4A7B3' }}>我的排名</p>
            <p className="mt-0.5 text-lg font-bold" style={{ color: '#F7F7FA' }}>第 {myIndex + 1} 名</p>
          </div>
          <div className="text-right">
            <p className="text-xs" style={{ color: '#A4A7B3' }}>距上一名</p>
            <p className="mt-0.5 text-sm font-bold" style={{ color: '#E85C62' }}>
              差 {myIndex > 0 ? sorted[myIndex - 1].points - sorted[myIndex].points : 0} 积分
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== 成就墙 Tab ====================
function AchievementsTab({
  challenges, achievements,
}: {
  challenges: DailyChallenge[];
  achievements: Achievement[];
}) {
  const doneCount = challenges.filter((c) => c.done).length;
  const totalReward = challenges.reduce((sum, c) => sum + c.reward, 0);
  const earnedReward = challenges.filter((c) => c.done).reduce((sum, c) => sum + c.reward, 0);
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="space-y-4 p-4">
      {/* 每日挑战 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold" style={{ color: '#F7F7FA' }}>每日挑战</h2>
          <span className="text-xs" style={{ color: '#A4A7B3' }}>已得 {earnedReward}/{totalReward} 积分</span>
        </div>

        <div className="space-y-2">
          {challenges.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ backgroundColor: c.done ? 'rgba(93,199,163,0.08)' : '#22252D' }}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base" style={{ backgroundColor: c.done ? 'rgba(93,199,163,0.12)' : 'rgba(255,255,255,0.06)' }}>
                {c.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ color: c.done ? '#5DC7A3' : '#F7F7FA' }}>
                  {c.done ? '✓ ' : ''}{c.title}
                </p>
                <p className="text-xs" style={{ color: '#A4A7B3' }}>{c.desc}</p>
              </div>
              <div className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold" style={c.done ? { backgroundColor: 'rgba(93,199,163,0.15)', color: '#5DC7A3' } : { backgroundColor: 'rgba(232,92,98,0.12)', color: '#E85C62' }}>
                +{c.reward}
              </div>
            </div>
          ))}
        </div>

        {/* 进度条 */}
        <div className="mt-3">
          <div className="flex justify-between text-xs" style={{ color: '#A4A7B3' }}>
            <span>今日进度</span>
            <span>{doneCount}/{challenges.length}</span>
          </div>
          <div className="mt-1 h-2 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(doneCount / challenges.length) * 100}%`, backgroundColor: '#E85C62' }}
            />
          </div>
        </div>
      </section>

      {/* 成就徽章墙 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold" style={{ color: '#F7F7FA' }}>成就徽章</h2>
          <span className="text-xs" style={{ color: '#A4A7B3' }}>已解锁 {unlockedCount}/{achievements.length}</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {achievements.map((a) => (
            <div
              key={a.id}
              className="flex flex-col items-center rounded-2xl p-3 text-center"
              style={{ backgroundColor: a.unlocked ? '#22252D' : 'rgba(255,255,255,0.02)' }}
            >
              <div className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl ${a.unlocked ? '' : 'opacity-30 grayscale'}`}>
                {a.icon}
              </div>
              <p className="mt-1.5 text-xs font-bold" style={{ color: a.unlocked ? '#F7F7FA' : '#A4A7B3' }}>
                {a.name}
              </p>
              <p className="mt-0.5 text-[10px] leading-tight" style={{ color: '#A4A7B3' }}>
                {a.unlocked ? '已解锁' : a.progress != null ? `${a.progress}/${a.total}` : a.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 积分规则说明 */}
      <section className="rounded-2xl p-4" style={{ backgroundColor: '#22252D' }}>
        <h2 className="mb-2 text-sm font-bold" style={{ color: '#F7F7FA' }}>积分怎么赚？</h2>
        <ul className="space-y-1.5 text-xs" style={{ color: '#A4A7B3' }}>
          <li className="flex items-center gap-2">
            <span style={{ color: '#E85C62' }}>⭐+10</span>
            <span>完成一次对练</span>
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: '#E85C62' }}>⭐+30</span>
            <span>得分 ≥ 70</span>
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: '#E85C62' }}>⭐+50</span>
            <span>得分 ≥ 85</span>
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: '#E85C62' }}>⭐+20</span>
            <span>每日连击 +1</span>
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: '#E85C62' }}>⭐+100</span>
            <span>解锁成就徽章</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
