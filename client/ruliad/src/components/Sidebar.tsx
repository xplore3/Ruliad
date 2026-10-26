import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { path: '/home', label: '首页', icon: HomeIcon },
  { path: '/build', label: '构建', icon: BuildIcon },
  { path: '/dashboard', label: '看板', icon: DashboardIcon },
  { path: '/profile', label: '我的', icon: ProfileIcon },
];

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[220px] bg-white border-r border-gray-100 flex flex-col z-50 shadow-sm transition-all duration-300 max-lg:w-[72px]">
      {/* LOGO */}
      <div className="h-16 flex items-center px-5 border-b border-gray-50">
        <div className="w-8 h-8 rounded-lg bg-coral flex items-center justify-center text-white font-bold text-sm">
          G
        </div>
        <span className="ml-3 text-ink font-semibold text-base max-lg:hidden">Grasp AI</span>
      </div>

      {/* 导航 */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
                isActive
                  ? 'bg-coral-light text-coral'
                  : 'text-ink-secondary hover:bg-gray-50 hover:text-ink'
              }`
            }
          >
            <item.icon />
            <span className="max-lg:hidden">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* 底部 - 练习记录快捷入口 */}
      <div className="px-3 pb-4 border-t border-gray-50 pt-3">
        <NavLink
          to="/profile"
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs text-ink-secondary hover:bg-gray-50 transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <span className="max-lg:hidden">练习记录</span>
        </NavLink>
        <div className="mt-2 px-3">
          <span className="text-[10px] text-ink-secondary/60 max-lg:hidden">v1.0.0 Demo</span>
        </div>
      </div>
    </aside>
  );
}

// ===== Icons =====

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function BuildIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
