import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api';
import { AdminSectionTabs } from '../components/Layout';

interface Scenario {
  id: string;
  name: string;
  successCriteria?: { passScore?: number };
  durationMinutes: number;
  difficulty?: number;
  personaName?: string | null;
  skillPointNames?: string[];
}

interface PathItem {
  scenarioId: string;
  passScore: number;
  order: number;
  /** GET /learning-paths 附带 */
  scenarioName?: string;
}

interface LearningPath {
  id: string;
  name: string;
  items: PathItem[];
  assignedTeamIds: string[];
  /** GET /learning-paths 附带 */
  assignedTeamNames?: string[];
}

interface Team {
  id: string;
  name: string;
  memberCount: number;
}

interface Organization {
  orgId: string;
  orgName: string;
  teams: Team[];
}

/** 编辑器中的路径步骤（场景名冗余一份便于展示） */
interface EditorItem {
  scenarioId: string;
  scenarioName: string;
  passScore: number;
}

export default function Paths() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  // 当前编辑的路径：null 表示新建
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [items, setItems] = useState<EditorItem[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const scenarioNameOf = useCallback(
    (id: string) => scenarios.find((s) => s.id === id)?.name ?? id,
    [scenarios]
  );

  const editingPath = useMemo(
    () => paths.find((p) => p.id === editingId) ?? null,
    [paths, editingId]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [s, p, t] = await Promise.all([
        api.get<{ scenarios: Scenario[] }>('/scenarios'),
        api.get<{ learningPaths: LearningPath[] }>('/learning-paths'),
        api.get<{ organizations: Organization[] }>('/teams'),
      ]);
      setScenarios(s.data.scenarios ?? []);
      setPaths(p.data.learningPaths ?? []);
      setOrgs(t.data.organizations ?? []);
    } catch {
      setLoadError('加载数据失败，请确认后端服务已启动');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /** 选中某条已有路径进入编辑 */
  const editPath = (path: LearningPath) => {
    setEditingId(path.id);
    setName(path.name);
    setItems(
      [...path.items]
        .sort((a, b) => a.order - b.order)
        .map((item) => ({
          scenarioId: item.scenarioId,
          scenarioName: item.scenarioName ?? scenarioNameOf(item.scenarioId),
          passScore: item.passScore,
        }))
    );
    setTeamIds(path.assignedTeamIds);
    setFormError('');
    setNotice('');
  };

  const resetEditor = () => {
    setEditingId(null);
    setName('');
    setItems([]);
    setTeamIds([]);
    setFormError('');
    setNotice('');
  };

  const addScenario = (s: Scenario) => {
    if (items.some((i) => i.scenarioId === s.id)) {
      setFormError(`场景「${s.name}」已在路径中`);
      return;
    }
    setFormError('');
    setItems((prev) => [
      ...prev,
      {
        scenarioId: s.id,
        scenarioName: s.name,
        passScore: s.successCriteria?.passScore ?? 60,
      },
    ]);
  };

  const moveItem = (index: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const savePath = async () => {
    if (!name.trim()) return setFormError('请填写路径名称');
    if (items.length === 0) return setFormError('请至少加入一个场景');
    setSubmitting(true);
    setFormError('');
    setNotice('');
    const body = {
      name: name.trim(),
      items: items.map((item, i) => ({
        scenarioId: item.scenarioId,
        passScore: item.passScore,
        order: i + 1,
      })),
    };
    try {
      if (editingId) {
        await api.put(`/learning-paths/${editingId}`, body);
      } else {
        const res = await api.post<LearningPath>('/learning-paths', body);
        setEditingId(res.data.id);
      }
      setNotice('路径已保存');
      await loadAll();
    } catch {
      setFormError('保存失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const saveAssign = async () => {
    if (!editingId) return setFormError('请先保存路径，再分配团队');
    setSubmitting(true);
    setFormError('');
    setNotice('');
    try {
      await api.post(`/learning-paths/${editingId}/assign`, { teamIds });
      setNotice('分配已保存');
      await loadAll();
    } catch {
      setFormError('分配失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTeam = (id: string) => {
    setTeamIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const inputCls =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  return (
    <div>
      <AdminSectionTabs />

      {/* 页面标题 + 导出按钮 */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#17191F]">管理后台</h1>
          <p className="mt-2 text-sm text-slate-500">培训管理员（冠军）· 华东制药事业部</p>
        </div>
        <button className="flex items-center gap-2 rounded-full bg-[#0d5e63] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#0a4c50]">
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4"
            />
          </svg>
          导出冠军汇报包（PPT）
        </button>
      </div>

      {loadError && <p className="mb-4 text-sm text-red-600">{loadError}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        {/* 场景库 */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-bold text-[#17191F]">场景库</h2>
          {loading ? (
            <p className="py-12 text-center text-sm text-slate-400">加载中…</p>
          ) : scenarios.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">暂无场景数据</p>
          ) : (
            <div className="space-y-4">
              {scenarios.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-6 py-5"
                >
                  <div>
                    <p className="text-base font-bold text-[#17191F]">{s.name}</p>
                    <p className="mt-1.5 text-sm text-slate-500">
                      技能点：{s.skillPointNames?.length ? s.skillPointNames.join('、') : '—'} ·
                      难度 L{s.difficulty ?? 1} · {s.durationMinutes} 分钟
                      {s.personaName ? ` · 陪练员：${s.personaName}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => addScenario(s)}
                    className="shrink-0 rounded-full bg-[#e3edf0] px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-[#d5e4e8]"
                  >
                    + 加入路径
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 学习路径编辑器 */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[#17191F]">
              学习路径{editingPath ? `：${editingPath.name}` : ''}
            </h2>
            <button
              onClick={resetEditor}
              className="shrink-0 rounded-full border border-[#0d5e63] px-3 py-1.5 text-xs font-medium text-[#0d5e63] transition-colors hover:bg-[#0d5e63]/5"
            >
              + 新建路径
            </button>
          </div>

          {/* 已有路径选择 */}
          {paths.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {paths.map((p) => (
                <button
                  key={p.id}
                  onClick={() => editPath(p)}
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                    p.id === editingId
                      ? 'bg-[#0d5e63] font-bold text-white'
                      : 'bg-[#e3edf0] font-medium text-slate-600 hover:bg-[#d5e4e8]'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-xs text-slate-500">路径名称 *</label>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：新人首月认证包"
            />
          </div>

          <div className="space-y-4">
            {items.length === 0 && (
              <p className="rounded-xl bg-[#e3edf0] px-5 py-4 text-sm text-slate-500">
                从左侧场景库点击「+ 加入路径」添加步骤
              </p>
            )}
            {items.map((item, i) => (
              <div
                key={item.scenarioId}
                className="flex items-center gap-4 rounded-xl bg-[#e3edf0] px-5 py-4"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0d5e63] text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {item.scenarioName}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>达标线</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={item.passScore}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((x, xi) =>
                            xi === i ? { ...x, passScore: Number(e.target.value) } : x
                          )
                        )
                      }
                      className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                    />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    onClick={() => moveItem(i, -1)}
                    disabled={i === 0}
                    className="rounded px-1.5 text-xs text-slate-500 hover:bg-white disabled:opacity-30"
                    title="上移"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveItem(i, 1)}
                    disabled={i === items.length - 1}
                    className="rounded px-1.5 text-xs text-slate-500 hover:bg-white disabled:opacity-30"
                    title="下移"
                  >
                    ↓
                  </button>
                </div>
                <button
                  onClick={() =>
                    setItems((prev) => prev.filter((x) => x.scenarioId !== item.scenarioId))
                  }
                  className="shrink-0 text-xs text-rose-500 hover:underline"
                >
                  移除
                </button>
              </div>
            ))}

            {/* 团队分配 */}
            <div className="rounded-xl bg-[#f6ead3] px-5 py-4">
              <div className="flex items-center gap-3">
                <svg
                  className="h-5 w-5 shrink-0 text-[#17191F]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17 20h5v-1a4 4 0 00-3-3.87M9 20H4v-1a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4m4 4a4 4 0 01-4-4m4 4v.01"
                  />
                </svg>
                <span className="text-sm font-medium text-slate-800">
                  已分配人群：
                  {editingPath?.assignedTeamNames?.length
                    ? editingPath.assignedTeamNames.join('、')
                    : '未分配'}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {orgs.map((org) => (
                  <div key={org.orgId}>
                    <p className="text-xs font-medium text-slate-500">{org.orgName}</p>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {org.teams.map((team) => (
                        <label
                          key={team.id}
                          className="flex cursor-pointer items-center gap-1.5 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={teamIds.includes(team.id)}
                            onChange={() => toggleTeam(team.id)}
                            className="accent-[#0d5e63]"
                          />
                          {team.name}（{team.memberCount} 人）
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {orgs.length === 0 && (
                  <p className="text-xs text-slate-400">暂无组织/团队数据</p>
                )}
              </div>
            </div>
          </div>

          {formError && <p className="mt-3 text-xs text-red-600">{formError}</p>}
          {notice && <p className="mt-3 text-xs text-emerald-600">{notice}</p>}

          <div className="mt-6 flex gap-3">
            <button
              onClick={savePath}
              disabled={submitting}
              className="rounded-lg bg-[#0d5e63] px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? '提交中…' : editingId ? '保存路径' : '创建路径'}
            </button>
            <button
              onClick={saveAssign}
              disabled={submitting || !editingId}
              className="rounded-lg border border-slate-200 bg-white px-6 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              保存分配
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
