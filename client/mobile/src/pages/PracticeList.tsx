import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { usePageTrack } from '../track';
import { Avatar } from '../components/Avatar';
import type { TasksResponse, Task } from '../types';

export default function PracticeList() {
  const navigate = useNavigate();
  const [data, setData] = useState<TasksResponse | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<'recent' | 'unfinished' | 'finished'>('recent');
  usePageTrack('/practice');

  const load = () => {
    setError(false);
    api.get<TasksResponse>('/tasks').then((res) => setData(res.data)).catch(() => setError(true));
  };
  useEffect(load, []);

  const filtered = (task: Task) => {
    if (tab === 'unfinished') return task.status === 'in_progress' || task.needsRetry;
    if (tab === 'finished') return task.status === 'passed';
    return true;
  };

  const goSpace = (task: Task) => {
    navigate(`/space/${task.scenarioId}`);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center" style={{ backgroundColor: '#17191F', minHeight: '100vh' }}>
        <p className="text-sm" style={{ color: '#A4A7B3' }}>加载失败，请检查网络后重试</p>
        <button className="rounded-lg px-5 py-2 text-sm font-medium" style={{ backgroundColor: '#E85C62', color: '#17191F' }} onClick={load}>
          重新加载
        </button>
      </div>
    );
  }

  if (!data) {
    return <p className="p-10 text-center text-sm" style={{ color: '#A4A7B3', backgroundColor: '#17191F' }}>正在加载…</p>;
  }

  const tasks = data.tasks.filter(filtered);

  return (
    <div className="flex flex-col" style={{ backgroundColor: '#17191F', minHeight: '100vh' }}>
      <div className="px-5 pb-4 pt-4" style={{ backgroundColor: '#17191F' }}>
        <h1 className="text-xl font-bold" style={{ color: '#F7F7FA' }}>对练列表</h1>
        <p className="mt-1 text-xs" style={{ color: '#A4A7B3' }}>只展示你已练过的陪练员</p>
        <div className="mt-3 flex items-center gap-2 rounded-full px-3.5 py-2" style={{ backgroundColor: '#22252D' }}>
          <svg className="h-4 w-4" style={{ color: '#A4A7B3' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.2-5.2M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: '#F7F7FA' }}
            placeholder="搜索练过的陪练员"
          />
        </div>
      </div>

      {/* Tab */}
      <div className="flex px-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {([
          { key: 'recent', label: '最近' },
          { key: 'unfinished', label: '未完成' },
          { key: 'finished', label: '已完成' },
        ] as const).map((t) => (
          <button
            key={t.key}
            className="relative py-3 text-sm font-medium transition-colors"
            style={{ color: tab === t.key ? '#E85C62' : '#A4A7B3', marginRight: '1rem' }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {tab === t.key && <span className="absolute bottom-0 left-0 h-0.5 w-full" style={{ backgroundColor: '#E85C62' }} />}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="space-y-3 p-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm" style={{ color: '#A4A7B3' }}>还没有练过的陪练员</p>
            <button
              className="rounded-full px-5 py-2 text-sm font-medium"
              style={{ backgroundColor: '#E85C62', color: '#17191F' }}
              onClick={() => navigate('/')}
            >
              去首页选陪练员
            </button>
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.scenarioId}
              className="flex items-center gap-3 rounded-2xl p-4"
              style={{ backgroundColor: '#22252D', cursor: 'pointer' }}
              onClick={() => goSpace(task)}
              role="button"
            >
              <Avatar name={(task.personaName ?? task.scenarioName)} size="md" rounded="full" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold" style={{ color: '#F7F7FA' }}>
                  {task.personaName ?? task.scenarioName}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: '#A4A7B3' }}>
                  {task.status === 'in_progress'
                    ? '未完成 · 继续对练'
                    : task.needsRetry
                      ? `需重练 · 上次 ${task.lastScore} 分`
                      : task.bestScore !== undefined
                        ? `最新成绩 ${task.bestScore} · 查看报告`
                        : '采购场景'}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: '#A4A7B3' }}>{task.scenarioName}</p>
              </div>
              <svg className="h-5 w-5" style={{ color: '#A4A7B3' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
