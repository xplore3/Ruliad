import { useCallback, useEffect, useState } from 'react';
import api from '../../api';

interface QuizQuestion {
  id: string;
  scenarioId?: string;
  skillPointId?: string;
  type: 'single_choice' | 'multi_choice' | 'true_false' | 'short_answer' | 'scenario_pick';
  prompt: string;
  options?: { id: string; label: string }[];
  correctAnswer: string[] | string;
  referencePoints?: string[];
  explanation: string;
  score: number;
  trigger: { kind: string; afterNTurns?: number; keywords?: string[]; topic?: string; seconds?: number };
  required: boolean;
}

interface Scenario {
  id: string;
  name: string;
}

const emptyForm: Partial<QuizQuestion> = {
  type: 'single_choice',
  prompt: '',
  options: [{ id: 'A', label: '' }, { id: 'B', label: '' }],
  correctAnswer: [],
  explanation: '',
  score: 10,
  trigger: { kind: 'manual' },
  required: false,
};

export default function QuizQuestions() {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<QuizQuestion>>(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, sRes] = await Promise.all([
        api.get<{ questions: QuizQuestion[] }>('/workshop/quiz-questions'),
        api.get<{ scenarios: Scenario[] }>('/scenarios'),
      ]);
      setQuestions(qRes.data.questions ?? []);
      setScenarios(sRes.data.scenarios ?? []);
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
    setShowForm(true);
  };

  const startEdit = (q: QuizQuestion) => {
    setEditingId(q.id);
    setForm({ ...q });
    setError('');
    setShowForm(true);
  };

  const submit = async () => {
    if (!form.prompt?.trim()) return setError('请填写题干');
    if (!form.type) return setError('请选择题型');
    setSubmitting(true);
    setError('');
    try {
      if (editingId) {
        await api.put(`/workshop/quiz-questions/${editingId}`, form);
      } else {
        await api.post('/workshop/quiz-questions', form);
      }
      setShowForm(false);
      await loadAll();
    } catch {
      setError('保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const del = async (id: string) => {
    if (!window.confirm('确认删除？')) return;
    try {
      await api.delete(`/workshop/quiz-questions/${id}`);
      await loadAll();
    } catch {
      window.alert('删除失败');
    }
  };

  const inputCls = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500';

  const typeLabels: Record<string, string> = {
    single_choice: '单选题',
    multi_choice: '多选题',
    true_false: '判断题',
    short_answer: '简答题',
    scenario_pick: '情境选择',
  };

  const triggerLabels: Record<string, string> = {
    turn_count: '第N轮后',
    keyword_hit: '关键词命中',
    topic_covered: '话题覆盖后',
    time_elapsed: 'N秒后',
    manual: '手动触发',
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">考题管理</h1>
          <p className="mt-1 text-sm text-slate-500">配置对练过程中自动触发的考题，支持选择题/判断题/简答题</p>
        </div>
        <button
          onClick={() => (showForm ? setShowForm(false) : startCreate())}
          className="rounded-full border border-[#0d5e63] px-4 py-1.5 text-sm font-medium text-[#0d5e63] hover:bg-[#0d5e63]/5"
        >
          {showForm ? '收起' : '+ 新建考题'}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-slate-200 p-5">
          <p className="mb-4 text-sm font-bold text-slate-700">{editingId ? '编辑考题' : '新建考题'}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-500">题干 *</label>
              <textarea className={inputCls} rows={2} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">题型 *</label>
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as QuizQuestion['type'] })}>
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">绑定场景</label>
              <select className={inputCls} value={form.scenarioId ?? ''} onChange={(e) => setForm({ ...form, scenarioId: e.target.value || undefined })}>
                <option value="">全场景通用</option>
                {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">分值</label>
              <input type="number" className={inputCls} value={form.score} onChange={(e) => setForm({ ...form, score: Number(e.target.value) })} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">是否必答</label>
              <select className={inputCls} value={String(form.required)} onChange={(e) => setForm({ ...form, required: e.target.value === 'true' })}>
                <option value="false">否</option>
                <option value="true">是</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">触发条件</label>
              <select className={inputCls} value={form.trigger?.kind ?? 'manual'} onChange={(e) => {
                const kind = e.target.value;
                const trigger = { kind } as QuizQuestion['trigger'];
                if (kind === 'turn_count') trigger.afterNTurns = 3;
                if (kind === 'keyword_hit') trigger.keywords = [];
                if (kind === 'topic_covered') trigger.topic = '';
                if (kind === 'time_elapsed') trigger.seconds = 300;
                setForm({ ...form, trigger });
              }}>
                {Object.entries(triggerLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {form.trigger?.kind === 'turn_count' && (
              <div>
                <label className="mb-1 block text-xs text-slate-500">第几轮后触发</label>
                <input type="number" className={inputCls} value={form.trigger.afterNTurns} onChange={(e) => setForm({ ...form, trigger: { kind: 'turn_count', afterNTurns: Number(e.target.value) } as QuizQuestion['trigger'] })} />
              </div>
            )}
            {form.trigger?.kind === 'keyword_hit' && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-500">关键词（逗号分隔）</label>
                <input className={inputCls} value={(form.trigger.keywords ?? []).join(',')} onChange={(e) => setForm({ ...form, trigger: { kind: 'keyword_hit', keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } as QuizQuestion['trigger'] })} />
              </div>
            )}
            {form.trigger?.kind === 'topic_covered' && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-500">话题名称</label>
                <input className={inputCls} value={form.trigger.topic ?? ''} onChange={(e) => setForm({ ...form, trigger: { kind: 'topic_covered', topic: e.target.value } as QuizQuestion['trigger'] })} />
              </div>
            )}
            {form.trigger?.kind === 'time_elapsed' && (
              <div>
                <label className="mb-1 block text-xs text-slate-500">秒数</label>
                <input type="number" className={inputCls} value={form.trigger.seconds} onChange={(e) => setForm({ ...form, trigger: { kind: 'time_elapsed', seconds: Number(e.target.value) } as QuizQuestion['trigger'] })} />
              </div>
            )}

            {/* 选项编辑（选择题/判断题） */}
            {(form.type === 'single_choice' || form.type === 'multi_choice' || form.type === 'true_false' || form.type === 'scenario_pick') && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-500">选项</label>
                <div className="space-y-2">
                  {(form.options ?? []).map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input className="w-20 rounded border border-slate-300 px-2 py-1 text-xs" value={opt.id} onChange={(e) => {
                        const opts = [...(form.options ?? [])];
                        opts[i] = { ...opt, id: e.target.value };
                        setForm({ ...form, options: opts });
                      }} />
                      <input className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs" value={opt.label} placeholder="选项内容" onChange={(e) => {
                        const opts = [...(form.options ?? [])];
                        opts[i] = { ...opt, label: e.target.value };
                        setForm({ ...form, options: opts });
                      }} />
                      <button className="text-xs text-rose-500 hover:underline" onClick={() => setForm({ ...form, options: (form.options ?? []).filter((_, bi) => bi !== i) })}>删除</button>
                    </div>
                  ))}
                  <button className="text-xs font-medium text-[#0d5e63] hover:underline" onClick={() => setForm({ ...form, options: [...(form.options ?? []), { id: String.fromCharCode(65 + (form.options?.length ?? 0)), label: '' }] })}>+ 添加选项</button>
                </div>
                <label className="mt-2 block text-xs text-slate-500">正确答案（选项ID，逗号分隔）</label>
                <input className={inputCls} value={Array.isArray(form.correctAnswer) ? form.correctAnswer.join(',') : form.correctAnswer} onChange={(e) => setForm({ ...form, correctAnswer: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
              </div>
            )}

            {/* 简答题参考要点 */}
            {(form.type === 'short_answer' || form.type === 'scenario_pick') && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-500">参考答案要点（换行分隔）</label>
                <textarea className={inputCls} rows={3} value={(form.referencePoints ?? []).join('\n')} onChange={(e) => setForm({ ...form, referencePoints: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} />
              </div>
            )}

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-500">解析</label>
              <textarea className={inputCls} rows={2} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
            </div>
          </div>
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          <div className="mt-4">
            <button onClick={submit} disabled={submitting} className="rounded-lg bg-[#0d5e63] px-6 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {submitting ? '提交中…' : editingId ? '保存修改' : '创建考题'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-slate-400">加载中…</p>
      ) : questions.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">暂无考题，点击「新建考题」创建</p>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => {
            const scenarioName = scenarios.find(s => s.id === q.scenarioId)?.name ?? '全场景通用';
            return (
              <div key={q.id} className="rounded-xl border border-slate-200 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">{typeLabels[q.type]}</span>
                      <span className="text-xs text-slate-400">{scenarioName}</span>
                      {q.required && <span className="text-xs text-rose-500">必答</span>}
                      <span className="text-xs text-slate-400">{q.score}分</span>
                      <span className="text-xs text-slate-400">{triggerLabels[q.trigger.kind]}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-700">{q.prompt}</p>
                    <p className="mt-1 text-xs text-slate-400">{q.explanation}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(q)} className="rounded-full bg-[#e3edf0] px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-[#d5e4e8]">编辑</button>
                    <button onClick={() => del(q.id)} className="rounded-full px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50">删除</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
