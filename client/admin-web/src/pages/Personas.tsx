﻿import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { AdminSectionTabs } from '../components/Layout';
import { exportChampionReport } from '../report';

interface TrialMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface BehaviorBand {
  key: string;
  instruction: string;
  minArousal: number;
  maxArousal: number;
}

interface PersonaConfig {
  id: string;
  name: string;
  background: string;
  age?: number;
  occupation?: string;
  productKBId?: string;
  behaviorBands: BehaviorBand[];
  version: number;
  sourceMeta?: {
    archetype?: string;
    recordings: number;
    recordingsKind?: string;
    lastCalibrated: string;
    stale?: boolean;
    calibrationStatus?: string;
  };
}

interface Workflow {
  title: string;
  desc: string;
}

/** 需求工单流程说明（设计图静态数据；工单后端接口尚未提供） */
const workflows: Workflow[] = [
  { title: '新陪练员需求', desc: '上传录音／访谈 → 平台萃取要素 → 试演调优 → 交付' },
  {
    title: '新话术版本',
    desc: '上传手册 v5 → 编译为行为锚定评分项草稿 → 人工校订 → 回归测试通过后发布',
  },
];

interface FormState {
  name: string;
  background: string;
  age: string;
  occupation: string;
  productKBId: string;
  bands: BehaviorBand[];
}

const emptyForm: FormState = {
  name: '',
  background: '',
  age: '',
  occupation: '',
  productKBId: '',
  bands: [{ key: 'calm', instruction: '', minArousal: 0, maxArousal: 1 }],
};

/** 已交付陪练员的来源信息行（优先用 sourceMeta，退化用基础字段） */
function metaOf(p: PersonaConfig): string {
  if (p.sourceMeta) {
    const m = p.sourceMeta;
    const parts = [
      `来源 ${m.recordings} 段${m.recordingsKind ?? '录音'}`,
      `最后校准 ${m.lastCalibrated}`,
    ];
    if (m.calibrationStatus) parts.push(m.calibrationStatus + (m.stale ? '（黄灯）' : ''));
    return parts.join(' · ');
  }
  return [p.occupation, p.age ? `${p.age} 岁` : null, `v${p.version}`]
    .filter(Boolean)
    .join(' · ');
}

export default function Personas() {
  const [personas, setPersonas] = useState<PersonaConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ticketHint, setTicketHint] = useState(false);
  // 陪练员试玩：试聊不落库，history 由前端随请求回传
  const [trialPersona, setTrialPersona] = useState<PersonaConfig | null>(null);
  const [trialMessages, setTrialMessages] = useState<TrialMessage[]>([]);
  const [trialInput, setTrialInput] = useState('');
  const [trialSending, setTrialSending] = useState(false);
  // 产品知识库列表
  const [productKBs, setProductKBs] = useState<{ id: string; name: string }[]>([]);

  const openTrial = (p: PersonaConfig) => {
    setTrialPersona(p);
    setTrialMessages([]);
    setTrialInput('');
  };

  const sendTrial = async () => {
    const text = trialInput.trim();
    if (!text || !trialPersona || trialSending) return;
    const history = trialMessages.slice(-10);
    setTrialMessages((m) => [...m, { role: 'user', content: text }]);
    setTrialInput('');
    setTrialSending(true);
    try {
      const res = await api.post<{ reply: string }>(
        `/persona-configs/${trialPersona.id}/trial-chat`,
        { text, history }
      );
      setTrialMessages((m) => [...m, { role: 'assistant', content: res.data.reply }]);
    } catch {
      setTrialMessages((m) => [...m, { role: 'assistant', content: '（试聊失败，请稍后重试）' }]);
    } finally {
      setTrialSending(false);
    }
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [personaRes, kbRes] = await Promise.all([
        api.get<{ personaConfigs: PersonaConfig[] }>('/persona-configs'),
        api.get<{ kb: { id: string; name: string } | null }>('/workshop/product-kb'),
      ]);
      setPersonas(personaRes.data.personaConfigs ?? []);
      setProductKBs(kbRes.data.kb ? [kbRes.data.kb] : []);
    } catch {
      setLoadError('加载陪练员数据失败，请确认后端服务已启动');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setShowForm(true);
  };

  const startEdit = (p: PersonaConfig) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      background: p.background,
      age: p.age !== undefined ? String(p.age) : '',
      occupation: p.occupation ?? '',
      productKBId: p.productKBId ?? '',
      bands:
        p.behaviorBands.length > 0
          ? p.behaviorBands.map((b) => ({ ...b }))
          : [{ key: 'calm', instruction: '', minArousal: 0, maxArousal: 1 }],
    });
    setFormError('');
    setShowForm(true);
  };

  const updateBand = (index: number, patch: Partial<BehaviorBand>) => {
    setForm((f) => ({
      ...f,
      bands: f.bands.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    }));
  };

  const submit = async () => {
    if (!form.name.trim()) return setFormError('请填写陪练员名称');
    if (!form.background.trim()) return setFormError('请填写背景简介');
    const age = form.age.trim() === '' ? undefined : Number(form.age);
    if (age !== undefined && (!Number.isFinite(age) || age <= 0))
      return setFormError('年龄须为正数');
    if (form.bands.length === 0) return setFormError('请至少保留一档行为映射');
    for (const band of form.bands) {
      if (!band.key.trim() || !band.instruction.trim())
        return setFormError('每档行为映射的档位名 / 行为指令必填');
      if (
        !Number.isFinite(band.minArousal) ||
        !Number.isFinite(band.maxArousal) ||
        band.minArousal < 0 ||
        band.maxArousal > 1 ||
        band.minArousal >= band.maxArousal
      )
        return setFormError(`档位 ${band.key} 的唤醒度区间须满足 0<=min<max<=1`);
    }

    setSubmitting(true);
    setFormError('');
    const body = {
      name: form.name.trim(),
      background: form.background.trim(),
      ...(age !== undefined ? { age } : {}),
      ...(form.occupation.trim() ? { occupation: form.occupation.trim() } : {}),
      productKBId: form.productKBId || null,
      behaviorBands: form.bands,
    };
    try {
      if (editingId) {
        await api.put(`/persona-configs/${editingId}`, body);
      } else {
        await api.post('/persona-configs', body);
      }
      setForm(emptyForm);
      setEditingId(null);
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
      {/* 页面头部：标题 + 导出按钮 */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-[#17191F]">管理后台</h1>
          <p className="mt-2 text-base text-slate-500">培训管理员（冠军）· 华东制药事业部</p>
        </div>
        <button
          onClick={() => {
            exportChampionReport().catch(() => window.alert('汇报包生成失败，请稍后重试'));
          }}
          className="flex items-center gap-2 rounded-full bg-[#0d5e63] px-7 py-3.5 text-base font-bold text-white shadow-sm transition-colors hover:bg-[#0a4c50]"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
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

      <AdminSectionTabs />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 已交付陪练员 */}
        <section className="rounded-2xl bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800">已交付陪练员</h2>
            <button
              onClick={() => (showForm ? setShowForm(false) : startCreate())}
              className="rounded-full border border-[#0d5e63] px-4 py-1.5 text-sm font-medium text-[#0d5e63] transition-colors hover:bg-[#0d5e63]/5"
            >
              {showForm ? '收起' : '+ 新建陪练员'}
            </button>
          </div>

          {/* 新建 / 编辑表单 */}
          {showForm && (
            <div className="mb-6 rounded-xl border border-slate-200 p-5">
              <p className="mb-4 text-sm font-bold text-slate-700">
                {editingId ? '编辑陪练员' : '新建陪练员'}
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">陪练员名称 *</label>
                  <input
                    className={inputCls}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="例如：陈立国"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">职业</label>
                  <input
                    className={inputCls}
                    value={form.occupation}
                    onChange={(e) => setForm({ ...form, occupation: e.target.value })}
                    placeholder="例如：内分泌科主任"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">年龄</label>
                  <input
                    type="number"
                    min={1}
                    className={inputCls}
                    value={form.age}
                    onChange={(e) => setForm({ ...form, age: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">背景简介 *</label>
                  <textarea
                    className={inputCls}
                    rows={3}
                    value={form.background}
                    onChange={(e) => setForm({ ...form, background: e.target.value })}
                    placeholder="展示给学员的陪练员背景"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">产品知识库</label>
                  <select
                    className={inputCls}
                    value={form.productKBId}
                    onChange={(e) => setForm({ ...form, productKBId: e.target.value })}
                  >
                    <option value="">不绑定（使用租户默认知识库）</option>
                    {productKBs.map((kb) => (
                      <option key={kb.id} value={kb.id}>
                        {kb.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">绑定后，陪练员将掌握产品参数、竞品对比、FAQ 并对红线话术产生情绪反应</p>
                </div>
                <div className="sm:col-span-2">
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs text-slate-500">行为映射档位 *（唤醒度区间 0-1）</label>
                    <button
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          bands: [
                            ...f.bands,
                            { key: '', instruction: '', minArousal: 0, maxArousal: 1 },
                          ],
                        }))
                      }
                      className="text-xs font-medium text-[#0d5e63] hover:underline"
                    >
                      + 添加档位
                    </button>
                  </div>
                  <div className="space-y-3">
                    {form.bands.map((band, i) => (
                      <div key={i} className="rounded-lg bg-[#e3edf0] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
                            value={band.key}
                            onChange={(e) => updateBand(i, { key: e.target.value })}
                            placeholder="档位名"
                          />
                          <input
                            type="number"
                            step={0.1}
                            min={0}
                            max={1}
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                            value={band.minArousal}
                            onChange={(e) =>
                              updateBand(i, { minArousal: Number(e.target.value) })
                            }
                            placeholder="min"
                          />
                          <span className="text-xs text-slate-400">~</span>
                          <input
                            type="number"
                            step={0.1}
                            min={0}
                            max={1}
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                            value={band.maxArousal}
                            onChange={(e) =>
                              updateBand(i, { maxArousal: Number(e.target.value) })
                            }
                            placeholder="max"
                          />
                          <button
                            onClick={() =>
                              setForm((f) => ({ ...f, bands: f.bands.filter((_, bi) => bi !== i) }))
                            }
                            className="ml-auto text-xs text-rose-500 hover:underline"
                          >
                            删除
                          </button>
                        </div>
                        <textarea
                          className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                          rows={2}
                          value={band.instruction}
                          onChange={(e) => updateBand(i, { instruction: e.target.value })}
                          placeholder="该档位注入生成的行为指令"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {formError && <p className="mt-3 text-xs text-red-600">{formError}</p>}
              <div className="mt-4">
                <button
                  onClick={submit}
                  disabled={submitting}
                  className="rounded-lg bg-[#0d5e63] px-6 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? '提交中…' : editingId ? '保存修改' : '创建陪练员'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="py-12 text-center text-sm text-slate-400">加载中…</p>
          ) : loadError ? (
            <p className="py-12 text-center text-sm text-red-600">{loadError}</p>
          ) : personas.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">暂无陪练员，点击「新建陪练员」创建</p>
          ) : (
            <div className="space-y-4">
              {personas.map((p) => (
                <div key={p.id} className="rounded-xl border border-slate-200 px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-bold text-[#17191F]">
                        {p.name}
                        {p.occupation ? ` · ${p.occupation}` : ''}
                      </p>
                      <p className="mt-1.5 text-sm text-slate-500">{metaOf(p)}</p>
                      <p className="mt-1.5 line-clamp-2 text-sm text-slate-400">{p.background}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => openTrial(p)}
                        className="rounded-full bg-[#0d5e63] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0a4c50]"
                      >
                        试玩
                      </button>
                      <button
                        onClick={() => startEdit(p)}
                        className="rounded-full bg-[#e3edf0] px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-[#d5e4e8]"
                      >
                        编辑
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 提交需求 */}
        <section className="rounded-2xl bg-white p-8 shadow-sm">
          <h2 className="mb-6 text-lg font-bold text-slate-800">提交需求（触发平台内容工坊）</h2>
          <div className="space-y-5">
            {workflows.map((w) => (
              <div key={w.title} className="rounded-xl bg-[#e3edf0] px-6 py-5">
                <p className="text-base font-bold text-slate-800">{w.title}</p>
                <p className="mt-1.5 text-sm text-slate-500">{w.desc}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => setTicketHint(true)}
            className="mt-8 w-full rounded-full bg-[#0d5e63] py-4 text-base font-bold text-white shadow-sm transition-colors hover:bg-[#0a4c50]"
          >
            新建需求工单
          </button>
          {ticketHint && (
            <p className="mt-3 text-center text-sm text-slate-500">
              👑 需求工单功能为 VIP 专属，升级 VIP 请联系：graspai@126.com
            </p>
          )}
        </section>
      </div>

      {/* 陪练员试玩弹窗：试聊不落库，不影响评分与任务 */}
      {trialPersona && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex h-[70vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-base font-bold text-[#17191F]">
                  试玩 · {trialPersona.name}
                  {trialPersona.occupation ? `（${trialPersona.occupation}）` : ''}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">试聊不会保存，也不影响任何评分</p>
              </div>
              <button
                onClick={() => setTrialPersona(null)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="关闭试玩"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {trialMessages.length === 0 && (
                <p className="pt-8 text-center text-sm text-slate-400">
                  以销售员身份说第一句话，试试这个陪练员的反应
                </p>
              )}
              {trialMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-[#0d5e63] text-white'
                        : 'bg-[#eef3f6] text-slate-800'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {trialSending && (
                <p className="text-center text-xs text-slate-400">对方正在输入…</p>
              )}
            </div>
            <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
              <input
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0d5e63] focus:outline-none"
                value={trialInput}
                onChange={(e) => setTrialInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendTrial();
                }}
                placeholder="输入你的开场白…"
              />
              <button
                onClick={() => void sendTrial()}
                disabled={trialSending || !trialInput.trim()}
                className="rounded-lg bg-[#0d5e63] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                发送
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
