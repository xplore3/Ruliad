import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import StatusBar from '../components/StatusBar';
import { Avatar } from '../components/Avatar';
import type { TasksResponse, Task } from '../types';

export default function RoleSpace() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<TasksResponse>('/tasks').then((res) => {
      const t = res.data.tasks.find((t) => t.scenarioId === scenarioId);
      setTask(t ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [scenarioId]);

  if (loading) {
    return <div className="relative mx-auto flex min-h-screen w-full max-w-md items-center justify-center"><p className="text-sm">正在加载…</p></div>;
  }

  const name = task?.personaName ?? task?.scenarioName ?? '陪练员';

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: '#17191F' }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate('/practice')} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: '#A4A7B3' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      {/* 陪练员头像 */}
      <div className="flex items-center gap-3 px-5 pt-2">
        <Avatar name={name} size="lg" rounded="full" />
        <div>
          <p className="text-lg font-bold" style={{ color: '#F7F7FA' }}>{name}</p>
          <p className="text-xs" style={{ color: '#A4A7B3' }}>私有派生 · 画像 v2</p>
        </div>
      </div>

      {/* 状态 */}
      {task?.status === 'in_progress' && (
        <div className="mx-5 mt-4 rounded-xl px-4 py-3" style={{ backgroundColor: 'rgba(232,92,98,0.08)' }}>
          <p className="text-sm font-medium" style={{ color: '#E85C62' }}>继续对练 · 上次未完成</p>
        </div>
      )}
      {task?.bestScore !== undefined && task.status === 'passed' && (
        <div className="mx-5 mt-4 rounded-xl px-4 py-3" style={{ backgroundColor: 'rgba(93,199,163,0.08)' }}>
          <p className="text-sm font-medium" style={{ color: '#5DC7A3' }}>最新成绩 {task.bestScore} · 查看报告</p>
        </div>
      )}

      {/* 功能入口 */}
      <div className="mt-6 space-y-2 px-5">
        <button
          className="flex w-full items-center gap-3 rounded-2xl p-4 text-left transition active:scale-[0.98]"
          style={{ backgroundColor: '#E85C62' }}
          onClick={() => navigate(`/mode/${scenarioId}`)}
        >
          <span className="text-2xl">▶</span>
          <div className="flex-1">
            <p className="text-base font-bold" style={{ color: '#F7F7FA' }}>继续对练</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>选择模式，开始新的一轮</p>
          </div>
        </button>

        <SpaceItem icon="👤" title="陪练员画像" subtitle="重塑与自定义" onClick={() => navigate(`/space/${scenarioId}/profile`)} />
        <SpaceItem icon="🔮" title="推演沙盘" subtitle="环境 · 客户 · 自身 条件推演" onClick={() => navigate(`/space/${scenarioId}/sandbox`)} />
        <SpaceItem icon="📊" title="我的专项能力" subtitle="对该陪练员的分析" onClick={() => navigate(`/space/${scenarioId}/ability`)} />
        <SpaceItem icon="📜" title="历史对练" subtitle="3 次 · 演示" onClick={() => navigate('/practice')} />
      </div>

      {/* 下一次目标 */}
      <div className="mx-5 mt-6 rounded-2xl p-4" style={{ backgroundColor: '#22252D' }}>
        <p className="text-xs" style={{ color: '#A4A7B3' }}>下一次练习目标</p>
        <p className="mt-1.5 text-sm font-medium" style={{ color: '#F7F7FA' }}>先确认预算边界，再提供价值证据。</p>
      </div>

      <div className="flex-1" />
      <div className="h-6" />
    </div>
  );
}

function SpaceItem({ icon, title, subtitle, onClick }: { icon: string; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button className="flex w-full items-center gap-3 rounded-2xl p-4 text-left transition active:scale-[0.98]" style={{ backgroundColor: '#22252D' }} onClick={onClick}>
      <span className="text-2xl">{icon}</span>
      <div className="flex-1">
        <p className="text-[15px] font-bold" style={{ color: '#F7F7FA' }}>{title}</p>
        <p className="text-xs" style={{ color: '#A4A7B3' }}>{subtitle}</p>
      </div>
      <svg className="h-5 w-5" style={{ color: '#A4A7B3' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
    </button>
  );
}
