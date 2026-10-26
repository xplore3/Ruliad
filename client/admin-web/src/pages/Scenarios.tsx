import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { AdminSectionTabs } from '../components/Layout';

interface Scenario {
  id: string;
  name: string;
  personaConfigId: string;
  skillPointIds: string[];
  successCriteria?: { passScore?: number };
  durationMinutes: number;
  difficulty?: number;
  personaName?: string;
  skillPointNames?: string[];
}

interface PersonaConfig {
  id: string;
  name: string;
  background?: string;
  age?: number;
  occupation?: string;
}

interface SkillPoint {
  id: string;
  name: string;
  description?: string;
}

interface FormState {
  name: string;
  personaConfigId: string;
  skillPointIds: string[];
  passScore: string;
  durationMinutes: string;
  difficulty: string;
  coverageTopics: string;
}

const emptyForm: FormState = {
  name: '',
  personaConfigId: '',
  skillPointIds: [],
  passScore: '60',
  durationMinutes: '10',
  difficulty: '1',
  coverageTopics: '',
};

export default function Scenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [personas, setPersonas] = useState<PersonaConfig[]>([]);
  const [skillPoints, setSkillPoints] = useState<SkillPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [s, p, sp] = await Promise.all([
        api.get<Scenario[] | { scenarios?: Scenario[] }>('/scenarios'),
        api.get<PersonaConfig[] | { personaConfigs?: PersonaConfig[] }>('/persona-configs'),
        api.get<SkillPoint[] | { skillPoints?: SkillPoint[] }>('/skill-points'),
      ]);
      setScenarios(Array.isArray(s.data) ? s.data : (s.data?.scenarios ?? []));
      setPersonas(Array.isArray(p.data) ? p.data : (p.data?.personaConfigs ?? []));
      setSkillPoints(Array.isArray(sp.data) ? sp.data : (sp.data?.skillPoints ?? []));
    } catch {
      setLoadError('加载数据失败，请确认后端服务已启动');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const toggleSkillPoint = (id: string) => {
    setForm((f) => ({
      ...f,
      skillPointIds: f.skillPointIds.includes(id)
        ? f.skillPointIds.filter((x) => x !== id)
        : [...f.skillPointIds, id],
    }));
  };

  const submit = async () => {
    const passScore = Number(form.passScore);
    const durationMinutes = Number(form.durationMinutes);
    const difficulty = Number(form.difficulty) || 1;
    if (!form.name.trim()) return setFormError('请填写场景名');
    if (!form.personaConfigId) return setFormError('请选择陪练员');
    if (form.skillPointIds.length === 0) return setFormError('请至少选择一个技能点');
    if (!Number.isFinite(passScore) || passScore < 0 || passScore > 100)
      return setFormError('达标线需为 0-100 的数字');
    if (!Number.isFinite(durationMinutes) || durationMinutes < 8 || durationMinutes > 15)
      return setFormError('时长需为 8-15 分钟');
    if (difficulty < 1 || difficulty > 5) return setFormError('难度需为 1-5');

    setSubmitting(true);
    setFormError('');
    try {
      const coverageTopics = form.coverageTopics
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await api.post('/scenarios', {
        name: form.name.trim(),
        personaConfigId: form.personaConfigId,
        skillPointIds: form.skillPointIds,
        passScore,
        durationMinutes,
        difficulty,
        ...(coverageTopics.length > 0 ? { coverageTopics } : {}),
      });
      setForm(emptyForm);
      setShowForm(false);
      await loadAll();
    } catch {
      setFormError('创建失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  return (
    <div>
      <AdminSectionTabs />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">场景配置</h1>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setFormError('');
          }}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? '收起' : '新建场景'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">场景名 *</label>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：价格异议处理"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">陪练员 *</label>
              <select
                className={inputCls}
                value={form.personaConfigId}
                onChange={(e) => setForm({ ...form, personaConfigId: e.target.value })}
              >
                <option value="">请选择</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.occupation ? `（${p.occupation}）` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">技能点 *（多选）</label>
              <div className="flex flex-wrap gap-3">
                {skillPoints.length === 0 && (
                  <span className="text-xs text-gray-400">暂无技能点数据</span>
                )}
                {skillPoints.map((sp) => (
                  <label key={sp.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.skillPointIds.includes(sp.id)}
                      onChange={() => toggleSkillPoint(sp.id)}
                      className="accent-blue-600"
                    />
                    {sp.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">达标线（0-100）*</label>
              <input
                type="number"
                min={0}
                max={100}
                className={inputCls}
                value={form.passScore}
                onChange={(e) => setForm({ ...form, passScore: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">时长（分钟，8-15）*</label>
              <input
                type="number"
                min={8}
                max={15}
                className={inputCls}
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">难度（1-5）</label>
              <input
                type="number"
                min={1}
                max={5}
                className={inputCls}
                value={form.difficulty}
                onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">覆盖话题（逗号分隔，可空）</label>
              <input
                className={inputCls}
                value={form.coverageTopics}
                onChange={(e) => setForm({ ...form, coverageTopics: e.target.value })}
                placeholder="例如：价格异议, 竞品对比"
              />
            </div>
          </div>
          {formError && <p className="text-xs text-red-600 mt-3">{formError}</p>}
          <div className="mt-4">
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '提交中…' : '创建场景'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="text-sm text-gray-500 py-12 text-center">加载中…</p>
        ) : loadError ? (
          <p className="text-sm text-red-600 py-12 text-center">{loadError}</p>
        ) : scenarios.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">暂无场景，点击右上角「新建场景」创建</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-4 py-2.5 font-medium">名称</th>
                <th className="px-4 py-2.5 font-medium">陪练员</th>
                <th className="px-4 py-2.5 font-medium">技能点</th>
                <th className="px-4 py-2.5 font-medium">达标线</th>
                <th className="px-4 py-2.5 font-medium">时长</th>
                <th className="px-4 py-2.5 font-medium">难度</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{s.name}</td>
                  <td className="px-4 py-2.5">{s.personaName ?? '-'}</td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {s.skillPointNames?.length ? s.skillPointNames.join('、') : '-'}
                  </td>
                  <td className="px-4 py-2.5">{s.successCriteria?.passScore ?? '-'}</td>
                  <td className="px-4 py-2.5">{s.durationMinutes} 分钟</td>
                  <td className="px-4 py-2.5">{s.difficulty ?? 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
