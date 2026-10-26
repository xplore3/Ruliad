import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useEffect } from 'react';

// Tab config matches prototype: 首页 / 构建 / 看板 / 我的
const TAB_ITEMS = [
  { path: '/home', label: '首页', icon: HomeTabIcon },
  { path: '/build', label: '构建', icon: BuildTabIcon },
  { path: '/dashboard', label: '看板', icon: DashboardTabIcon },
  { path: '/profile', label: '我的', icon: ProfileTabIcon },
];

const FULLSCREEN_PATHS = ['/practice', '/call', '/review', '/login', '/admin'];

export default function Layout() {
  const location = useLocation();
  const isFullscreen = FULLSCREEN_PATHS.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    if (isFullscreen) {
      document.body.classList.add('no-tab');
    } else {
      document.body.classList.remove('no-tab');
    }
    return () => document.body.classList.remove('no-tab');
  }, [isFullscreen]);

  return (
    <div className="min-h-screen" style={{ background: '#F7F7F8' }}>
      {/* Top bar (hidden on fullscreen pages) */}
      {!isFullscreen && <TopBar />}

      {/* Main content */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: isFullscreen ? '0 24px' : '64px 24px 24px' }}>
        <Outlet />
      </main>

      {/* Bottom Tab bar (mobile, hidden on fullscreen & PC) */}
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

// ===== Top Bar (matches prototype index.html .topnav) =====
function TopBar() {
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 50, height: 60,
      background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(10px)',
      borderBottom: '1px solid #EBEBEF',
    }}>
      <div style={{
        maxWidth: 1200, margin: '0 auto', height: '100%', padding: '0 24px',
        display: 'flex', alignItems: 'center', gap: 28,
      }}>
        {/* Logo */}
        <NavLink to="/home" className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-coral flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-white/90" />
          </span>
          <span className="text-text-primary font-bold text-lg tracking-wide">Grasp</span>
        </NavLink>

        {/* Menu (visible on desktop) */}
        <div className="flex gap-5 text-sm" style={{ flex: 1 }}>
          {TAB_ITEMS.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) =>
                `px-2 py-1 transition-colors ${isActive ? 'text-text-primary font-semibold' : 'text-text-secondary hover:text-text-primary'}`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>

        {/* Streak badge */}
        <div className="flex items-center gap-2">
          <span className="chip chip-gray">
            <span className="cdot" style={{ background: '#FF6B5B' }} />
            连续练习 6 天
          </span>
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-coral to-coral-dark flex items-center justify-center text-white text-sm font-bold">
            我
          </div>
        </div>
      </div>
    </nav>
  );
}

// ===== Tab Icons (inline SVG single-color, switches to coral on active) =====
function HomeTabIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={active ? '#FF6B5B' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.2 3.5 10.4c-.3.3-.5.7-.5 1.1V20c0 .6.4 1 1 1h4.2c.6 0 1-.4 1-1v-4.6h5.6V20c0 .6.4 1 1 1H20c.6 0 1-.4 1-1v-8.5c0-.4-.2-.8-.5-1.1L12 3.2z" />
    </svg>
  );
}

function BuildTabIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={active ? '#FF6B5B' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2a1 1 0 0 1 1 1v5.2a2.6 2.6 0 0 1 0 5V21a1 1 0 0 1-2 0v-7.8a2.6 2.6 0 0 1 0-5V3a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v1.2a2.6 2.6 0 0 1 0 5V21a1 1 0 0 1-2 0V9.2a2.6 2.6 0 0 1 0-5V3a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v9.2a2.6 2.6 0 0 1 0 5V21a1 1 0 0 1-2 0v-3.8a2.6 2.6 0 0 1 0-5V3a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function DashboardTabIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={active ? '#FF6B5B' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21c-.6 0-1-.4-1-1v-8c0-.6.4-1 1-1h2c.6 0 1 .4 1 1v8c0 .6-.4 1-1 1H4zm7 0c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1h2c.6 0 1 .4 1 1v16c0 .6-.4 1-1 1h-2zm7 0c-.6 0-1-.4-1-1v-5c0-.6.4-1 1-1h2c.6 0 1 .4 1 1v5c0 .6-.4 1-1 1h-2z" />
    </svg>
  );
}

function ProfileTabIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={active ? '#FF6B5B' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 1.8c-4.5 0-8.2 2.3-8.2 5.2 0 .6.4 1 1 1h14.4c.6 0 1-.4 1-1 0-2.9-3.7-5.2-8.2-5.2z" />
    </svg>
  );
}
