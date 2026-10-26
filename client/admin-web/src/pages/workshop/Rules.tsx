import { Fragment, useCallback, useEffect, useState } from 'react';
import api from '../../api';

interface ScoreLevel {
  key: string;
  label: string;
  score: number;
  description: string;
}

interface ScoreItemDef {
  id: string;
  tenantId: string;
  skillPointId: string;
  name: string;
  behaviorAnchor: string;
  judgePrompt: string;
  weight: number;
  levels: ScoreLevel[];
  layer: 'company' | 'team' | 'personal';
  isObservation: boolean;
}

const LAYER_LABELS: Record<ScoreItemDef['layer'], string> = {
  company: '公司层',
  team: '团队层',
  personal: '个人层',
};

interface FormState {
  id: string;
  skillPointId: string;
  name: string;
  behaviorAnchor: string;
  judgePrompt: string;
  weight: string;
  layer: ScoreItemDef['layer'];
  isObservation: boolean;
  levels: ScoreLevel[];
}

const emptyLevel = (): ScoreLevel => ({ key: '', label: '', score: 0, description: '' });

const emptyForm = (): FormState => ({
  id: '',
  skillPointId: '',
  name: '',
  behaviorAnchor: '',
  judgePrompt: '',
  weight: '1',
  layer: 'company',
  isObservation: false,
  levels: [emptyLevel()],
});

export default function Rules() {
  const [items, setItems] = useState<ScoreItemDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [expandedId, setExpandedId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get<{ items: ScoreItemDef[] }>('/workshop/score-items');
      setItems(res.data?.items ?? []);
    } catch {
      setLoadError('加载数据失败，请确认后端服务已启动');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openCreate = () => {
    setForm(emptyForm());
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (item: ScoreItemDef) => {
    setForm({
      id: item.id,
      skillPointId: item.skillPointId,
      name: item.name,
      behaviorAnchor: item.behaviorAnchor,
      judgePrompt: item.judgePrompt,
      weight: String(item.weight),
      layer: item.layer,
      isObservation: item.isObservation,
      levels: item.levels.map((l) => ({ ...l })),
    });
    setFormError('');
    setShowForm(true);
  };

  const updateLevel = (idx: number, patch: Partial<ScoreLevel>) => {
    setForm((f) => ({
      ...f,
      levels: f.levels.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  };

  const submit = async () => {
    if (!form.name.trim()) return setFormError('请填写评分项名称');
    if (!form.skillPointId.trim()) return setFormError('请填写技能点 ID');
    const weight = Number(form.weight);
    if (!Number.isFinite(weight) || weight <= 0) return setFormError('权重需为正数');
    const levels = form.levels.filter((l) => l.key.trim() && l.label.trim());
    if (levels.length === 0) return setFormError('至少需要一个有效档位（key 与名称必填）');

    setSubmitting(true);
    setFormError('');
    try {
      await api.post('/workshop/score-items', {
        id: form.id || `item-${Date.now()}`,
        skillPointId: form.skillPointId.trim(),
        name: form.name.trim(),
        behaviorAnchor: form.behaviorAnchor,
        judgePrompt: form.judgePrompt,
        weight,
        levels,
        layer: form.layer,
        isObservation: form.isObservation,
      });
      setForm(emptyForm());
      setShowForm(false);
      await loadAll();
    } catch {
      setFormError('保存失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold">评分规则</h1>
        <button
          onClick={() => (showForm ? setShowForm(false) : openCreate())}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? '收起' : '新建评分项'}
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        评分规则编译器（简版）：导入制度手册 → 生成评分项草稿 → 人工校订 → 关联回归用例。此处维护校订后的评分项定义。
      </p>

      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <p className="text-sm font-medium mb-3">{form.id ? `编辑评分项（${form.id}）` : '新建评分项'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">名称 *</label>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：异议首反应"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">技能点 ID *</label>
              <input
                className={inputCls}
                value={form.skillPointId}
                onChange={(e) => setForm({ ...form, skillPointId: e.target.value })}
                placeholder="例如：sp-objection"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">层级</label>
              <select
                className={inputCls}
                value={form.layer}
                onChange={(e) =>
                  setForm({ ...form, layer: e.target.value as ScoreItemDef['layer'] })
                }
              >
                <option value="company">公司层</option>
                <option value="team">团队层</option>
                <option value="personal">个人层</option>
              </select>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">权重 *</label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  className={inputCls}
                  value={form.weight}
                  onChange={(e) => setForm({ ...form, weight: e.target.value })}
                />
              </div>
              <label className="flex items-end gap-1.5 text-sm cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={form.isObservation}
                  onChange={(e) => setForm({ ...form, isObservation: e.target.checked })}
                  className="accent-blue-600"
                />
                观察项（不计分）
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">行为锚点</label>
              <input
                className={inputCls}
                value={form.behaviorAnchor}
                onChange={(e) => setForm({ ...form, behaviorAnchor: e.target.value })}
                placeholder="一句话描述该评分项观察的行为"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">判定提示词（judgePrompt）</label>
              <textarea
                className={`${inputCls} h-20`}
                value={form.judgePrompt}
                onChange={(e) => setForm({ ...form, judgePrompt: e.target.value })}
                placeholder="给评分模型的判定指令"
              />
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">档位（levels）*</label>
                <button
                  onClick={() => setForm((f) => ({ ...f, levels: [...f.levels, emptyLevel()] }))}
                  className="px-2 py-1 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50"
                >
                  加一档
                </button>
              </div>
              <div className="space-y-2">
                {form.levels.map((l, i) => (
                  <div key={i} className="flex flex-wrap gap-2 items-center">
                    <input
                      className={`${inputCls} w-24`}
                      value={l.key}
                      onChange={(e) => updateLevel(i, { key: e.target.value })}
                      placeholder="key"
                    />
                    <input
                      className={`${inputCls} w-24`}
                      value={l.label}
                      onChange={(e) => updateLevel(i, { label: e.target.value })}
                      placeholder="名称"
                    />
                    <input
                      type="number"
                      className={`${inputCls} w-24`}
                      value={l.score}
                      onChange={(e) => updateLevel(i, { score: Number(e.target.value) || 0 })}
                      placeholder="分值"
                    />
                    <input
                      className={inputCls}
                      value={l.description}
                      onChange={(e) => updateLevel(i, { description: e.target.value })}
                      placeholder="档位描述"
                    />
                    <button
                      onClick={() =>
                        setForm((f) => ({ ...f, levels: f.levels.filter((_, j) => j !== i) }))
                      }
                      className="shrink-0 px-2 py-1 rounded border border-gray-300 text-gray-400 text-xs hover:bg-gray-50"
                    >
                      删
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {formError && <p className="text-xs text-red-600 mt-3">{formError}</p>}
          <div className="mt-4">
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '提交中…' : '保存评分项'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="text-sm text-gray-500 py-12 text-center">加载中…</p>
        ) : loadError && items.length === 0 ? (
          <p className="text-sm text-red-600 py-12 text-center">{loadError}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">
            暂无评分项，点击右上角「新建评分项」创建
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-4 py-2.5 font-medium">名称</th>
                <th className="px-4 py-2.5 font-medium">技能点</th>
                <th className="px-4 py-2.5 font-medium">层级</th>
                <th className="px-4 py-2.5 font-medium">权重</th>
                <th className="px-4 py-2.5 font-medium">观察项</th>
                <th className="px-4 py-2.5 font-medium">档位数</th>
                <th className="px-4 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const expanded = expandedId === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr
                      className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedId(expanded ? '' : item.id)}
                    >
                      <td className="px-4 py-2.5 font-medium">{item.name}</td>
                      <td className="px-4 py-2.5 text-gray-600">{item.skillPointId}</td>
                      <td className="px-4 py-2.5">{LAYER_LABELS[item.layer] ?? item.layer}</td>
                      <td className="px-4 py-2.5">{item.weight}</td>
                      <td className="px-4 py-2.5">
                        {item.isObservation ? (
                          <span className="px-2 py-0.5 rounded text-xs bg-yellow-50 text-yellow-700">
                            观察项
                          </span>
                        ) : (
                          <span className="text-gray-400">否</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">{item.levels.length}</td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(item);
                          }}
                          className="px-3 py-1 rounded border border-blue-600 text-blue-600 text-xs hover:bg-blue-50"
                        >
                          编辑
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-gray-100 bg-gray-50">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="space-y-2 text-sm">
                            <p>
                              <span className="text-xs text-gray-500">行为锚点：</span>
                              {item.behaviorAnchor || '-'}
                            </p>
                            <p>
                              <span className="text-xs text-gray-500">判定提示词：</span>
                              <span className="text-gray-600">{item.judgePrompt || '-'}</span>
                            </p>
                            <div>
                              <p className="text-xs text-gray-500 mb-1">档位：</p>
                              <table className="w-full text-sm bg-white rounded border border-gray-200">
                                <thead>
                                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                                    <th className="px-4 py-2 font-medium">key</th>
                                    <th className="px-4 py-2 font-medium">名称</th>
                                    <th className="px-4 py-2 font-medium">分值</th>
                                    <th className="px-4 py-2 font-medium">描述</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {item.levels.map((l) => (
                                    <tr key={l.key} className="border-t border-gray-100">
                                      <td className="px-4 py-2 text-gray-600">{l.key}</td>
                                      <td className="px-4 py-2 font-medium">{l.label}</td>
                                      <td className="px-4 py-2">{l.score}</td>
                                      <td className="px-4 py-2 text-gray-600">{l.description}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
