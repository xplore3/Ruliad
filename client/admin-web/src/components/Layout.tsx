import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearToken, getStoredUser } from '../api';
import { usePageTrack } from '../track';

const ROLE_LABELS: Record<string, string> = {
  trainee: '学员',
  supervisor: '主管',
  admin: '管理员',
  executive: '高管',
  platform: '平台',
};

/** 管理后台各页面的路径前缀（顶栏高亮 + 二级页签判定共用） */
const ADMIN_MATCH = ['/paths', '/scenarios', '/exams-admin', '/data-center', '/personas', '/appeals'];

/** 顶栏入口定义：roles 为该入口可见的角色（缺省 = 所有角色；platform 始终全量可见） */
interface TopNavEntry {
  key: string;
  label: string;
  sub: string;
  href?: string;
  to?: string;
  match?: string[];
  roles?: string[];
}

/**
 * 顶部主导航（对应设计图深色顶栏胶囊）。
 */
const topNav: TopNavEntry[] = [
  { key: 'trainee', label: '学员端', sub: '移动优先', href: 'http://localhost:5173' },
  { key: 'supervisor', label: '主管看板', sub: '团队', to: '/supervisor', roles: ['supervisor'] },
  {
    key: 'admin',
    label: '管理后台',
    sub: '冠军',
    to: '/paths',
    match: ADMIN_MATCH,
    roles: ['admin'],
  },
  {
    key: 'assets',
    label: '资产中心',
    sub: '资产',
    to: '/data-assets',
    match: ['/data-assets'],
    roles: ['admin'],
  },
  {
    key: 'workshop',
    label: '内容工坊',
    sub: '平台',
    to: '/workshop/pipeline',
    match: ['/workshop'],
    roles: ['admin'],
  },
  {
    key: 'executive',
    label: '高管看板',
    sub: '只读',
    to: '/executive',
    match: ['/executive'],
    roles: ['executive'],
  },
];

/** 管理后台二级页签（对应设计图浅色页签条） */
const adminTabs = [
  { to: '/paths', label: '课程配置' },
  { to: '/scenarios', label: '场景配置' },
  { to: '/exams-admin', label: '考核管理' },
  { to: '/data-center', label: '数据中心' },
  { to: '/personas', label: '陪练员与话术' },
  { to: '/appeals', label: '申诉复核' },
];

/** 内容工坊二级页签 */
const workshopTabs = [
  { to: '/workshop/pipeline', label: '流水线' },
  { to: '/workshop/rules', label: '评分规则' },
  { to: '/workshop/quiz-questions', label: '考题管理' },
  { to: '/workshop/regression', label: '回归测试' },
  { to: '/workshop/observations', label: '观察项' },
];

function TopNavItem({ item, pathname }: { item: (typeof topNav)[number]; pathname: string }) {
  const active = item.to
    ? (item.match ?? [item.to]).some((p) => pathname.startsWith(p))
    : false;
  const cls = `flex items-baseline gap-1.5 rounded-full px-5 py-2 text-sm transition-colors ${
    active
      ? 'bg-orange-500 font-bold text-[#17191F]'
      : 'font-medium text-slate-400 hover:text-slate-200'
  }`;
  const inner = (
    <>
      <span>{item.label}</span>
      <span className={`text-xs ${active ? 'text-[#17191F]/70' : 'text-slate-500'}`}>
        {item.sub}
      </span>
    </>
  );
  if (item.href) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <NavLink to={item.to!} className={cls}>
      {inner}
    </NavLink>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = getStoredUser();
  const inAdmin = ADMIN_MATCH.some((p) => pathname.startsWith(p));
  const inWorkshop = pathname.startsWith('/workshop');
  // 页面埋点：路由变化即上报浏览/停留
  usePageTrack(pathname);
  // 按角色过滤顶栏入口：platform 全量可见，其余角色只见 roles 命中的入口
  const visibleNav = topNav.filter(
    (item) => user?.role === 'platform' || !item.roles || item.roles.includes(user?.role ?? '')
  );

  const logout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#eef3f6] text-slate-800">
      {/* 深色顶栏 */}
      <header className="bg-[#17191F]">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-8 px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-base font-black text-[#17191F]">
              G
            </div>
            <span className="text-lg font-bold tracking-wide text-white">Grasp · 你的专属陪练员与指导参谋</span>
          </div>
          <nav className="flex items-center gap-2">
            {visibleNav.map((item) => (
              <TopNavItem key={item.key} item={item} pathname={pathname} />
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-slate-300">
              {user?.name ?? ''}
              {user?.role && (
                <span className="ml-1 text-xs text-slate-500">
                  （{ROLE_LABELS[user.role] ?? user.role}）
                </span>
              )}
            </span>
            <button
              onClick={logout}
              className="rounded-full border border-slate-600 px-4 py-1.5 text-sm text-slate-300 hover:border-slate-400 hover:text-white"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-8">
        {inWorkshop && <SectionTabs tabs={workshopTabs} />}
        <Outlet context={{ inAdmin } satisfies { inAdmin: boolean }} />
      </main>
    </div>
  );
}

/** 浅色二级页签条（管理后台 / 内容工坊共用样式） */
function SectionTabs({ tabs }: { tabs: { to: string; label: string }[] }) {
  return (
    <div className="mb-8 flex gap-2 rounded-2xl bg-[#e3edf0] p-2">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `flex-1 rounded-xl py-3 text-center text-sm transition-colors ${
              isActive
                ? 'bg-white font-bold text-slate-800 shadow-sm'
                : 'font-medium text-slate-500 hover:text-slate-700'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}

/** 管理后台二级页签条，供管理后台各页面复用 */
export function AdminSectionTabs(): ReactNode {
  return <SectionTabs tabs={adminTabs} />;
}
