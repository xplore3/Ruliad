import { NavLink, Outlet } from 'react-router-dom';
import { usePageTrack } from '../track';

const tabs = [
  {
    to: '/',
    label: '首页',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" />
      </svg>
    ),
  },
  {
    to: '/practice',
    label: '对练列表',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
      </svg>
    ),
  },
  {
    to: '/discover',
    label: '发现',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
      </svg>
    ),
  },
  {
    to: '/profile',
    label: '我的',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 7.5a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0" />
      </svg>
    ),
  },
];

export default function Layout() {
  usePageTrack('layout');

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: '#17191F' }}>
      <main className="flex-1 overflow-y-auto pb-24 no-scrollbar">
        <Outlet />
      </main>

      {/* 四 Tab 底部导航 */}
      <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-md -translate-x-1/2 grid grid-cols-4 border-t border-white/5 px-2 pb-1 pt-1.5 safe-bottom" style={{ backgroundColor: '#17191F' }}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `mx-0.5 flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] transition-colors ${
                isActive ? 'font-bold text-orange-400' : 'text-[#A4A7B3]'
              }`
            }
          >
            {tab.icon}
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
