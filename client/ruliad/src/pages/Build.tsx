import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchScenarios,
  createScenario,
  updateScenario,
  deleteScenario,
  createPersonaConfig,
  updatePersonaConfig,
  deletePersonaConfig,
  fetchPersonaConfig,
  fetchManagementKnowledgeBase,
  fetchSkillPoints,
  listScoreItems,
  listDrillScripts,
  trialChat,
  getStoredUser,
  apiError,
  listScenarioGuidances,
} from '../api';
import type { DrillScript, PersonaConfig, Scenario, ScenarioParticipant, ScoreCategory, ScoreItemDef, SkillPoint } from '../types';
import type { ScenarioGuidance } from '../lib/guidance';
import VoiceResourceEditor from './VoiceResourceEditor';

type EditorStep = 'base' | 'goal' | 'role' | 'params' | 'eval' | 'script' | 'participants';

const STEPS: { key: EditorStep; label: string }[] = [
  { key: 'base', label: '场景基础' },
  { key: 'goal', label: '练习目标' },
  { key: 'role', label: '角色画像' },
  { key: 'params', label: '对话参数' },
  { key: 'eval', label: '评估配置' },
  { key: 'script', label: '剧本配置' },
  { key: 'participants', label: '参与者' },
];

const SCENE_TYPES = [
  { key: 'practical', label: '实用场景', desc: '单点考核 · 有剧本对练' },
  { key: 'drill', label: '实战训练', desc: '自由对练' },
] as const;

const CATEGORIES: Array<{ key: ScoreCategory; label: string; icon: string; dot: string; type: string }> = [
  { key: '电销', label: '电话销售', icon: '📞', dot: 'bg-cat-phone', type: 't1' },
  { key: '咨询接待', label: '咨询接待', icon: '💬', dot: 'bg-cat-inquiry', type: 't2' },
  { key: '现场成交', label: '现场成交', icon: '🤝', dot: 'bg-cat-deal', type: 't3' },
  { key: '地推', label: '地推引流课', icon: '🚶', dot: 'bg-cat-ground', type: 't4' },
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

const DIFF_LABELS: Record<number, string> = { 1: '初级', 2: '进阶', 3: '挑战' };
const AVATARS = [
  '/avatars/man-1.png', '/avatars/man-2.png', '/avatars/man-3.png', '/avatars/man-4.png',
  '/avatars/women-1.png', '/avatars/women-2.png', '/avatars/women-3.png', '/avatars/women-4.png',
];

interface BuildForm {
  name: string;
  category: ScoreCategory;
  flowType: 'generic' | 'ground_push' | 'reception';
  methodology: string;
  description: string;
  difficulty: number;
  duration: number;
  sceneType: 'drill' | 'practical';
  productKBId: string;
  drillScriptId: string;
  scoreItemIds: string[];
  status: 'draft' | 'published';
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
  speechRate: 1 | 2 | 3;
  challenge: number;
  interruptLevel: 'off' | 'weak' | 'strong';
  skillPointIds: string[];
  scriptExecutionOrder: string;
  scriptTopics: string;
  scriptCustomerQuestions: string;
  scriptAssessmentPoints: string;
  participants: ScenarioParticipant[];
}

const EMPTY_PARTICIPANT: ScenarioParticipant = {
  name: '', traits: '', speakingStyle: '', speechScope: '', languageRequirements: '', goal: '',
};

const EMPTY_FORM: BuildForm = {
  name: '', category: '电销', flowType: 'generic', methodology: '', description: '', difficulty: 1, duration: 10,
  sceneType: 'practical', productKBId: '', drillScriptId: '', scoreItemIds: [], status: 'published', goal: '',
  successCriteria: '60', doNot: '', roleName: '', roleTitle: '', roleIndustry: '', personalities: [],
  decisionStyle: DECISION_STYLES[0], objections: '', hiddenInfo: '', speechRate: 2, challenge: 3,
  interruptLevel: 'weak', skillPointIds: [], scriptExecutionOrder: '', scriptTopics: '',
  scriptCustomerQuestions: '', scriptAssessmentPoints: '', participants: [],
};

interface TrialMsg {
  role: 'user' | 'assistant';
  content: string;
}

function avatarFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATARS[hash % AVATARS.length];
}

function personaEditorFields(persona: PersonaConfig): Partial<BuildForm> {
  const lines = persona.background.split('\n');
  const value = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim();
  const legacyObjections = value('典型异议：');
  const legacyHidden = value('禁止透露（除非被追问）：');
  return {
    roleName: persona.name,
    roleTitle: persona.occupation ?? '',
    roleIndustry: persona.industry ?? value('行业：') ?? '',
    personalities: persona.personalityTags ?? value('性格标签：')?.split(/[、,，]/).filter(Boolean) ?? [],
    decisionStyle: persona.decisionStyle ?? value('决策风格：') ?? DECISION_STYLES[0],
    objections: persona.objections?.join('\n') ?? legacyObjections ?? '',
    hiddenInfo: persona.hiddenInfo?.join('\n') ?? legacyHidden ?? '',
  };
}

export default function Build() {
  const isAdmin = getStoredUser()?.role === 'admin';
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'list' | 'editor'>('list');
  const [activeStep, setActiveStep] = useState<EditorStep>('base');
  const [editorMode, setEditorMode] = useState<'voice' | 'form'>('voice');
  const [form, setForm] = useState<BuildForm>(EMPTY_FORM);
  const [mine, setMine] = useState<Scenario[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [skillPoints, setSkillPoints] = useState<SkillPoint[]>([]);
  const [scoreItems, setScoreItems] = useState<ScoreItemDef[]>([]);
  const [drillScripts, setDrillScripts] = useState<DrillScript[]>([]);
  const [productKB, setProductKB] = useState<{ id: string; name: string } | null>(null);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [editingScenarioVersion, setEditingScenarioVersion] = useState(1);
  const [editingPersonaConfigId, setEditingPersonaConfigId] = useState<string | null>(null);
  const [editingPersona, setEditingPersona] = useState<PersonaConfig | null>(null);
  /** 新建场景保存成功后，提示条提供「立即配置新手指引」直达动作 */
  const [newSavedScenario, setNewSavedScenario] = useState<{ id: string; name: string } | null>(null);
  /** 编辑中场景已有的新手指引配置（用于时长字段的真相源提示） */
  const [editingGuidance, setEditingGuidance] = useState<ScenarioGuidance | null>(null);
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
      const data = await fetchScenarios(true);
      setMine(data.scenarios);
    } catch (err) {
      setNotice(apiError(err, '场景列表加载失败'));
    } finally {
      setListLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadMine();
    fetchSkillPoints().then((data) => setSkillPoints(data.skillPoints)).catch(() => setSkillPoints([]));
    listScoreItems().then((data) => setScoreItems(data.items)).catch(() => setScoreItems([]));
    listDrillScripts().then((data) => setDrillScripts(data.items)).catch(() => setDrillScripts([]));
    fetchManagementKnowledgeBase().then((data) => setProductKB(data.kb ? { id: data.kb.id, name: data.kb.name } : null)).catch(() => setProductKB(null));
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

  const toggleScoreItem = (id: string) => {
    form.scoreItemIds.includes(id)
      ? updateForm({ scoreItemIds: form.scoreItemIds.filter((itemId) => itemId !== id) })
      : updateForm({ scoreItemIds: [...form.scoreItemIds, id] });
  };

  const skillIdsFromNames = (names?: string[]): string[] => {
    if (!names?.length) return [];
    return names
      .map((n) => skillPoints.find((sp) => sp.name === n)?.id)
      .filter((id): id is string => !!id);
  };

  /** 当前表单快照（技能点转换为名称），供增量修改时传给后端；全新场景（无标题无ID）不传 */
  const formSnapshot = (): Record<string, unknown> | undefined => {
    if (!editingScenarioId && !form.name.trim()) return undefined;
    return {
      ...form,
      scenarioId: editingScenarioId ?? undefined,
      skillPointIds: undefined,
      scoreItemIds: undefined,
      drillScriptId: undefined,
      skillPointNames: form.skillPointIds.map((id) => skillPoints.find((sp) => sp.id === id)?.name).filter(Boolean),
      scoreItemNames: form.scoreItemIds.map((id) => scoreItems.find((item) => item.id === id)?.name).filter(Boolean),
      drillScriptName: drillScripts.find((script) => script.id === form.drillScriptId)?.name ?? '',
    };
  };

  /**
   * 语音自动场景创建和配置落库后的回调：
   * 新建/更新场景时同步编辑态（后续语音指令自动定位到该场景），并刷新列表
   */
  const handleVoiceApplied = async (applied: { result?: Record<string, unknown> }) => {
    const scenario = applied.result?.scenario as { id: string; name: string } | undefined;
    await loadMine();
    if (!scenario?.id) return;
    const mineNow = await fetchScenarios(true);
    const saved = mineNow.scenarios.find((s) => s.id === scenario.id);
    if (!saved) return;
    setEditingScenarioId(saved.id);
    setEditingScenarioVersion(saved.version ?? 1);
    setEditingPersonaConfigId(saved.personaConfigId);
    setNewSavedScenario(null);
  };

  const resetTrial = () => setTrial({ open: false, messages: [], input: '', sending: false });

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setEditingScenarioId(null);
    setEditingScenarioVersion(1);
    setEditingPersonaConfigId(null);
    setEditingPersona(null);
    setNewSavedScenario(null);
    setEditingGuidance(null);
    resetTrial();
  };

  const handleEdit = async (scenario: Scenario) => {
    setEditingScenarioId(scenario.id);
    setEditingScenarioVersion(scenario.version ?? 1);
    setEditingPersonaConfigId(scenario.personaConfigId);
    const assessmentPoints = scenario.script?.assessmentPoints ?? [];
    setForm({
      ...EMPTY_FORM,
      name: scenario.name,
      category: scenario.category ?? EMPTY_FORM.category,
      flowType: scenario.flowType ?? (scenario.category === '地推' ? 'ground_push' : scenario.category === '咨询接待' ? 'reception' : 'generic'),
      methodology: scenario.methodology ?? '',
      description: scenario.description ?? '',
      difficulty: scenario.difficulty || 1,
      duration: scenario.durationMinutes || 10,
      sceneType: scenario.sceneType ?? 'practical',
      productKBId: scenario.productKBId ?? '',
      drillScriptId: scenario.drillScriptId ?? '',
      scoreItemIds: scenario.scoreItemIds ?? [],
      status: scenario.status ?? 'published',
      goal: scenario.script?.purpose ?? '',
      successCriteria: String(scenario.successCriteria?.passScore ?? 60),
      doNot: assessmentPoints.filter((point) => point.startsWith('禁止：')).map((point) => point.slice(3)).join('；'),
      roleName: scenario.personaName ?? '',
      roleTitle: scenario.personaTitle ?? '',
      skillPointIds: scenario.skillPointIds ?? skillIdsFromNames(scenario.skillPointNames),
      speechRate: scenario.conversation?.speechRate ?? 2,
      challenge: scenario.conversation?.challenge ?? 3,
      interruptLevel: scenario.conversation?.interruptLevel ?? 'weak',
      scriptExecutionOrder: scenario.script?.executionOrder ?? '',
      scriptTopics: (scenario.script?.topics ?? []).join('\n'),
      scriptCustomerQuestions: (scenario.script?.customerQuestions ?? []).join('\n'),
      scriptAssessmentPoints: assessmentPoints.filter((point) => !point.startsWith('禁止：')).join('\n'),
      participants: (scenario.participants ?? []).map((p) => ({ ...EMPTY_PARTICIPANT, ...p })),
    });
    resetTrial();
    setActiveStep('base');
    setEditorMode('form');
    setActiveTab('editor');
    setNewSavedScenario(null);
    try {
      const persona = await fetchPersonaConfig(scenario.personaConfigId);
      setEditingPersona(persona);
      setForm((current) => ({ ...current, ...personaEditorFields(persona) }));
    } catch (err) {
      setNotice(apiError(err, '角色配置加载失败'));
    }
    listScenarioGuidances()
      .then((r) => setEditingGuidance(r.items.find((g) => g.scenarioId === scenario.id) ?? null))
      .catch(() => setEditingGuidance(null));
  };

  const handleDuplicate = async (scenario: Scenario) => {
    try {
      const created = await createScenario({
        name: `${scenario.name}（副本）`,
        personaConfigId: scenario.personaConfigId,
        skillPointIds: scenario.skillPointIds ?? skillIdsFromNames(scenario.skillPointNames),
        scoreItemIds: scenario.scoreItemIds ?? [],
        passScore: scenario.successCriteria?.passScore ?? 60,
        durationMinutes: scenario.durationMinutes,
        difficulty: scenario.difficulty,
        coverageTopics: scenario.coverageTopics,
        description: scenario.description,
        productKBId: scenario.productKBId,
        drillScriptId: scenario.drillScriptId,
        methodology: scenario.methodology,
        source: '自建',
        sceneType: scenario.sceneType,
        category: scenario.category,
        flowType: scenario.flowType,
        script: scenario.script,
        participants: scenario.participants,
        conversation: scenario.conversation,
        status: 'draft',
      });
      setNotice(`已复制为「${created.name}」（草稿）`);
      await loadMine();
    } catch (err) {
      setNotice(apiError(err, '复制失败'));
    }
  };

  const handleDelete = async (scenario: Scenario) => {
    if (!window.confirm(`确定删除场景「${scenario.name}」吗？此操作不可恢复。`)) return;
    try {
      await deleteScenario(scenario.id);
      setNotice(`已删除「${scenario.name}」`);
      await loadMine();
    } catch (err) {
      setNotice(apiError(err, '删除失败'));
    }
  };

  const buildBackground = (): string => {
    const preserved = (editingPersona?.background ?? '').split('\n').filter((line) =>
      line.trim() && !/^(行业|性格标签|决策风格|典型异议|禁止透露（除非被追问）)：/.test(line)
    );
    const parts: string[] = [];
    if (form.roleIndustry) parts.push(`行业：${form.roleIndustry}`);
    if (form.personalities.length) parts.push(`性格标签：${form.personalities.join('、')}`);
    if (form.decisionStyle) parts.push(`决策风格：${form.decisionStyle}`);
    if (form.objections) parts.push(`典型异议：${form.objections}`);
    if (form.hiddenInfo) parts.push(`禁止透露（除非被追问）：${form.hiddenInfo}`);
    return [...preserved, ...parts].join('\n') || '本场景的客户角色';
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

  const addParticipant = () =>
    updateForm({ participants: [...form.participants, { ...EMPTY_PARTICIPANT }] });

  const updateParticipant = (idx: number, patch: Partial<ScenarioParticipant>) =>
    updateForm({
      participants: form.participants.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    });

  const removeParticipant = (idx: number) =>
    updateForm({ participants: form.participants.filter((_, i) => i !== idx) });

  const handleSave = async () => {
    if (saving) return;
    if (!form.name.trim()) return setNotice('请填写场景标题');
    if (!form.skillPointIds.length) return setNotice('请至少选择一个技能点');
    if (form.status === 'published' && !form.scoreItemIds.length) return setNotice('发布前请至少绑定一条评分标准；也可先保存为草稿');
    const parsed = Number(form.successCriteria);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return setNotice('及格分必须为 0-100 的数字');
    const passScore = Math.round(parsed);
    const splitLines = (s: string) => s.split(/[\n；;]/).map((x) => x.trim()).filter(Boolean);
    const goalText = form.goal.trim();
    const doNotText = form.doNot.trim();
    const assessmentPoints = splitLines(form.scriptAssessmentPoints);
    if (doNotText) assessmentPoints.push(`禁止：${doNotText}`);
    const scriptPayload = form.sceneType === 'practical'
      ? {
          executionOrder: form.scriptExecutionOrder.trim() || undefined,
          purpose: goalText || undefined,
          topics: splitLines(form.scriptTopics),
          customerQuestions: splitLines(form.scriptCustomerQuestions),
          assessmentPoints,
        }
      : goalText || doNotText
        ? { purpose: goalText || undefined, assessmentPoints }
        : null;
    const participantsPayload = form.participants.filter((p) => p.name.trim()).map((p) => ({
      name: p.name.trim(), traits: p.traits?.trim() || undefined, speakingStyle: p.speakingStyle?.trim() || undefined,
      speechScope: p.speechScope?.trim() || undefined, languageRequirements: p.languageRequirements?.trim() || undefined,
      goal: p.goal?.trim() || undefined,
    }));
    const personaPayload = {
      name: form.roleName.trim() || `${form.name.trim()}角色`,
      background: buildBackground(),
      occupation: form.roleTitle.trim() || undefined,
      industry: form.roleIndustry.trim() || undefined,
      personalityTags: form.personalities,
      decisionStyle: form.decisionStyle,
      objections: splitLines(form.objections),
      hiddenInfo: splitLines(form.hiddenInfo),
      behaviorBands: buildBehaviorBands(),
    };
    const scenarioPayload = {
      name: form.name.trim(), skillPointIds: form.skillPointIds, scoreItemIds: form.scoreItemIds,
      passScore, durationMinutes: form.duration, difficulty: form.difficulty,
      description: form.description.trim() || null, methodology: form.methodology.trim(),
      sceneType: form.sceneType, category: form.category, flowType: form.flowType, productKBId: form.productKBId || null, drillScriptId: form.drillScriptId || null,
      script: scriptPayload, participants: participantsPayload, status: form.status,
      conversation: { speechRate: form.speechRate, challenge: form.challenge, interruptLevel: form.interruptLevel },
    };
    setSaving(true);
    let unreferencedPersonaId: string | null = null;
    try {
      if (editingScenarioId) {
        let personaConfigId = editingPersonaConfigId;
        let persona = editingPersona;
        const shared = (editingPersona?.usageCount ?? 0) > 1 || mine.some((s) => s.id !== editingScenarioId && s.personaConfigId === editingPersonaConfigId);
        if (personaConfigId && editingPersona) {
          if (shared) {
            persona = await createPersonaConfig({ ...editingPersona, ...personaPayload });
            personaConfigId = persona.id;
            unreferencedPersonaId = persona.id;
          } else {
            persona = await updatePersonaConfig(personaConfigId, { ...personaPayload, expectedVersion: editingPersona.version });
          }
        }
        const current = mine.find((s) => s.id === editingScenarioId);
        const updated = await updateScenario(editingScenarioId, {
          ...scenarioPayload,
          personaConfigId: personaConfigId ?? undefined,
          coverageTopics: current?.coverageTopics ?? [],
          source: current?.source ?? '自建',
          expectedVersion: editingScenarioVersion,
        });
        unreferencedPersonaId = null;
        setEditingScenarioVersion(updated.version ?? 1);
        setEditingScenarioId(updated.id);
        setEditingPersonaConfigId(personaConfigId);
        setEditingPersona(persona);
        setNewSavedScenario(null);
        setNotice(shared ? '场景已更新；共享角色已复制为当前场景专属角色，其他场景不受影响' : '场景已更新');
      } else {
        const persona = await createPersonaConfig(personaPayload);
        unreferencedPersonaId = persona.id;
        const scenario = await createScenario({
          ...scenarioPayload,
          description: form.description.trim() || undefined,
          personaConfigId: persona.id,
          source: '自建',
        });
        unreferencedPersonaId = null;
        setEditingScenarioId(scenario.id);
        setEditingScenarioVersion(scenario.version ?? 1);
        setEditingPersonaConfigId(persona.id);
        setEditingPersona(persona);
        setNewSavedScenario({ id: scenario.id, name: form.name.trim() });
        setNotice('场景已保存，可在场景列表查看；可继续配置新手指引');
      }
      await loadMine();
    } catch (err) {
      if (unreferencedPersonaId) await deletePersonaConfig(unreferencedPersonaId).catch(() => {});
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

  const findCategory = (value: string) => CATEGORIES.find((c) => c.key === value || c.label === value);
  const catType = (key: string) => findCategory(key)?.type ?? 't1';
  const catDot = (key: string) => findCategory(key)?.dot ?? 'bg-cat-phone';
  const catChip = (key: string) => {
    const map: Record<string, string> = { 电销: 'chip-coral', 咨询接待: 'chip-blue', 现场成交: 'chip-amber', 地推: 'chip-green' };
    return map[findCategory(key)?.key ?? key] ?? 'chip-coral';
  };
  const cardCategory = (s: Scenario) => findCategory(s.category ?? '')?.label ?? s.methodology ?? s.source ?? '自建';

  return (
    <main className="wrap">
      {/* Tab 切换 */}
      <div className="seg seg-lg" style={{ marginBottom: 24, marginTop: 24 }}>
        <button onClick={() => setActiveTab('list')} className={activeTab === 'list' ? 'on' : ''}>
          我的场景
        </button>
        <button onClick={() => setActiveTab('editor')} className={activeTab === 'editor' ? 'on' : ''}>
          场景编辑器
        </button>
      </div>

      {notice && (
        <div className="card" style={{ padding: '10px 16px', marginBottom: 16, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>{notice}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {newSavedScenario && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() =>
                  navigate('/library', {
                    state: { guidanceFocus: { scenarioId: newSavedScenario.id, name: newSavedScenario.name } },
                  })
                }
              >
                立即配置新手指引 →
              </button>
            )}
            <button className="act-btn" onClick={() => { setNotice(null); setNewSavedScenario(null); }}>✕</button>
          </span>
        </div>
      )}

      {/* ===== 我的场景 ===== */}
      {activeTab === 'list' && (
        <section className="section">
          <div className="sec-head">
            <h2 className="bar-title">我的场景</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              {isAdmin && (
                <button className="btn btn-ghost" onClick={() => navigate('/library')}>
                  🗂 资源库管理
                </button>
              )}
              <button onClick={() => { handleReset(); setEditorMode('voice'); setActiveTab('editor'); }} className="btn btn-primary">
                ＋ 新建场景
              </button>
            </div>
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
                        {scenario.description ||
                          scenario.coverageTopics?.join('；') ||
                          [scenario.personaName, scenario.personaTitle].filter(Boolean).join(' · ') ||
                          '暂无描述'}
                      </p>
                      <div className="who">
                        <span className={`chip ${(scenario.sceneType ?? 'practical') === 'drill' ? 'green' : 'blue'}`}>
                          {(scenario.sceneType ?? 'practical') === 'drill' ? '实战训练' : '实用场景'}
                        </span>
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
                          onClick={() => handleDuplicate(scenario)}
                        >
                          ⧉ 复制
                        </button>
                        <button
                          className="act-btn danger"
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <h2 className="bar-title">场景编辑器</h2>
              <div className="seg">
                <button onClick={() => setEditorMode('voice')} className={editorMode === 'voice' ? 'on' : ''}>
                  🎙️ 语音自动处理
                </button>
                <button onClick={() => setEditorMode('form')} className={editorMode === 'form' ? 'on' : ''}>
                  📝 多维度文本输入
                </button>
              </div>
            </div>
            <span className="chip chip-gray">{editingScenarioId ? '正在编辑已有场景' : '新场景草稿'}</span>
          </div>

          <div className={editorMode === 'form' ? 'editor' : undefined}>
            {/* 左侧锚点导航（仅 PC，多维度文本输入模式） */}
            {editorMode === 'form' && (
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
            )}

            {/* 右侧内容 */}
            <div>
              {/* 语音自动场景创建和配置 */}
              {editorMode === 'voice' && (
              <div className="card formsec">
                <div className="fs-head">
                  <h3 className="bar-title">语音自动场景创建和配置</h3>
                  <span className="sub">说出要创建或修改的场景、场景配置或资源库，LLM 自动提炼、服务端自动定位对象，按权限直接保存或提交通用建议；先预览、后落库</span>
                </div>
                <VoiceResourceEditor
                  embedded
                  context={{ scenarioId: editingScenarioId ?? undefined, form: formSnapshot() }}
                  onApplied={handleVoiceApplied}
                />
              </div>
              )}

              {/* 多维度文本输入 */}
              {editorMode === 'form' && (<>
              {/* ① 场景基础 */}
              <div className="card formsec" id="bsec-base">
                <div className="fs-head"><h3 className="bar-title">场景基础</h3><span className="sub">这个场景是做什么的</span></div>
                <div className="field">
                  <label>场景标题</label>
                  <input type="text" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} className="input" placeholder="如：首次电话邀约" maxLength={30} />
                </div>
                <div className="field">
                  <label>场景类型</label>
                  <div className="pick">
                    {SCENE_TYPES.map((t) => (
                      <span key={t.key} onClick={() => updateForm({ sceneType: t.key })} className={`chip ${form.sceneType === t.key ? 'on' : ''}`}>
                        {t.label}（{t.desc}）
                      </span>
                    ))}
                  </div>
                  <div className="hint">实战训练从首页「实战训练」模块进入；实用场景从首页「实用场景」模块进入，支持剧本与考核。</div>
                </div>
                <div className="field">
                  <label>场景类别</label>
                  <div className="pick">
                    {CATEGORIES.map((cat) => (
                      <span
                        key={cat.key}
                        onClick={() => updateForm({
                          category: cat.key,
                          drillScriptId: drillScripts.some((s) => s.id === form.drillScriptId && s.category === cat.key) ? form.drillScriptId : '',
                          scoreItemIds: scoreItems.filter((item) => form.scoreItemIds.includes(item.id) && (!item.category || item.category === cat.key)).map((item) => item.id),
                        })}
                        className={`chip ${form.category === cat.key ? 'on' : ''}`}
                      >
                        {cat.icon} {cat.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>执行策略</label>
                  <select value={form.flowType} onChange={(e) => updateForm({ flowType: e.target.value as BuildForm['flowType'] })} className="input">
                    <option value="generic">通用对话（不加载专项业务规则）</option>
                    <option value="ground_push">地推专项（双场、孩子互动与推进规则）</option>
                    <option value="reception">咨询接待专项（固定题与试听流程）</option>
                  </select>
                </div>
                <div className="field">
                  <label>方法论标签（可选）</label>
                  <input value={form.methodology} onChange={(e) => updateForm({ methodology: e.target.value })} className="input" placeholder="如：张伟三步破冰法 · L2" />
                </div>
                <div className="field">
                  <label>发布状态</label>
                  <select value={form.status} onChange={(e) => updateForm({ status: e.target.value as BuildForm['status'] })} className="input">
                    <option value="published">发布（学员可用）</option>
                    <option value="draft">草稿（仅管理员可见）</option>
                  </select>
                </div>
                <div className="field">
                  <label>产品知识库</label>
                  <select value={form.productKBId} onChange={(e) => updateForm({ productKBId: e.target.value })} className="input">
                    <option value="">使用角色默认或机构知识库</option>
                    {productKB && <option value={productKB.id}>{productKB.name}</option>}
                  </select>
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
                    {editingScenarioId && (
                      <div className="hint">
                        {editingGuidance
                          ? `该场景已配置新手指引流程，对练实际时长以指引配置为准（当前：目标 ${editingGuidance.duration.targetMinutes} 分钟 / 倒计时 ${editingGuidance.duration.countdownSeconds} 秒）`
                          : '创建后可在资源库配置新手指引，届时以指引配置的时长为准'}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ② 练习目标 */}
              <div className="card formsec" id="bsec-goal">
                <div className="fs-head"><h3 className="bar-title">练习目标</h3><span className="sub">练完要达成什么</span></div>
                <div className="field">
                  <label>我方目标</label>
                  <textarea value={form.goal} onChange={(e) => updateForm({ goal: e.target.value })} className="input" rows={2} />
                  <div className="hint">AI 会围绕这个目标给角色施压，评估也以此为准绳。</div>
                </div>
                <div className="field">
                  <label>成功标准</label>
                  <input type="text" value={form.successCriteria} onChange={(e) => updateForm({ successCriteria: e.target.value })} className="input" />
                  <div className="hint">填写达标分数（0-100），保存为场景的及格线。</div>
                </div>
                <div className="field">
                  <label>禁止事项</label>
                  <input type="text" value={form.doNot} onChange={(e) => updateForm({ doNot: e.target.value })} className="input" />
                </div>
              </div>

              {/* ③ 角色画像 */}
              <div className="card formsec" id="bsec-role">
                <div className="fs-head"><h3 className="bar-title">角色画像</h3><span className="sub">你在和谁对话</span></div>
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
                <div className="fs-head"><h3 className="bar-title">对话参数</h3><span className="sub">角色说话的脾气</span></div>
                <div className="field">
                  <label>语速</label>
                  <input type="range" min={1} max={3} step={1} value={form.speechRate} onChange={(e) => updateForm({ speechRate: Number(e.target.value) as BuildForm['speechRate'] })} />
                  <div className="range-vals"><span>慢</span><span>标准</span><span>快</span></div>
                  <div className="hint">控制角色对话中的语速表现；实际 TTS 倍率可在资源库指引中配置</div>
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
                <div className="fs-head"><h3 className="bar-title">评估配置</h3><span className="sub">技能地图与场景专属评分标准</span></div>
                <div className="field">
                  <label>考核技能点（可多选）</label>
                  <div className="pick">
                    {skillPoints.map((sp) => (
                      <span key={sp.id} onClick={() => toggleSkillPoint(sp.id)} className={`chip ${form.skillPointIds.includes(sp.id) ? 'on-soft' : ''}`}>{sp.name}</span>
                    ))}
                  </div>
                  {skillPoints.length === 0 && <div className="hint">暂无可用技能点，请先到资源库创建</div>}
                </div>
                <div className="field">
                  <label>评分标准（发布场景至少一项）</label>
                  <div className="pick">
                    {scoreItems.filter((item) => !item.category || item.category === form.category).map((item) => (
                      <span key={item.id} onClick={() => toggleScoreItem(item.id)} className={`chip ${form.scoreItemIds.includes(item.id) ? 'on-soft' : ''}`}>
                        {item.name}{item.isObservation ? '（观察）' : ''}
                      </span>
                    ))}
                  </div>
                  <div className="hint">实际评分只使用此处显式绑定的标准；修改其他场景或同分类资源不会改变本场景的选择范围。</div>
                </div>
              </div>

              {/* ⑥ 剧本配置 */}
              <div className="card formsec" id="bsec-script">
                <div className="fs-head"><h3 className="bar-title">剧本配置</h3><span className="sub">显式绑定资源，实用场景可补充结构化流程</span></div>
                <div className="field">
                  <label>演练剧本（可选）</label>
                  <select value={form.drillScriptId} onChange={(e) => updateForm({ drillScriptId: e.target.value })} className="input">
                    <option value="">不引用演练剧本，仅使用场景配置</option>
                    {drillScripts.filter((script) => script.category === form.category).map((script) => <option key={script.id} value={script.id}>{script.name}</option>)}
                  </select>
                  <div className="hint">引用后由该剧本主导客户行为；其他同分类场景不会与此场景自动共用剧本。</div>
                </div>
                {form.sceneType === 'practical' && (
                  <>
                    <div className="field">
                      <label>执行顺序</label>
                      <textarea value={form.scriptExecutionOrder} onChange={(e) => updateForm({ scriptExecutionOrder: e.target.value })} className="input" rows={2} placeholder="如：开场破冰 → 需求探询 → 异议处理 → 推进成交" maxLength={200} />
                    </div>
                    <div className="field">
                      <label>话题</label>
                      <textarea value={form.scriptTopics} onChange={(e) => updateForm({ scriptTopics: e.target.value })} className="input" rows={2} placeholder="一行一个或用分号分隔" />
                    </div>
                    <div className="field">
                      <label>客户的主要问题</label>
                      <textarea value={form.scriptCustomerQuestions} onChange={(e) => updateForm({ scriptCustomerQuestions: e.target.value })} className="input" rows={3} placeholder="一行一个，角色会在对练中抛出" />
                    </div>
                    <div className="field">
                      <label>主要考核点</label>
                      <textarea value={form.scriptAssessmentPoints} onChange={(e) => updateForm({ scriptAssessmentPoints: e.target.value })} className="input" rows={3} placeholder="一行一个，作为评分参照" />
                    </div>
                  </>
                )}
              </div>

              {/* ⑦ 参与者 */}
              <div className="card formsec" id="bsec-participants">
                <div className="fs-head"><h3 className="bar-title">参与者</h3><span className="sub">各参与者的特征、说话方式与参与目的</span></div>
                {form.participants.length === 0 && (
                  <div className="hint" style={{ marginBottom: 8 }}>尚未添加参与者，点击下方按钮添加（通常包含学员与客户两方）。</div>
                )}
                {form.participants.map((p, idx) => (
                  <div key={idx} className="participant-row">
                    <div className="row2">
                      <div className="field">
                        <label>名称 / 角色</label>
                        <input type="text" value={p.name} onChange={(e) => updateParticipant(idx, { name: e.target.value })} className="input" placeholder="如：孟建国（学生家长）" maxLength={30} />
                      </div>
                      <div className="field">
                        <label>参与目的</label>
                        <input type="text" value={p.goal ?? ''} onChange={(e) => updateParticipant(idx, { goal: e.target.value })} className="input" placeholder="TA 参与这场对话想达成什么" maxLength={100} />
                      </div>
                    </div>
                    <div className="row2">
                      <div className="field">
                        <label>主要特征</label>
                        <input type="text" value={p.traits ?? ''} onChange={(e) => updateParticipant(idx, { traits: e.target.value })} className="input" placeholder="如：冷淡型客户，时间紧张" maxLength={100} />
                      </div>
                      <div className="field">
                        <label>说话特点</label>
                        <input type="text" value={p.speakingStyle ?? ''} onChange={(e) => updateParticipant(idx, { speakingStyle: e.target.value })} className="input" placeholder="如：语速快、打断多、问题直接" maxLength={100} />
                      </div>
                    </div>
                    <div className="row2">
                      <div className="field">
                        <label>话语范围</label>
                        <input type="text" value={p.speechScope ?? ''} onChange={(e) => updateParticipant(idx, { speechScope: e.target.value })} className="input" placeholder="如：只谈商务条件，不聊产品细节" maxLength={100} />
                      </div>
                      <div className="field">
                        <label>言语要求</label>
                        <input type="text" value={p.languageRequirements ?? ''} onChange={(e) => updateParticipant(idx, { languageRequirements: e.target.value })} className="input" placeholder="如：不接受夸大表述，要求数据出处" maxLength={100} />
                      </div>
                    </div>
                    <button type="button" className="act-btn danger participant-del" onClick={() => removeParticipant(idx)}>
                      🗑 删除该参与者
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm" onClick={addParticipant}>
                  ＋ 添加参与者
                </button>
              </div>
              </>)}

              {/* 底部操作条 */}
              <div className="card editor-actions">
                <button className="btn btn-ghost" onClick={handleTrialToggle}>
                  🎧 {trial.open ? '收起试聊' : '试聊三轮预览'}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={handleSave}
                >
                  {saving ? '保存中…' : '保存为新版本'}
                </button>
                <span className="note">
                  {editingScenarioId ? '保存将更新该场景并递增版本' : '保存后出现在「我的场景」'}
                </span>
              </div>

              {/* 试聊三轮预览 */}
              {trial.open && (
                <div className="card formsec">
                  <div className="fs-head"><h3 className="bar-title">试聊预览</h3><span className="sub">第 {Math.min(trialRounds + (trialFinished ? 0 : 1), 3)} / 3 轮</span></div>
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
    </main>
  );
}
