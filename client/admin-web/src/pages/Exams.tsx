import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api';
import { AdminSectionTabs } from '../components/Layout';

type WindowStatus = 'draft' | 'open' | 'closed' | 'published';

interface ExamWindow {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  scenarioIds: string[];
  userIds: string[];
  status: WindowStatus;
  retakeCooldownDays: number;
  proctoring?: {
    disableHints: boolean;
    maxAttemptsPerScenario?: number;
    maxTabSwitches?: number;
  };
  /** GET /exam-windows 附带的场景名（该接口还返回学员视角的 myStatus 等字段，管理端忽略） */
  scenarioNames?: string[];
}

interface RosterItem {
  userId: string;
  userName: string;
  completedScenarios: number;
  totalScenarios: number;
  bestScore: number | null;
  passed: boolean;
  passedAt: string | null;
  status: 'completed' | 'in_progress' | 'not_started';
}

interface ScenarioOption {
  id: string;
  name: string;
}

interface TraineeOption {
  id: string;
  name: string;
  username?: string;
}

interface CreateForm {
  name: string;
  startsAt: string;
  endsAt: string;
  retakeCooldownDays: string;
  scenarioIds: string[];
  userIds: string[];
}

const emptyForm: CreateForm = {
  name: '',
  startsAt: '',
  endsAt: '',
  retakeCooldownDays: '7',
  scenarioIds: [],
  userIds: [],
};

const STATUS_LABELS: Record<WindowStatus, string> = {
  draft: '草稿',
  open: '开放中',
  closed: '已关闭',
  published: '已发布',
};

/** 状态机 draft→open→closed→published 的下一步动作 */
const NEXT_STATUS: Partial<Record<WindowStatus, { to: WindowStatus; label: string }>> = {
  draft: { to: 'open', label: '开放考核' },
  open: { to: 'closed', label: '关闭窗口' },
  closed: { to: 'published', label: '发布结果' },
};

const ROSTER_STATUS_LABELS: Record<RosterItem['status'], string> = {
  completed: '已完成',
  in_progress: '进行中',
  not_started: '未开始',
};

/** ISO 时间 → 「MM-DD HH:mm」 */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 成绩 CSV 由后端生成（GET /exam-windows/:id/export），blob 下载以携带鉴权头 */
async function downloadCsv(window: ExamWindow) {
  const res = await api.get(`/exam-windows/${window.id}/export`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `exam-${window.name || window.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function DownloadIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      className="h-5 w-5 text-orange-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
      <circle cx="12" cy="16" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function Exams() {
  const [windows, setWindows] = useState<ExamWindow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RosterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [scenarios, setScenarios] = useState<ScenarioOption[]>([]);
  const [trainees, setTrainees] = useState<TraineeOption[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');

  const selected = useMemo(
    () => windows.find((w) => w.id === selectedId) ?? null,
    [windows, selectedId]
  );

  const loadWindows = useCallback(async (keepSelection?: string | null) => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get<{ windows: ExamWindow[] }>('/exam-windows');
      const list = res.data.windows ?? [];
      setWindows(list);
      setSelectedId((prev) => {
        const wanted = keepSelection ?? prev;
        if (wanted && list.some((w) => w.id === wanted)) return wanted;
        return list[0]?.id ?? null;
      });
    } catch {
      setLoadError('加载考核窗口失败，请确认后端服务已启动');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMonitor = useCallback(async (id: string) => {
    try {
      const res = await api.get<{ window: ExamWindow; progress: RosterItem[] }>(
        `/exam-windows/${id}/monitor`
      );
      setProgress(res.data.progress ?? []);
    } catch {
      setProgress([]);
      setActionError('加载名单进度失败');
    }
  }, []);

  useEffect(() => {
    loadWindows();
    // 开窗表单的场景 / 学员选项
    api
      .get<{ scenarios: ScenarioOption[] }>('/scenarios')
      .then((res) => setScenarios(res.data.scenarios ?? []))
      .catch(() => setScenarios([]));
    api
      .get<TraineeOption[]>('/users', { params: { role: 'trainee' } })
      .then((res) => setTrainees(Array.isArray(res.data) ? res.data : []))
      .catch(() => setTrainees([]));
  }, [loadWindows]);

  useEffect(() => {
    if (selectedId) loadMonitor(selectedId);
    else setProgress([]);
  }, [selectedId, loadMonitor]);

  const advanceStatus = async () => {
    if (!selected) return;
    const next = NEXT_STATUS[selected.status];
    if (!next) return;
    setActionError('');
    try {
      await api.post(`/exam-windows/${selected.id}/status`, { status: next.to });
      await loadWindows(selected.id);
      await loadMonitor(selected.id);
    } catch {
      setActionError('状态流转失败，请重试');
    }
  };

  const toggleId = (key: 'scenarioIds' | 'userIds', id: string) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id],
    }));
  };

  const submitCreate = async () => {
    if (!form.name.trim()) return setFormError('请填写考核名称');
    if (!form.startsAt || !form.endsAt) return setFormError('请选择窗口起止时间');
    if (new Date(form.endsAt) <= new Date(form.startsAt))
      return setFormError('结束时间须晚于开始时间');
    if (form.scenarioIds.length === 0) return setFormError('请至少选择一个场景');
    if (form.userIds.length === 0) return setFormError('请至少选择一名学员');
    const retakeCooldownDays = Number(form.retakeCooldownDays);
    if (!Number.isInteger(retakeCooldownDays) || retakeCooldownDays < 0)
      return setFormError('补考间隔须为非负整数');

    setSubmitting(true);
    setFormError('');
    try {
      const res = await api.post<ExamWindow>('/exam-windows', {
        name: form.name.trim(),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        scenarioIds: form.scenarioIds,
        userIds: form.userIds,
        retakeCooldownDays,
      });
      setForm(emptyForm);
      setShowForm(false);
      await loadWindows(res.data.id);
    } catch {
      setFormError('创建失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  const examFields = selected
    ? [
        { label: '考核名称', value: selected.name },
        {
          label: '窗口时间',
          value: `${fmtTime(selected.startsAt)} ~ ${fmtTime(selected.endsAt)}`,
        },
        {
          label: '指定场景',
          value: `${selected.scenarioIds.length} 个（${
            (selected.scenarioNames ?? []).join('／') || '—'
          }）`,
        },
        {
          label: '监考规则',
          value: selected.proctoring
            ? [
                selected.proctoring.disableHints ? '禁用提示' : null,
                selected.proctoring.maxAttemptsPerScenario
                  ? `单场景限 ${selected.proctoring.maxAttemptsPerScenario} 次`
                  : null,
                selected.proctoring.maxTabSwitches
                  ? `切屏限 ${selected.proctoring.maxTabSwitches} 次`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || '默认'
            : '默认（禁用提示 · 全程录音）',
        },
        {
          label: '状态',
          value: `${STATUS_LABELS[selected.status]} · 补考间隔 ${selected.retakeCooldownDays} 天`,
        },
        { label: '名单人数', value: `${selected.userIds.length} 人` },
      ]
    : [];

  const completedCount = progress.filter((p) => p.status === 'completed').length;
  const roster = [
    {
      label: '已通过',
      count: progress.filter((p) => p.passed).length,
      color: 'text-emerald-600',
    },
    {
      label: '未通过（进入补练）',
      count: progress.filter((p) => !p.passed && p.status !== 'not_started').length,
      color: 'text-rose-500',
    },
    {
      label: '未开始',
      count: progress.filter((p) => p.status === 'not_started').length,
      color: 'text-slate-400',
    },
  ];

  const next = selected ? NEXT_STATUS[selected.status] : undefined;

  return (
    <div>
      {/* 标题区 */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#17191F]">管理后台</h1>
          <p className="mt-2 text-sm text-slate-500">培训管理员（冠军）· 华东制药事业部</p>
        </div>
        <button className="flex items-center gap-2 rounded-full bg-[#0d5e63] px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90">
          <DownloadIcon />
          导出冠军汇报包（PPT）
        </button>
      </div>

      <AdminSectionTabs />

      {/* 窗口选择 + 新建 */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {loading && windows.length === 0 ? (
          <span className="text-sm text-slate-400">加载中…</span>
        ) : loadError ? (
          <span className="text-sm text-red-600">{loadError}</span>
        ) : windows.length === 0 ? (
          <span className="text-sm text-slate-400">暂无考核窗口，点击「新建窗口」创建</span>
        ) : (
          windows.map((w) => (
            <button
              key={w.id}
              onClick={() => setSelectedId(w.id)}
              className={`rounded-full px-4 py-2 text-sm transition-colors ${
                w.id === selectedId
                  ? 'bg-[#0d5e63] font-bold text-white'
                  : 'bg-white font-medium text-slate-600 hover:bg-slate-100'
              }`}
            >
              {w.name}
              <span
                className={`ml-2 text-xs ${w.id === selectedId ? 'text-white/70' : 'text-slate-400'}`}
              >
                {STATUS_LABELS[w.status]}
              </span>
            </button>
          ))
        )}
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setFormError('');
          }}
          className="rounded-full border border-[#0d5e63] px-4 py-2 text-sm font-medium text-[#0d5e63] transition-colors hover:bg-[#0d5e63]/5"
        >
          {showForm ? '收起' : '+ 新建窗口'}
        </button>
      </div>

      {/* 新建窗口表单 */}
      {showForm && (
        <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-slate-800">新建考核窗口</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">考核名称 *</label>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：2026 Q3 L2 认证"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">补考间隔（天）</label>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={form.retakeCooldownDays}
                onChange={(e) => setForm({ ...form, retakeCooldownDays: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">开始时间 *</label>
              <input
                type="datetime-local"
                className={inputCls}
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">结束时间 *</label>
              <input
                type="datetime-local"
                className={inputCls}
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-500">指定场景 *（多选）</label>
              <div className="flex flex-wrap gap-3">
                {scenarios.length === 0 && (
                  <span className="text-xs text-slate-400">暂无场景数据</span>
                )}
                {scenarios.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.scenarioIds.includes(s.id)}
                      onChange={() => toggleId('scenarioIds', s.id)}
                      className="accent-[#0d5e63]"
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-500">考核名单 *（学员多选）</label>
              <div className="flex flex-wrap gap-3">
                {trainees.length === 0 && (
                  <span className="text-xs text-slate-400">暂无学员数据</span>
                )}
                {trainees.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.userIds.includes(t.id)}
                      onChange={() => toggleId('userIds', t.id)}
                      className="accent-[#0d5e63]"
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          {formError && <p className="mt-3 text-xs text-red-600">{formError}</p>}
          <div className="mt-4">
            <button
              onClick={submitCreate}
              disabled={submitting}
              className="rounded-lg bg-[#0d5e63] px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? '提交中…' : '创建窗口（草稿）'}
            </button>
          </div>
        </div>
      )}

      {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

      {selected && (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            {/* 开窗设置 */}
            <div className="rounded-2xl bg-white p-6 shadow-sm lg:col-span-2">
              <div className="flex items-center gap-2">
                <CalendarIcon />
                <h2 className="text-base font-bold text-slate-800">开窗设置</h2>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {examFields.map((field) => (
                  <div key={field.label} className="rounded-xl border border-slate-200 px-4 py-3">
                    <p className="text-xs text-slate-400">{field.label}</p>
                    <p className="mt-1.5 font-bold text-[#17191F]">{field.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex gap-3">
                {next && (
                  <button
                    onClick={advanceStatus}
                    className="rounded-lg bg-[#0d5e63] px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    {next.label}
                  </button>
                )}
                <button
                  onClick={() => {
                    downloadCsv(selected).catch(() => window.alert('导出失败，请稍后重试'));
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-6 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  导出成绩 CSV
                </button>
              </div>
            </div>

            {/* 名单进度 */}
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-base font-bold text-slate-800">名单进度</h2>
              <p className="mt-4">
                <span className="text-4xl font-bold text-[#0d5e63]">{completedCount}</span>
                <span className="text-sm text-slate-500"> /{progress.length} 已完成</span>
              </p>
              <div className="mt-6 space-y-3">
                {roster.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between rounded-xl bg-[#e3edf0] px-4 py-3"
                  >
                    <span className="text-sm text-slate-600">{row.label}</span>
                    <span className={`text-sm font-bold ${row.color}`}>{row.count} 人</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 名单明细 */}
          <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
            {progress.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">该窗口暂无名单进度数据</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-gray-500">
                      <th className="px-4 py-2.5 font-medium">姓名</th>
                      <th className="px-4 py-2.5 font-medium">场景进度</th>
                      <th className="px-4 py-2.5 font-medium">最好成绩</th>
                      <th className="px-4 py-2.5 font-medium">是否通过</th>
                      <th className="px-4 py-2.5 font-medium">证书时间</th>
                      <th className="px-4 py-2.5 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progress.map((p) => (
                      <tr key={p.userId} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium">{p.userName}</td>
                        <td className="px-4 py-2.5">
                          {p.completedScenarios}/{p.totalScenarios}
                        </td>
                        <td className="px-4 py-2.5">{p.bestScore ?? '-'}</td>
                        <td
                          className={`px-4 py-2.5 font-medium ${
                            p.passed ? 'text-emerald-600' : 'text-slate-500'
                          }`}
                        >
                          {p.passed ? '是' : '否'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {p.passedAt ? fmtTime(p.passedAt) : '-'}
                        </td>
                        <td className="px-4 py-2.5">{ROSTER_STATUS_LABELS[p.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
