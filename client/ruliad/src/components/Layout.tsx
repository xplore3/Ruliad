import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { fetchGrowth } from '../api';

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 当前连续练习天数（以今天或昨天结尾）；与 Dashboard 的 streaks 逻辑一致 */
function currentStreak(dateKeys: Set<string>): number {
  let n = 0;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  if (!dateKeys.has(dayKey(t))) t.setDate(t.getDate() - 1);
  while (dateKeys.has(dayKey(t))) {
    n++;
    t.setDate(t.getDate() - 1);
  }
  return n;
}

// Tab config matches prototype: 首页 / 构建 / 看板 / 我的
const TAB_ITEMS = [
  { path: '/home', label: '首页', icon: HomeTabIcon },
  { path: '/build', label: '构建', icon: BuildTabIcon },
  { path: '/dashboard', label: '看板', icon: DashboardTabIcon },
  { path: '/profile', label: '我的', icon: ProfileTabIcon },
];

const FULLSCREEN_PATHS = ['/practice', '/call', '/review', '/login'];

export default function Layout() {
  const location = useLocation();
  const isFullscreen = FULLSCREEN_PATHS.some((p) => location.pathname.startsWith(p));
  /** 连续练习天数；null = 加载失败/加载中，不展示徽章 */
  const [streak, setStreak] = useState<number | null>(null);

  useEffect(() => {
    if (isFullscreen) return;
    let cancelled = false;
    fetchGrowth()
      .then((data) => {
        if (cancelled) return;
        const dateKeys = new Set(data.sessions.map((s) => dayKey(new Date(s.at))));
        setStreak(currentStreak(dateKeys));
      })
      .catch(() => {
        if (!cancelled) setStreak(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isFullscreen, location.pathname]);

  useEffect(() => {
    if (isFullscreen) {
      document.body.classList.add('no-tab');
    } else {
      document.body.classList.remove('no-tab');
    }
    return () => document.body.classList.remove('no-tab');
  }, [isFullscreen]);

  return (
    <div className="layout-wrapper">
      {/* PC Top Navigation - matches prototype .topnav */}
      {!isFullscreen && <TopBar streak={streak} />}

      {/* Mobile Top Bar - matches prototype .mtopbar */}
      {!isFullscreen && (
        <div className="mtopbar">
          {getPageTitle(location.pathname)}
          {streak != null && streak > 0 && <span className="right">连续 {streak} 天</span>}
        </div>
      )}

      {/* Main content - matches prototype .wrap */}
      <main className="wrap" style={{ paddingTop: isFullscreen ? 0 : undefined }}>
        <Outlet />
      </main>

      {/* Bottom Tab bar - matches prototype .tabbar */}
      {!isFullscreen && (
        <nav className="tabbar">
          <div className="row">
            {TAB_ITEMS.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                <tab.icon active={location.pathname === tab.path || location.pathname.startsWith(tab.path + '/')} />
                <span>{tab.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

// ===== Top Bar (matches prototype .topnav) =====
function TopBar({ streak }: { streak: number | null }) {
  return (
    <nav className="topnav">
      <div className="inner">
        {/* Logo */}
        <NavLink to="/home" className="logo">
          <span className="dot" />
          Grasp
        </NavLink>

        {/* Menu */}
        <div className="menu">
          {TAB_ITEMS.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                {tab.label}
              </NavLink>
          ))}
        </div>

        {/* Streak + Avatar */}
        <div className="me">
          {streak != null && streak > 0 && (
            <span className="chip gray">
              <i className="cdot" style={{ background: 'var(--coral)' }} />
              连续练习 {streak} 天
            </span>
          )}
          <NavLink to="/profile" className="avatar av5" style={{ width: 36, height: 36, fontSize: 14 }}>
            我
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

// ===== Helpers =====
function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/home')) return 'Grasp';
  if (pathname.startsWith('/build')) return '构建';
  if (pathname.startsWith('/library')) return '资源库';
  if (pathname.startsWith('/dashboard')) return '能力看板';
  if (pathname.startsWith('/profile')) return '我的';
  if (pathname.startsWith('/practice')) return '练习中';
  if (pathname.startsWith('/call')) return '语音通话';
  if (pathname.startsWith('/review')) return '练习报告';
  if (pathname.startsWith('/settings')) return '设置';
  return 'Grasp';
}

// ===== Tab Icons (inline SVG, switches to coral on active) =====
function HomeTabIcon({ active }: { active: boolean }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke={active ? '#FF6B5B' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.2 3.5 10.4c-.3.3-.5.7-.5 1.1V20c0 .6.4 1 1 1h4.2c.6 0 1-.4 1-1v-4.6h5.6V20c0 .6.4 1 1 1H20c.6 0 1-.4 1-1v-8.5c0-.4-.2-.8-.5-1.1L12 3.2z" />
    </svg>
  );
}

function BuildTabIcon({ active }: { active: boolean }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke={active ? '#FF6B5B' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2a1 1 0 0 1 1 1v5.2a2.6 2.6 0 0 1 0 5V21a1 1 0 0 1-2 0v-7.8a2.6 2.6 0 0 1 0-5V3a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v1.2a2.6 2.6 0 0 1 0 5V21a1 1 0 0 1-2 0V9.2a2.6 2.6 0 0 1 0-5V3a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v9.2a2.6 2.6 0 0 1 0 5V21a1 1 0 0 1-2 0v-3.8a2.6 2.6 0 0 1 0-5V3a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function DashboardTabIcon({ active }: { active: boolean }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke={active ? '#FF6B5B' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21c-.6 0-1-.4-1-1v-8c0-.6.4-1 1-1h2c.6 0 1 .4 1 1v8c0 .6-.4 1-1 1H4zm7 0c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1h2c.6 0 1 .4 1 1v16c0 .6-.4 1-1 1h-2zm7 0c-.6 0-1-.4-1-1v-5c0-.6.4-1 1-1h2c.6 0 1 .4 1 1v5c0 .6-.4 1-1 1h-2z" />
    </svg>
  );
}

function ProfileTabIcon({ active }: { active: boolean }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke={active ? '#FF6B5B' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 1.8c-4.5 0-8.2 2.3-8.2 5.2 0 .6.4 1 1 1h14.4c.6 0 1-.4 1-1 0-2.9-3.7-5.2-8.2-5.2z" />
    </svg>
  );
}
