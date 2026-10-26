import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchTasks } from '../api';
import type { TaskView } from '../types';

const FILTERS = ['全部', '本周', '本月', '未完成'];
const MODES = ['全部模式', '文字', '语音', '通话'];
const CATEGORIES = ['全部类别', '电话销售', '客户主动咨询', '成交谈判', '地推破冰'];

export default function Sessions() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [activeFilter, setActiveFilter] = useState('全部');
  const [searchText, setSearchText] = useState('');
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    fetchTasks().then((data) => setTasks(data.tasks)).catch(console.error);
  }, []);

  const filteredTasks = tasks.filter((t) => {
    if (searchText && !t.scenarioName.includes(searchText) && !(t.personaName || '').includes(searchText)) return false;
    return true;
  });

  return (
    <div className="px-4 py-4">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-text-primary text-xl font-bold">对练列表</h1>
        <span className="text-text-tertiary text-xs">仅本人练过的角色</span>
      </div>

      {/* 搜索框 */}
      <div className="relative mb-3">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="搜索场景或角色"
          className="w-full pl-9 pr-4 py-2.5 bg-dark-panel rounded-full text-sm text-text-primary placeholder:text-text-tertiary border border-white/8 focus:border-coral/40 focus:outline-none transition-colors"
        />
      </div>

      {/* 筛选 Tab */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              activeFilter === f ? 'bg-coral text-white' : 'bg-dark-panel text-text-secondary'
            }`}
          >
            {f}
          </button>
        ))}
        <button
          onClick={() => setShowFilter(!showFilter)}
          className="px-3 py-1.5 bg-dark-panel text-text-secondary rounded-full text-xs whitespace-nowrap"
        >
          筛选 ⌄
        </button>
      </div>

      {/* 高级筛选（展开） */}
      {showFilter && (
        <div className="mt-3 p-3 bg-dark-panel rounded-xl space-y-2">
          <select className="w-full px-3 py-2 bg-dark-card text-text-primary text-sm rounded-lg border border-white/8 focus:border-coral/40 focus:outline-none">
            {MODES.map((m) => <option key={m}>{m}</option>)}
          </select>
          <select className="w-full px-3 py-2 bg-dark-card text-text-primary text-sm rounded-lg border border-white/8 focus:border-coral/40 focus:outline-none">
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      )}

      {/* 角色列表 */}
      <div className="mt-4 space-y-3">
        {filteredTasks.map((task) => (
          <div
            key={task.scenarioId}
            onClick={() => navigate(`/scenario/${task.scenarioId}`)}
            className="bg-dark-card rounded-2xl p-4 flex gap-3 items-center active:bg-dark-elevated transition-colors cursor-pointer border border-white/5"
          >
            {/* 头像 */}
            <div className="w-12 h-12 rounded-full bg-dark-panel flex items-center justify-center text-text-primary font-bold text-base shrink-0 overflow-hidden">
              {(task.personaName || '?').charAt(0)}
            </div>

            {/* 信息 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-text-primary text-sm font-medium truncate">{task.scenarioName}</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  task.status === 'passed' ? 'bg-success/15 text-success' :
                  task.status === 'in_progress' ? 'bg-cat-ground/15 text-cat-ground' :
                  task.status === 'failed_pending_retry' ? 'bg-coral/15 text-coral' :
                  'bg-text-tertiary/15 text-text-tertiary'
                }`}>
                  {task.status === 'passed' ? '已通过' :
                   task.status === 'in_progress' ? '进行中' :
                   task.status === 'failed_pending_retry' ? '待重练' : '未开始'}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
                <span>{task.personaName} · {task.personaTitle}</span>
                <span>{task.methodology}</span>
                {task.bestScore ? <span className="text-coral font-din font-bold">{task.bestScore}分</span> : null}
              </div>
            </div>

            {/* 操作 */}
            <button
              onClick={(e) => { e.stopPropagation(); navigate('/practice/new'); }}
              className="px-3 py-1.5 bg-coral/15 text-coral text-xs rounded-full font-medium shrink-0"
            >
              {task.bestScore ? '继续' : '开始'}
            </button>
          </div>
        ))}

        {filteredTasks.length === 0 && (
          <div className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-dark-panel flex items-center justify-center mx-auto mb-4 text-3xl">📭</div>
            <p className="text-text-secondary text-sm">暂无对练记录</p>
            <p className="text-text-tertiary text-xs mt-1">从首页选择角色开始练习</p>
          </div>
        )}
      </div>
    </div>
  );
}
