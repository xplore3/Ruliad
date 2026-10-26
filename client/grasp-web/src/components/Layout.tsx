import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import AppFrame from './AppFrame';
import { clearToken, getStoredUser } from '../api';
import { usePageTrack } from '../track';

const tabs = [
  {
    to: '/tasks',
    label: '任务',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" />
      </svg>
    ),
  },
  {
    to: '/practice',
    label: '对练',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h8m-8 4h5M21 12a9 9 0 11-4.5-7.8L21 3l-1.2 4.5A8.96 8.96 0 0121 12z" />
      </svg>
    ),
  },
  {
    to: '/growth',
    label: '成长',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-3-3-5 5" />
      </svg>
    ),
  },
  {
    to: '/exams',
    label: '考核',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
];

export default function Layout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = getStoredUser();
  // 页面埋点：路由变化即上报浏览/停留
  usePageTrack(pathname);

  const logout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  return (
    <AppFrame className="lg:max-w-none">
      {/* PC 顶部导航（<lg 隐藏），与平台深色顶栏一致 */}
      <header className="hidden bg-[#17191F] lg:block">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-10 px-6">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Grasp" className="h-9 w-9 rounded-full" />
            <span className="text-lg font-bold text-white">Grasp · 你的专属陪练员与指导参谋</span>
          </div>
          <nav className="flex items-center gap-2">
            {tabs.map((tab) => (
              <NavLink
                key={tab.label}
                to={tab.to}
                className={({ isActive }) =>
                  `rounded-full px-5 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-orange-500 font-bold text-[#17191F]'
                      : 'font-medium text-slate-400 hover:text-slate-200'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-slate-300">{user?.name ?? ''}</span>
            <button
              onClick={logout}
              className="rounded-full border border-slate-600 px-4 py-1.5 text-sm text-slate-300 hover:border-slate-400 hover:text-white"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 lg:mx-auto lg:w-full lg:max-w-5xl lg:px-6 lg:py-8">
        <Outlet />
      </main>

      {/* 移动端底部 Tab：深色底 + 琥珀色激活胶囊（lg 起隐藏） */}
      <nav className="sticky bottom-0 z-10 grid grid-cols-4 bg-[#17191F] px-2 pb-2 pt-1 lg:hidden">
        {tabs.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            className={({ isActive }) =>
              `mx-1 flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-xs transition-colors ${
                isActive ? 'bg-orange-500 font-bold text-[#17191F]' : 'text-slate-400'
              }`
            }
          >
            {tab.icon}
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </AppFrame>
  );
}
