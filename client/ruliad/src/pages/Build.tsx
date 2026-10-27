import { useState, useEffect, useCallback } from 'react';
import {
  fetchScenarios,
  createScenario,
  updateScenario,
  deleteScenario,
  createPersonaConfig,
  updatePersonaConfig,
  fetchSkillPoints,
  trialChat,
  getStoredUser,
  apiError,
} from '../api';
import type { Scenario, SkillPoint } from '../types';

type EditorStep = 'base' | 'goal' | 'role' | 'params' | 'eval';

const STEPS: { key: EditorStep; label: string }[] = [
  { key: 'base', label: '场景基础' },
  { key: 'goal', label: '练习目标' },
  { key: 'role', label: '角色画像' },
  { key: 'params', label: '对话参数' },
  { key: 'eval', label: '评估配置' },
];

const CATEGORIES = [
  { key: '电话销售', icon: '📞', dot: 'bg-cat-phone', type: 't1' },
  { key: '客户主动咨询', icon: '💬', dot: 'bg-cat-inquiry', type: 't2' },
  { key: '成交谈判', icon: '🤝', dot: 'bg-cat-deal', type: 't3' },
  { key: '地推破冰', icon: '🚶', dot: 'bg-cat-ground', type: 't4' },
];

const PERSONALITY_TAGS = ['谨慎', '重数据', '爱压价', '爽快', '强势', '善拖延', '话多', '戒备'];
const DECISION_STYLES = [
  '凭感觉快速拍板',
  '理性比较，需要数据佐证',
  '向上汇报，本人不拍板',
  '多方询价，拖到最后',
];
const INTERRUPT_OPTIONS = [
  { key: 'off', label: '从不打断' },
  { key: 'weak', label: '偶尔打断（接近真实客户）' },
  { key: 'strong', label: '频繁打断（高压特训）' },
];

const DIMENSIONS = [
  { key: 'discovery', name: '需求挖掘', desc: '是否问出真实需求与决策链', defaultWeight: 20 },
  { key: 'presentation', name: '价值表达', desc: '讲清差异化，而非罗列功能', defaultWeight: 20 },
  { key: 'objection', name: '异议处理', desc: '面对压价的回应质量', defaultWeight: 20 },
  { key: 'closing', name: '流程推进', desc: '是否拿到下一步承诺', defaultWeight: 15 },
  { key: 'rhythm', name: '沟通节奏', desc: '倾听、停顿、不打断对方', defaultWeight: 15 },
  { key: 'compliance', name: '专业合规', desc: '话术准确，不踩禁止事项', defaultWeight: 10 },
];

const DIFF_LABELS: Record<number, string> = { 1: '初级', 2: '进阶', 3: '挑战' };
const AVATARS = [
  '/avatars/man-1.jpg', '/avatars/man-2.jpg', '/avatars/man-3.jpg', '/avatars/man-4.jpg',
  '/avatars/woman-1.jpg', '/avatars/woman-2.jpg', '/avatars/woman-3.jpg', '/avatars/woman-4.jpg',
];

const DEFAULT_WEIGHTS: Record<string, number> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.key, d.defaultWeight])
);

interface BuildForm {
  name: string;
  category: string;
  description: string;
  difficulty: number;
  duration: number;
  goal: string;
  successCriteria: string;
  doNot: string;
  roleName: string;
  roleTitle: string;
  roleIndustry: string;
  personalities: string[];
  decisionStyle: string;
  objections: string;
  hiddenInfo: string;
  speechRate: number;
  challenge: number;
  interruptLevel: 'off' | 'weak' | 'strong';
  skillPointIds: string[];
  dimensionWeights: Record<string, number>;
}

const EMPTY_FORM: BuildForm = {
  name: '',
  category: '电话销售',
  description: '',
  difficulty: 1,
  duration: 5,
  goal: '',
  successCriteria: '60',
  doNot: '',
  roleName: '',
  roleTitle: '',
  roleIndustry: '',
  personalities: [],
  decisionStyle: DECISION_STYLES[0],
  objections: '',
  hiddenInfo: '',
  speechRate: 2,
  challenge: 3,
  interruptLevel: 'weak',
  skillPointIds: [],
  dimensionWeights: { ...DEFAULT_WEIGHTS },
};

interface TrialMsg {
  role: 'user' | 'assistant';
  content: string;
}

const weightsKey = (scenarioId: string) => `grasp-eval-weights:${scenarioId}`;

function loadWeights(scenarioId: string): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(weightsKey(scenarioId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, number>;
    return { ...DEFAULT_WEIGHTS, ...parsed };
  } catch {
    return null;
  }
}

function saveWeights(scenarioId: string, weights: Record<string, number>) {
  localStorage.setItem(weightsKey(scenarioId), JSON.stringify(weights));
}

function avatarFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATARS[hash % AVATARS.length];
}

export default function Build() {
  const isAdmin = getStoredUser()?.role === 'admin';

  const [activeTab, setActiveTab] = useState<'list' | 'editor'>('list');
  const [activeStep, setActiveStep] = useState<EditorStep>('base');
  const [form, setForm] = useState<BuildForm>(EMPTY_FORM);
  const [mine, setMine] = useState<Scenario[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [skillPoints, setSkillPoints] = useState<SkillPoint[]>([]);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [editingPersonaConfigId, setEditingPersonaConfigId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [trial, setTrial] = useState<{ open: boolean; messages: TrialMsg[]; input: string; sending: boolean }>({
    open: false,
    messages: [],
    input: '',
    sending: false,
  });

  const loadMine = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await fetchScenarios();
      setMine(data.scenarios.filter((s) => s.source !== '官方'));
    } catch (err) {
      setNotice(apiError(err, '场景列表加载失败'));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMine();
    fetchSkillPoints()
      .then((data) => setSkillPoints(data.skillPoints))
      .catch(() => setSkillPoints([]));
  }, [loadMine]);

  const updateForm = (updates: Partial<BuildForm>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  const togglePersonality = (tag: string) => {
    form.personalities.includes(tag)
      ? updateForm({ personalities: form.personalities.filter((t) => t !== tag) })
      : updateForm({ personalities: [...form.personalities, tag] });
  };

  const toggleSkillPoint = (id: string) => {
    form.skillPointIds.includes(id)
      ? updateForm({ skillPointIds: form.skillPointIds.filter((s) => s !== id) })
      : updateForm({ skillPointIds: [...form.skillPointIds, id] });
  };

  const totalWeight = Object.values(form.dimensionWeights).reduce((a, b) => a + b, 0);

  const skillIdsFromNames = (names?: string[]): string[] => {
    if (!names?.length) return [];
    return names
      .map((n) => skillPoints.find((sp) => sp.name === n)?.id)
      .filter((id): id is string => !!id);
  };

  const resetTrial = () => setTrial({ open: false, messages: [], input: '', sending: false });

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setEditingScenarioId(null);
    setEditingPersonaConfigId(null);
    resetTrial();
  };

  const handleEdit = (scenario: Scenario) => {
    setEditingScenarioId(scenario.id);
    setEditingPersonaConfigId(scenario.personaConfigId);
    setForm({
      ...EMPTY_FORM,
      name: scenario.name,
      category: CATEGORIES.some((c) => c.key === scenario.methodology) ? scenario.methodology! : EMPTY_FORM.category,
      description: scenario.coverageTopics?.[0] ?? '',
      difficulty: scenario.difficulty || 1,
      duration: scenario.durationMinutes || 5,
      successCriteria: String(scenario.successCriteria?.passScore ?? 60),
      roleName: scenario.personaName ?? '',
      roleTitle: scenario.personaTitle ?? '',
      skillPointIds: skillIdsFromNames(scenario.skillPointNames),
      dimensionWeights: loadWeights(scenario.id) ?? { ...DEFAULT_WEIGHTS },
    });
    resetTrial();
    setActiveStep('base');
    setActiveTab('editor');
  };

  const handleDuplicate = async (scenario: Scenario) => {
    if (!isAdmin) return;
    try {
      const { scenario: created } = await createScenario({
        name: `${scenario.name}（副本）`,
        personaConfigId: scenario.personaConfigId,
        skillPointIds: skillIdsFromNames(scenario.skillPointNames),
        passScore: scenario.successCriteria?.passScore ?? 60,
        durationMinutes: scenario.durationMinutes,
        difficulty: scenario.difficulty,
        coverageTopics: scenario.coverageTopics,
        methodology: scenario.methodology,
        source: scenario.source ?? '自建',
      });
      const weights = loadWeights(scenario.id);
      if (weights) saveWeights(created.id, weights);
      setNotice(`已复制为「${created.name}」`);
      await loadMine();
    } catch (err) {
      setNotice(apiError(err, '复制失败'));
    }
  };

  const handleDelete = async (scenario: Scenario) => {
    if (!isAdmin) return;
    if (!window.confirm(`确定删除场景「${scenario.name}」吗？此操作不可恢复。`)) return;
    try {
      await deleteScenario(scenario.id);
      localStorage.removeItem(weightsKey(scenario.id));
      setNotice(`已删除「${scenario.name}」`);
      await loadMine();
    } catch (err) {
      setNotice(apiError(err, '删除失败'));
    }
  };

  const buildBackground = (): string => {
    const parts: string[] = [];
    if (form.roleIndustry) parts.push(`行业：${form.roleIndustry}`);
    if (form.personalities.length) parts.push(`性格标签：${form.personalities.join('、')}`);
    if (form.decisionStyle) parts.push(`决策风格：${form.decisionStyle}`);
    if (form.objections) parts.push(`典型异议：${form.objections}`);
    if (form.hiddenInfo) parts.push(`禁止透露（除非被追问）：${form.hiddenInfo}`);
    return parts.join('\n');
  };

  const buildBehaviorBands = () => {
    const rate = { 1: '语速偏慢', 2: '语速标准', 3: '语速偏快' }[form.speechRate] ?? '语速标准';
    const challenge =
      form.challenge >= 4 ? '追问犀利、让步很少' : form.challenge >= 3 ? '有来有回、适度施压' : '态度温和、容易沟通';
    const interrupt =
      { off: '从不打断对方', weak: '偶尔打断对方', strong: '频繁打断对方' }[form.interruptLevel];
    return [
      { key: 'calm', minArousal: 0, maxArousal: 0.33, instruction: `保持平和友好的语气，${rate}，${challenge}，${interrupt}。` },
      { key: 'engaged', minArousal: 0.33, maxArousal: 0.66, instruction: `态度认真专注，${rate}，${challenge}，${interrupt}。` },
      { key: 'agitated', minArousal: 0.66, maxArousal: 1, instruction: `情绪激动、不耐烦，${rate}，施压升级，${interrupt}。` },
    ];
  };

  const handleSave = async () => {
    if (!isAdmin || saving) return;
    if (!form.name.trim()) {
      setNotice('请填写场景标题');
      return;
    }
    if (totalWeight !== 100) {
      setNotice(`六维权重合计需为 100%（当前 ${totalWeight}%）`);
      return;
    }
    const parsed = Number(form.successCriteria);
    const passScore = Number.isFinite(parsed) && parsed > 0 ? Math.min(100, Math.round(parsed)) : 60;
    const personaPayload = {
      name: form.roleName.trim() || `${form.name.trim()}角色`,
      background: buildBackground(),
      occupation: form.roleTitle.trim() || undefined,
      behaviorBands: buildBehaviorBands(),
    };
    setSaving(true);
    try {
      let scenarioId = editingScenarioId;
      let personaConfigId = editingPersonaConfigId;
      if (scenarioId) {
        if (personaConfigId) await updatePersonaConfig(personaConfigId, personaPayload);
        await updateScenario(scenarioId, {
          name: form.name.trim(),
          skillPointIds: form.skillPointIds,
          passScore,
          durationMinutes: form.duration,
          difficulty: form.difficulty,
          coverageTopics: form.description.trim() ? [form.description.trim()] : [],
          methodology: form.category,
          source: '自建',
        });
      } else {
        const { persona } = await createPersonaConfig(personaPayload);
        personaConfigId = persona.id;
        const { scenario } = await createScenario({
          name: form.name.trim(),
          personaConfigId: persona.id,
          skillPointIds: form.skillPointIds,
          passScore,
          durationMinutes: form.duration,
          difficulty: form.difficulty,
          coverageTopics: form.description.trim() ? [form.description.trim()] : [],
          methodology: form.category,
          source: '自建',
        });
        scenarioId = scenario.id;
        setEditingScenarioId(scenario.id);
        setEditingPersonaConfigId(persona.id);
      }
      if (scenarioId) saveWeights(scenarioId, form.dimensionWeights);
      setNotice(editingScenarioId ? '场景已更新' : '场景已保存，可在「我的场景」中查看');
      await loadMine();
    } catch (err) {
      setNotice(apiError(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const trialRounds = trial.messages.filter((m) => m.role === 'user').length;
  const trialFinished = trialRounds >= 3;

  const handleTrialToggle = () => {
    if (trial.open) {
      resetTrial();
      return;
    }
    if (!editingPersonaConfigId) {
      setNotice('请先保存场景，再试聊三轮预览');
      return;
    }
    setTrial({ open: true, messages: [], input: '', sending: false });
  };

  const handleTrialSend = async () => {
    const text = trial.input.trim();
    if (!text || !editingPersonaConfigId || trial.sending || trialFinished) return;
    const nextMessages: TrialMsg[] = [...trial.messages, { role: 'user', content: text }];
    setTrial((prev) => ({ ...prev, messages: nextMessages, input: '', sending: true }));
    try {
      const { reply } = await trialChat(editingPersonaConfigId, nextMessages);
      setTrial((prev) => ({
        ...prev,
        messages: [...nextMessages, { role: 'assistant', content: reply }],
        sending: false,
      }));
    } catch (err) {
      setTrial((prev) => ({ ...prev, messages: prev.messages.slice(0, -1), sending: false }));
      setNotice(apiError(err, '试聊失败'));
    }
  };

  const scrollToStep = (key: EditorStep) => {
    setActiveStep(key);
    document.getElementById(`bsec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const catType = (key: string) => CATEGORIES.find((c) => c.key === key)?.type ?? 't1';
  const catDot = (key: string) => CATEGORIES.find((c) => c.key === key)?.dot ?? 'bg-cat-phone';
  const catChip = (key: string) => {
    const map: Record<string, string> = { '电话销售': 'chip-coral', '客户主动咨询': 'chip-blue', '成交谈判': 'chip-amber', '地推破冰': 'chip-green' };
    return map[key] ?? 'chip-coral';
  };
  const cardCategory = (s: Scenario) =>
    CATEGORIES.some((c) => c.key === s.methodology) ? s.methodology! : s.methodology || s.source || '自建';

  const adminTip = '仅管理员可保存场景';

  return (
    <div>
      {/* Tab 切换 */}
      <div className="flex gap-0.5 mb-6 bg-white rounded-full p-1 border border-line max-w-sm">
        <button
          onClick={() => setActiveTab('list')}
          className={`flex-1 py-2 rounded-full text-xs font-medium transition-all ${
            activeTab === 'list' ? 'bg-coral text-white shadow-sm' : 'text-text-secondary'
          }`}
        >
          我的场景
        </button>
        <button
          onClick={() => setActiveTab('editor')}
          className={`flex-1 py-2 rounded-full text-xs font-medium transition-all ${
            activeTab === 'editor' ? 'bg-coral text-white shadow-sm' : 'text-text-secondary'
          }`}
        >
          场景编辑器
        </button>
      </div>

      {notice && (
        <div className="card" style={{ padding: '10px 16px', marginBottom: 16, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{notice}</span>
          <button className="act-btn" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      {/* ===== 我的场景 ===== */}
      {activeTab === 'list' && (
        <section className="section">
          <div className="sec-head">
            <h2><span>🛠️</span> 我的场景</h2>
            <button onClick={() => { handleReset(); setActiveTab('editor'); }} className="btn btn-primary">
              ＋ 新建场景
            </button>
          </div>
          {listLoading ? (
            <div className="empty">
              <div className="ic">⏳</div>
              <h3>加载中…</h3>
            </div>
          ) : (
            <>
              <div className="mine-grid">
                {mine.map((scenario) => (
                  <div key={scenario.id} className="card mine-card">
                    <div className={`cover ${catType(cardCategory(scenario))}`}>
                      <span className={`chip ${catChip(cardCategory(scenario))} cat`}>
                        <i className={`cdot ${catDot(cardCategory(scenario))}`} />{cardCategory(scenario)}
                      </span>
                      <span className="chip gray derived">{scenario.source ?? '自建'}</span>
                      <img className="coverimg" src={avatarFor(scenario.id)} alt={scenario.name} />
                      <span className="diff">
                        {DIFF_LABELS[scenario.difficulty] ?? '进阶'} · 约 {scenario.durationMinutes} 分钟
                      </span>
                    </div>
                    <div className="sbody">
                      <h3>{scenario.name}</h3>
                      <p className="desc">
                        {scenario.coverageTopics?.join('；') ||
                          [scenario.personaName, scenario.personaTitle].filter(Boolean).join(' · ') ||
                          '暂无描述'}
                      </p>
                      <div className="who">
                        {(scenario.practiceCount ?? 0) > 0
                          ? <span className="chip green">已练 {scenario.practiceCount} 次</span>
                          : <span className="chip gray">未练习</span>}
                        {scenario.skillPointNames?.slice(0, 2).map((n) => (
                          <span key={n} className="chip gray">{n}</span>
                        ))}
                      </div>
                      <div className="card-actions">
                        <button className="act-btn" onClick={() => handleEdit(scenario)}>✏️ 编辑</button>
                        <button
                          className="act-btn"
                          disabled={!isAdmin}
                          title={!isAdmin ? adminTip : undefined}
                          onClick={() => handleDuplicate(scenario)}
                        >
                          ⧉ 复制
                        </button>
                        <button
                          className="act-btn danger"
                          disabled={!isAdmin}
                          title={!isAdmin ? adminTip : undefined}
                          onClick={() => handleDelete(scenario)}
                        >
                          🗑 删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {mine.length === 0 && (
                <div className="empty">
                  <div className="ic">🛠️</div>
                  <h3>暂无自定义场景</h3>
                  <p>点击「新建场景」创建第一个练习场景</p>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ===== 场景编辑器 ===== */}
      {activeTab === 'editor' && (
        <section className="section" style={{ paddingTop: 8 }}>
          <div className="sec-head">
            <h2><span>✏️</span> 场景编辑器</h2>
            <span className="chip chip-gray">{editingScenarioId ? '正在编辑已有场景' : '新场景草稿'}</span>
          </div>

          <div className="editor">
            {/* 左侧锚点导航（仅 PC） */}
            <aside className="ednav">
              <div className="card inner-card">
                {STEPS.map((step, idx) => (
                  <a
                    key={step.key}
                    href={`#bsec-${step.key}`}
                    className={activeStep === step.key ? 'active' : ''}
                    onClick={() => scrollToStep(step.key)}
                  >
                    <span className="no">{idx + 1}</span>
                    {step.label}
                  </a>
                ))}
                <div className="ver">{editingScenarioId ? '保存将更新该场景' : '保存后出现在「我的场景」'}</div>
              </div>
            </aside>

            {/* 右侧表单 */}
            <div>
              {/* ① 场景基础 */}
              <div className="card formsec" id="bsec-base">
                <div className="fs-head"><h3>① 场景基础</h3><span className="sub">这个场景是做什么的</span></div>
                <div className="field">
                  <label>场景标题</label>
                  <input type="text" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} className="input" placeholder="如：首次电话邀约" maxLength={30} />
                </div>
                <div className="field">
                  <label>场景类别</label>
                  <div className="pick">
                    {CATEGORIES.map((cat) => (
                      <span key={cat.key} onClick={() => updateForm({ category: cat.key })} className={`chip ${form.category === cat.key ? 'on' : ''}`}>
                        {cat.icon} {cat.key}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>场景描述</label>
                  <textarea value={form.description} onChange={(e) => updateForm({ description: e.target.value })} className="input" rows={3} placeholder="描述场景背景和特点..." maxLength={200} />
                </div>
                <div className="row2">
                  <div className="field">
                    <label>难度</label>
                    <select value={form.difficulty} onChange={(e) => updateForm({ difficulty: Number(e.target.value) })} className="input">
                      <option value={1}>初级</option>
                      <option value={2}>进阶</option>
                      <option value={3}>挑战</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>预计时长</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input type="number" min={1} max={60} value={form.duration} onChange={(e) => updateForm({ duration: Number(e.target.value) })} className="input" />
                      <span style={{ fontSize: '14px', color: '#6B7280', flexShrink: 0 }}>分钟</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ② 练习目标 */}
              <div className="card formsec" id="bsec-goal">
                <div className="fs-head"><h3>② 练习目标</h3><span className="sub">练完要达成什么</span></div>
                <div className="field">
                  <label>我方目标</label>
                  <textarea value={form.goal} onChange={(e) => updateForm({ goal: e.target.value })} className="input" rows={2} />
                  <div className="hint">AI 会围绕这个目标给角色施压，评估也以此为准绳。</div>
                </div>
                <div className="field">
                  <label>成功标准</label>
                  <input type="text" value={form.successCriteria} onChange={(e) => updateForm({ successCriteria: e.target.value })} className="input" />
                  <div className="hint">填写达标分数（0-100），保存为场景的及格线，非数字时按 60 处理。</div>
                </div>
                <div className="field">
                  <label>禁止事项</label>
                  <input type="text" value={form.doNot} onChange={(e) => updateForm({ doNot: e.target.value })} className="input" />
                </div>
              </div>

              {/* ③ 角色画像 */}
              <div className="card formsec" id="bsec-role">
                <div className="fs-head"><h3>③ 角色画像</h3><span className="sub">你在和谁对话</span></div>
                <div className="row3">
                  <div className="field"><label>姓名</label><input type="text" value={form.roleName} onChange={(e) => updateForm({ roleName: e.target.value })} className="input" /></div>
                  <div className="field"><label>职位</label><input type="text" value={form.roleTitle} onChange={(e) => updateForm({ roleTitle: e.target.value })} className="input" /></div>
                  <div className="field"><label>行业</label><input type="text" value={form.roleIndustry} onChange={(e) => updateForm({ roleIndustry: e.target.value })} className="input" /></div>
                </div>
                <div className="field">
                  <label>性格标签（可多选）</label>
                  <div className="pick">
                    {PERSONALITY_TAGS.map((tag) => (
                      <span key={tag} onClick={() => togglePersonality(tag)} className={`chip ${form.personalities.includes(tag) ? 'on-soft' : ''}`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>决策风格</label>
                  <select value={form.decisionStyle} onChange={(e) => updateForm({ decisionStyle: e.target.value })} className="input">
                    {DECISION_STYLES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>典型异议</label>
                  <textarea value={form.objections} onChange={(e) => updateForm({ objections: e.target.value })} className="input" rows={2} />
                  <div className="hint">角色会在对话中自然抛出这些异议，一行一个或用分号分隔。</div>
                </div>
                <div className="field">
                  <label>禁止透露内容</label>
                  <input type="text" value={form.hiddenInfo} onChange={(e) => updateForm({ hiddenInfo: e.target.value })} className="input" />
                  <div className="hint">角色不会主动说出的信息，除非被你追问出来。</div>
                </div>
              </div>

              {/* ④ 对话参数 */}
              <div className="card formsec" id="bsec-params">
                <div className="fs-head"><h3>④ 对话参数</h3><span className="sub">角色说话的脾气</span></div>
                <div className="field">
                  <label>语速</label>
                  <input type="range" min={1} max={3} step={1} value={form.speechRate} onChange={(e) => updateForm({ speechRate: Number(e.target.value) })} />
                  <div className="range-vals"><span>慢</span><span>标准</span><span>快</span></div>
                  <div className="hint">标准 ≈ 150 WPM</div>
                </div>
                <div className="field">
                  <label>挑战强度</label>
                  <input type="range" min={1} max={5} step={1} value={form.challenge} onChange={(e) => updateForm({ challenge: Number(e.target.value) })} />
                  <div className="range-vals"><span>温和</span><span>有来有回</span><span>步步紧逼</span></div>
                  <div className="hint">强度越高，角色追问越狠、让步越少。</div>
                </div>
                <div className="field">
                  <label>打断频率</label>
                  <select value={form.interruptLevel} onChange={(e) => updateForm({ interruptLevel: e.target.value as BuildForm['interruptLevel'] })} className="input">
                    {INTERRUPT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {/* ⑤ 评估配置 */}
              <div className="card formsec" id="bsec-eval">
                <div className="fs-head"><h3>⑤ 评估配置</h3><span className="sub">考核技能点与六维权重</span></div>
                <div className="field">
                  <label>考核技能点（可多选）</label>
                  <div className="pick">
                    {skillPoints.map((sp) => (
                      <span key={sp.id} onClick={() => toggleSkillPoint(sp.id)} className={`chip ${form.skillPointIds.includes(sp.id) ? 'on-soft' : ''}`}>
                        {sp.name}
                      </span>
                    ))}
                  </div>
                  {skillPoints.length === 0 && <div className="hint">暂无可用技能点</div>}
                </div>
                <div className="weights">
                  {DIMENSIONS.map((dim) => (
                    <div key={dim.key} className="witem">
                      <div className="wl">
                        <span>{dim.name}</span>
                        <input type="number" min={0} max={100} value={form.dimensionWeights[dim.key] ?? dim.defaultWeight}
                          onChange={(e) => updateForm({ dimensionWeights: { ...form.dimensionWeights, [dim.key]: Number(e.target.value) } })} />
                      </div>
                      <div className="wd">{dim.desc}</div>
                    </div>
                  ))}
                </div>
                <div className="hint" style={{ marginTop: 12 }}>
                  权重合计需 = 100%（当前 {totalWeight}%{totalWeight === 100 ? ' ✅' : '，请调整'}）
                </div>
              </div>

              {/* 底部操作条 */}
              <div className="card editor-actions">
                <button className="btn btn-ghost" onClick={handleTrialToggle}>
                  🎧 {trial.open ? '收起试聊' : '试聊三轮预览'}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!isAdmin || saving}
                  title={!isAdmin ? adminTip : undefined}
                  onClick={handleSave}
                >
                  {saving ? '保存中…' : '保存为新版本'}
                </button>
                <span className="note">
                  {isAdmin
                    ? editingScenarioId ? '保存将更新该场景' : '保存后出现在「我的场景」'
                    : `${adminTip}（试聊可用）`}
                </span>
              </div>

              {/* 试聊三轮预览 */}
              {trial.open && (
                <div className="card formsec">
                  <div className="fs-head"><h3>🎧 试聊预览</h3><span className="sub">第 {Math.min(trialRounds + (trialFinished ? 0 : 1), 3)} / 3 轮</span></div>
                  {trial.messages.length === 0 && (
                    <div className="hint" style={{ marginBottom: 8 }}>以销售身份发第一句话，角色会以客户口吻回应。</div>
                  )}
                  {trial.messages.map((m, idx) => (
                    <div key={idx} className={`msg ${m.role === 'user' ? 'msg-me' : ''}`}>
                      <div className="bubble">{m.content}</div>
                    </div>
                  ))}
                  {trial.sending && <div className="hint">角色思考中…</div>}
                  {trialFinished ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                      <span className="chip green">三轮预览已结束</span>
                      <button className="btn btn-ghost" onClick={resetTrial}>重新开始</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <input
                        type="text"
                        className="input"
                        style={{ flex: 1 }}
                        placeholder="输入你的话术…"
                        value={trial.input}
                        disabled={trial.sending}
                        onChange={(e) => setTrial((prev) => ({ ...prev, input: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleTrialSend(); }}
                      />
                      <button className="btn btn-primary" disabled={trial.sending || !trial.input.trim()} onClick={handleTrialSend}>
                        发送
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
