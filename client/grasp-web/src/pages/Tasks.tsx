import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getStoredUser } from '../api';
import type { CreateSessionResponse, Task, TasksResponse } from '../types';

/** 倒计时：X 天 XX 小时（不足 1 天时只显示小时） */
function formatCountdown(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return '即将截止';
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} 天 ${String(hours % 24).padStart(2, '0')} 小时`;
  return `${hours} 小时`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return '上午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

const STATUS_BADGE: Record<Task['status'], { label: string; cls: string }> = {
  locked: { label: '待解锁', cls: 'bg-gray-100 text-gray-400' },
  available: { label: '可练习', cls: 'bg-[#eef3f6] text-[#4a5a66]' },
  in_progress: { label: '进行中', cls: 'bg-[#fdf3e0] text-[#c98a2d]' },
  passed: { label: '已通过', cls: 'bg-[#d9efe6] text-[#2e9e77]' },
  failed_pending_retry: { label: '强制重练', cls: 'bg-[#fde8ea] text-[#e05a6b]' },
};

export default function Tasks() {
  const navigate = useNavigate();
  const [data, setData] = useState<TasksResponse | null>(null);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const load = () => {
    setError(false);
    api
      .get<TasksResponse>('/tasks')
      .then((res) => setData(res.data))
      .catch(() => setError(true));
  };

  useEffect(load, []);

  const startTask = async (task: Task) => {
    if (task.status === 'locked' || starting) return;
    setStarting(task.scenarioId);
    try {
      const res = await api.post<CreateSessionResponse>('/sessions', {
        scenarioId: task.scenarioId,
        mode: 'practice',
      });
      navigate(`/session/${res.data.session.id}`, { state: res.data });
    } catch {
      window.alert('创建练习失败，请稍后重试');
      setStarting(null);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm text-gray-500">任务加载失败，请检查网络后重试</p>
        <button
          className="rounded-lg bg-[#0d5e63] px-5 py-2 text-sm font-medium text-white"
          onClick={load}
        >
          重新加载
        </button>
      </div>
    );
  }

  if (!data) {
    return <p className="p-10 text-center text-sm text-gray-400">正在加载任务…</p>;
  }

  const { tasks, skillMap, nextExamWindow } = data;
  const userName = getStoredUser()?.name ?? '同学';
  // 待完成任务：可练 / 进行中 / 待重练
  const pending = tasks.filter(
    (t) => t.status === 'available' || t.status === 'in_progress' || t.needsRetry
  );
  const totalMinutes = pending.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0);
  // 今日主线：第一个非复训的可开始任务
  const mainTask = tasks.find(
    (t) => !t.isReview && (t.status === 'available' || t.status === 'in_progress')
  );
  const sideTasks = tasks.filter((t) => t !== mainTask);

  return (
    <div className="space-y-4 p-4 lg:grid lg:grid-cols-5 lg:gap-6 lg:space-y-0 lg:p-0">
      <div className="space-y-4 lg:col-span-3">
      {/* 问候语 + 今日摘要标题 */}
      <header className="pt-1">
        <p className="text-sm text-[#6b7f8d]">
          {greeting()}，{userName}
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold leading-tight text-gray-900">
          {pending.length > 0
            ? `今天练 ${pending.length} 场，约 ${totalMinutes} 分钟`
            : '今日任务已全部完成'}
        </h1>
      </header>

      {/* 认证考核倒计时横幅 */}
      {nextExamWindow && (
        <div className="flex items-center gap-2 rounded-full bg-[#17191F] px-4 py-2.5">
          <svg
            className="h-4 w-4 shrink-0 text-orange-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-sm text-white">{nextExamWindow.name}剩余</span>
          <span className="text-sm font-semibold text-orange-500">
            {formatCountdown(nextExamWindow.endsAt)}
          </span>
        </div>
      )}

      {/* 今日主线大卡 */}
      {mainTask && (
        <section className="relative rounded-2xl bg-white p-4 shadow-sm">
          <span className="inline-block rounded-full bg-orange-500 px-3 py-1 text-xs font-semibold text-[#17191F]">
            今日主线
          </span>
          <h2 className="mt-2.5 pr-14 text-lg font-bold text-gray-900">
            {mainTask.scenarioName}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {mainTask.personaName ? `客户：${mainTask.personaName}` : ''}
            {mainTask.personaTitle ? ` · ${mainTask.personaTitle}` : ''}
          </p>
          <p className="mt-2 text-xs text-gray-400">
            {mainTask.durationMinutes ? `${mainTask.durationMinutes} 分钟` : ''}
            {mainTask.methodology ? ` · ${mainTask.methodology}` : ''}
            {mainTask.difficulty ? ` · ${mainTask.difficulty}` : ''}
            {mainTask.requiredPassScore ? ` · 达标 ${mainTask.requiredPassScore} 分` : ''}
          </p>
          {mainTask.methodology && (
            <div className="mt-3 rounded-lg bg-[#fdf3e0] px-3 py-2 text-xs text-[#6b5a3a]">
              技能点来自「{mainTask.methodology}」
              {mainTask.practiceCount ? ` · 累计被练习 ${mainTask.practiceCount} 次` : ''}
            </div>
          )}
          <button
            aria-label="开始练习"
            className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#0d5e63] shadow-md transition active:scale-95 disabled:opacity-50"
            onClick={() => startTask(mainTask)}
            disabled={starting !== null}
          >
            {starting === mainTask.scenarioId ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <svg className="ml-0.5 h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </section>
      )}

      {/* 其余任务卡 */}
      {sideTasks.map((task) => {
        const locked = task.status === 'locked';
        const badge = task.isReview
          ? { label: '间隔复训', cls: 'bg-[#d9efe6] text-[#2e9e77]' }
          : STATUS_BADGE[task.status];
        const subtitle = task.isReview
          ? `${task.reviewLabel === 'D21' ? '第 21 天' : '第 7 天'}间隔重现 · ${task.durationMinutes ?? ''} 分钟`
          : task.needsRetry
            ? `上次未达标${task.lastScore !== null ? `（${task.lastScore} 分）` : ''}，同陪练员换随机种子 · ${task.durationMinutes ?? ''} 分钟`
            : locked
              ? '完成前置任务后解锁'
              : [
                  task.personaName ? `客户：${task.personaName}` : null,
                  task.durationMinutes ? `${task.durationMinutes} 分钟` : null,
                  task.requiredPassScore ? `达标 ${task.requiredPassScore} 分` : null,
                  task.lastScore !== null ? `上次 ${task.lastScore} 分` : null,
                  task.bestScore !== undefined ? `最佳 ${task.bestScore} 分` : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
        const isRetry = task.needsRetry;
        return (
          <section
            key={task.scenarioId}
            role={locked ? undefined : 'button'}
            tabIndex={locked ? undefined : 0}
            className={`flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition ${
              locked ? 'opacity-60' : 'cursor-pointer active:scale-[0.98]'
            }`}
            onClick={locked ? undefined : () => startTask(task)}
            onKeyDown={
              locked
                ? undefined
                : (e) => {
                    if (e.key === 'Enter' || e.key === ' ') startTask(task);
                  }
            }
          >
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                isRetry ? 'bg-[#fde8ea]' : task.isReview ? 'bg-gray-100' : 'bg-[#eef3f6]'
              }`}
            >
              {locked ? (
                <svg
                  className="h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                  />
                </svg>
              ) : isRetry ? (
                <svg
                  className="h-5 w-5 text-[#e05a6b]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
              ) : (
                <svg
                  className="h-5 w-5 text-[#4a5a66]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z"
                  />
                </svg>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-gray-900">
                {task.isReview ? '轻量复训 · ' : task.needsRetry ? '重练 · ' : ''}
                {task.scenarioName}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>
            </div>
            {starting === task.scenarioId ? (
              <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[#0d5e63]/30 border-t-[#0d5e63]" />
            ) : (
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}
              >
                {badge.label}
              </span>
            )}
          </section>
        );
      })}

      {tasks.length === 0 && (
        <p className="rounded-2xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
          暂时没有练习任务
        </p>
      )}
      </div>

      {/* 技能地图 */}
      <section className="mt-4 pt-2 lg:col-span-2 lg:mt-0 lg:pt-0">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-bold text-gray-900">技能地图</h2>
          <span className="text-xs text-gray-400">= 公司的打法目录</span>
        </div>
        {skillMap.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
            完成练习后这里会生成你的技能地图
          </p>
        ) : (
          <ul className="space-y-3">
            {skillMap.map((skill) => {
              const certified = !skill.locked && skill.currentLevel >= skill.maxLevel;
              return (
                <li key={skill.skillPointId} className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[15px] font-bold ${
                        skill.locked ? 'text-gray-400' : 'text-gray-900'
                      }`}
                    >
                      {skill.name}
                    </span>
                    {skill.locked ? (
                      <svg
                        className="h-4.5 w-4.5 text-gray-300"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                        />
                      </svg>
                    ) : (
                      <span className="text-xs font-semibold text-[#3d6b70]">
                        L{skill.currentLevel} / L{skill.maxLevel}
                      </span>
                    )}
                  </div>
                  <div className="mt-2.5 flex gap-1.5">
                    {Array.from({ length: skill.maxLevel }, (_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${
                          !skill.locked && i < skill.currentLevel ? 'bg-orange-500' : 'bg-gray-200'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mt-2.5 flex items-center gap-1 text-xs text-gray-400">
                    {certified && (
                      <svg
                        className="h-3.5 w-3.5 text-[#2e9e77]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                    {skill.locked
                      ? (skill.source ?? '来自 待解锁')
                      : (skill.source ??
                        (skill.historyCount > 0 ? `已被练习 ${skill.historyCount} 次` : '待练习'))}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
