import { useNavigate } from 'react-router-dom';
import { getStoredUser, clearToken } from '../api';

export default function TopBar() {
  const navigate = useNavigate();
  const user = getStoredUser();

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6 sticky top-0 z-40">
      {/* 搜索框 */}
      <div className="relative w-80">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="搜索场景、人物..."
          className="w-full pl-9 pr-4 py-2 bg-warm-white rounded-full text-sm text-ink placeholder:text-ink-secondary/60 border border-transparent focus:border-coral/30 focus:bg-white focus:outline-none transition-all"
        />
      </div>

      {/* 右侧功能区 */}
      <div className="flex items-center gap-4">
        {/* 通知铃铛 */}
        <button className="relative w-9 h-9 rounded-full bg-warm-white flex items-center justify-center text-ink-secondary hover:bg-gray-100 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className="absolute top-1 right-1 w-2 h-2 bg-coral rounded-full" />
        </button>

        {/* 头像 */}
        <div className="flex items-center gap-2 cursor-pointer group">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-coral to-coral-hover flex items-center justify-center text-white font-semibold text-sm">
            {user?.name?.charAt(0) || '?'}
          </div>
          <span className="text-sm text-ink font-medium max-md:hidden">{user?.name || '用户'}</span>
          {/* 下拉菜单 */}
          <div className="opacity-0 group-hover:opacity-100 absolute right-0 top-12 bg-white rounded-xl shadow-lg border border-gray-100 py-2 w-36 transition-opacity pointer-events-none group-hover:pointer-events-auto">
            <button
              onClick={handleLogout}
              className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:bg-gray-50 hover:text-coral transition-colors"
            >
              退出登录
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
