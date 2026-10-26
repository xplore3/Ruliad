import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchScenarios } from '../api';
import type { Scenario } from '../types';

type EditorStep = 'base' | 'goal' | 'role' | 'params' | 'eval';

const STEPS: { key: EditorStep; label: string }[] = [
  { key: 'base', label: '基础' },
  { key: 'goal', label: '目标' },
  { key: 'role', label: '角色' },
  { key: 'params', label: '参数' },
  { key: 'eval', label: '评估' },
];

const CATEGORIES = [
  { key: '电话销售', icon: '📞', color: 'coral' },
  { key: '客户主动咨询', icon: '💬', color: 'cat-ground' },
  { key: '成交谈判', icon: '🤝', color: 'cat-deal' },
  { key: '地推破冰', icon: '🚶', color: 'cat-inquiry' },
];

const PERSONALITY_TAGS = ['谨慎', '重数据', '爱压价', '爽快', '强势', '善拖延', '话多', '戒备'];
const DECISION_STYLES = [
  '凭感觉快速拍板',
  '理性比较，需要数据佐证',
  '向上汇报，本人不拍板',
  '多方询价，拖到最后',
];

const DIMENSIONS = [
  { key: 'opening', name: '开场破冰', desc: '前 30 秒建立联系', defaultWeight: 20 },
  { key: 'discovery', name: '需求挖掘', desc: '提问与倾听的比例', defaultWeight: 25 },
  { key: 'presentation', name: '价值呈现', desc: '差异化卖点传递', defaultWeight: 20 },
  { key: 'objection', name: '异议处理', desc: '常见反对应对', defaultWeight: 20 },
  { key: 'closing', name: '推进成交', desc: '抓住承诺信号', defaultWeight: 15 },
];

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
  voice: string;
  opener: 'ai' | 'user';
  maxDuration: number;
  hintLevel: 'off' | 'weak' | 'strong';
  dimensionWeights: Record<string, number>;
}

const INITIAL_FORM: BuildForm = {
  name: '向谨慎的采购总监报价',
  category: '电话销售',
  description: '王总对价格极度敏感，习惯用竞品压价，需要在 5 分钟内讲清差异化价值，不被对方的节奏带走。',
  difficulty: 2,
  duration: 8,
  goal: '不降价讲清差异化价值，争取二次面谈',
  successCriteria: '对方同意下周带技术团队来司考察',
  doNot: '不得承诺超出 5% 的折扣；不得诋毁竞品',
  roleName: '王建国',
  roleTitle: '采购总监',
  roleIndustry: '装备制造',
  personalities: ['谨慎', '重数据', '爱压价'],
  decisionStyle: '理性比较，需要数据佐证',
  objections: '竞品更便宜；预算有限',
  hiddenInfo: '公司已内定竞品入围，只是在比价压价',
  speechRate: 2,
  voice: '成熟男声',
  opener: 'ai',
  maxDuration: 8,
  hintLevel: 'weak',
  dimensionWeights: {
    opening: 20,
    discovery: 25,
    presentation: 20,
    objection: 20,
    closing: 15,
  },
};

interface MineScenario {
  id: string;
  name: string;
  desc: string;
  category: string;
  categoryIcon: string;
  diff: string;
  duration: string;
  version: string;
  updatedAt: string;
  practiceCount: number;
  isDerived: boolean;
}

const MINE_SCENARIOS: MineScenario[] = [
  { id: 'ms-001', name: '向谨慎的采购总监报价', desc: '基于官方模板调整：王总对价格极度敏感，习惯用竞品压价。', category: '电话销售', categoryIcon: '📞', diff: '进阶', duration: '约 8 分钟', version: 'v3', updatedAt: '3 天前', practiceCount: 12, isDerived: true },
  { id: 'ms-002', name: '教培课程咨询（少儿英语版）', desc: '把官方咨询场景改成本行业话术：家长来电问价。', category: '客户主动咨询', categoryIcon: '💬', diff: '初级', duration: '约 5 分钟', version: 'v1', updatedAt: '上周创建', practiceCount: 4, isDerived: true },
  { id: 'ms-003', name: '账期谈判（大客户加强版）', desc: '提高了角色强势程度：赵总要求 90 天账期 + 独家折扣。', category: '成交谈判', categoryIcon: '🤝', diff: '挑战', duration: '约 12 分钟', version: 'v2', updatedAt: '2 周前更新', practiceCount: 7, isDerived: true },
  { id: 'ms-004', name: '社区门店 30 秒破冰', desc: '商场场景改成社区门店语境：陈姐赶时间、戒备心强。', category: '地推破冰', categoryIcon: '🚶', diff: '初级', duration: '约 4 分钟', version: 'v1', updatedAt: '3 周前创建', practiceCount: 0, isDerived: true },
];

export default function Build() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'list' | 'editor'>('list');
  const [activeStep, setActiveStep] = useState<EditorStep>('base');
  const [form, setForm] = useState<BuildForm>(INITIAL_FORM);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    fetchScenarios().then((data) => setScenarios(data.scenarios)).catch(console.error);
  }, []);

  const updateForm = (updates: Partial<BuildForm>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  const togglePersonality = (tag: string) => {
    form.personalities.includes(tag)
      ? updateForm({ personalities: form.personalities.filter((t) => t !== tag) })
      : updateForm({ personalities: [...form.personalities, tag] });
  };

  const totalWeight = Object.values(form.dimensionWeights).reduce((a, b) => a + b, 0);

  const handleReset = () => {
    setForm(INITIAL_FORM);
    setEditingId(null);
  };

  return (
    <div className="px-4 py-4">
      {/* 顶部 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-text-primary text-lg font-bold">构建</h1>
          <p className="text-xs text-text-tertiary mt-0.5">创建和管理你的练习场景</p>
        </div>
        <button
          onClick={() => { setActiveTab('editor'); handleReset(); }}
          className="px-4 py-2 bg-coral text-white rounded-full text-xs font-medium hover:bg-coral-hover transition-colors shadow-md shadow-coral/20"
        >
          + 新建场景
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-0.5 mb-5 bg-dark-panel rounded-full p-1">
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

      {/* 我的场景列表 */}
      {activeTab === 'list' && (
        <div className="space-y-3">
          {MINE_SCENARIOS.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              onEdit={() => {
                setActiveTab('editor');
                setEditingId(scenario.id);
                setForm({ ...INITIAL_FORM, name: scenario.name, category: scenario.category });
              }}
              onPractice={() => navigate('/practice/new')}
            />
          ))}

          {MINE_SCENARIOS.length === 0 && (
            <div className="bg-dark-card rounded-2xl p-10 text-center border border-white/5">
              <p className="text-text-secondary text-sm">暂无自定义场景</p>
              <p className="text-text-tertiary text-xs mt-1">点击「新建场景」创建第一个练习场景</p>
            </div>
          )}
        </div>
      )}

      {/* 场景编辑器 */}
      {activeTab === 'editor' && (
        <div>
          {/* 步骤条（手机端横向滚动） */}
          <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
            {STEPS.map((step, idx) => (
              <button
                key={step.key}
                onClick={() => setActiveStep(step.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs whitespace-nowrap transition-all shrink-0 ${
                  activeStep === step.key
                    ? 'bg-coral text-white font-medium'
                    : 'bg-dark-panel text-text-secondary'
                }`}
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  activeStep === step.key ? 'bg-white/20' : 'bg-dark-elevated text-text-tertiary'
                }`}>
                  {idx + 1}
                </span>
                {step.label}
              </button>
            ))}
          </div>

          {/* 表单区（手机单栏） */}
          <div className="bg-dark-card rounded-2xl border border-white/5 p-4 space-y-5">
            {/* 场景基础 */}
            {activeStep === 'base' && (
              <>
                <FieldGroup label="场景标题" hint="建议突出对练情境">
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => updateForm({ name: e.target.value })}
                    className="input-field"
                    placeholder="如：首次电话邀约"
                    maxLength={30}
                  />
                </FieldGroup>

                <FieldGroup label="场景类别">
                  <div className="grid grid-cols-2 gap-2">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat.key}
                        onClick={() => updateForm({ category: cat.key })}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all ${
                          form.category === cat.key
                            ? `bg-${cat.color}/15 border-${cat.color}/30 text-${cat.color}`
                            : 'bg-dark-panel border-white/5 text-text-secondary hover:border-coral/20'
                        }`}
                      >
                        {cat.icon} {cat.key}
                      </button>
                    ))}
                  </div>
                </FieldGroup>

                <FieldGroup label="场景描述" hint="描述场景背景和特点">
                  <textarea
                    value={form.description}
                    onChange={(e) => updateForm({ description: e.target.value })}
                    className="input-field resize-none"
                    rows={3}
                    placeholder="描述场景背景和特点..."
                    maxLength={200}
                  />
                  <p className="text-[11px] text-text-tertiary mt-1">{form.description.length}/200</p>
                </FieldGroup>

                <FieldGroup label="难度">
                  <div className="flex gap-1.5">
                    {[
                      { val: 1, label: '入门', color: 'text-success' },
                      { val: 2, label: '进阶', color: 'text-cat-ground' },
                      { val: 3, label: '挑战', color: 'text-cat-deal' },
                      { val: 4, label: '高压', color: 'text-coral' },
                      { val: 5, label: '极限', color: 'text-warning' },
                    ].map((d) => (
                      <button
                        key={d.val}
                        onClick={() => updateForm({ difficulty: d.val })}
                        className={`flex-1 py-2 rounded-lg text-[11px] font-medium border transition-all ${
                          form.difficulty === d.val
                            ? 'bg-coral border-coral text-white'
                            : 'border-white/5 bg-dark-panel text-text-secondary hover:border-coral/30'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </FieldGroup>

                <FieldGroup label="预计时长">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {Array.from({ length: 14 }, (_, i) => i + 3).map((v) => (
                      <button
                        key={v}
                        onClick={() => updateForm({ duration: v })}
                        className={`px-3 py-1.5 rounded-full text-xs shrink-0 transition-all ${
                          form.duration === v
                            ? 'bg-coral text-white'
                            : 'bg-dark-panel text-text-secondary'
                        }`}
                      >
                        {v} 分钟
                      </button>
                    ))}
                  </div>
                </FieldGroup>
              </>
            )}

            {/* 练习目标 */}
            {activeStep === 'goal' && (
              <>
                <FieldGroup label="我方目标" hint="AI 会围绕这个目标给角色施压">
                  <textarea
                    value={form.goal}
                    onChange={(e) => updateForm({ goal: e.target.value })}
                    className="input-field resize-none"
                    rows={2}
                    placeholder="AI 会围绕这个目标给角色施压..."
                  />
                </FieldGroup>
                <FieldGroup label="成功标准">
                  <input
                    type="text"
                    value={form.successCriteria}
                    onChange={(e) => updateForm({ successCriteria: e.target.value })}
                    className="input-field"
                    placeholder="对方同意下周带技术团队来司考察"
                  />
                </FieldGroup>
                <FieldGroup label="禁止事项">
                  <input
                    type="text"
                    value={form.doNot}
                    onChange={(e) => updateForm({ doNot: e.target.value })}
                    className="input-field"
                    placeholder="不得承诺超出 5% 的折扣"
                  />
                </FieldGroup>
              </>
            )}

            {/* 角色画像 */}
            {activeStep === 'role' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FieldGroup label="姓名">
                    <input type="text" value={form.roleName} onChange={(e) => updateForm({ roleName: e.target.value })} className="input-field" />
                  </FieldGroup>
                  <FieldGroup label="职位">
                    <input type="text" value={form.roleTitle} onChange={(e) => updateForm({ roleTitle: e.target.value })} className="input-field" />
                  </FieldGroup>
                </div>
                <FieldGroup label="行业">
                  <input type="text" value={form.roleIndustry} onChange={(e) => updateForm({ roleIndustry: e.target.value })} className="input-field" />
                </FieldGroup>
                <FieldGroup label="性格标签（可多选）">
                  <div className="flex flex-wrap gap-1.5">
                    {PERSONALITY_TAGS.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => togglePersonality(tag)}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${
                          form.personalities.includes(tag)
                            ? 'bg-coral/15 border-coral/30 text-coral font-medium'
                            : 'border-white/5 bg-dark-panel text-text-secondary hover:border-coral/20'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </FieldGroup>
                <FieldGroup label="决策风格">
                  <select
                    value={form.decisionStyle}
                    onChange={(e) => updateForm({ decisionStyle: e.target.value })}
                    className="input-field"
                  >
                    {DECISION_STYLES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </FieldGroup>
                <FieldGroup label="典型异议">
                  <textarea
                    value={form.objections}
                    onChange={(e) => updateForm({ objections: e.target.value })}
                    className="input-field resize-none"
                    rows={2}
                    placeholder="角色会在对话中自然抛出这些异议"
                  />
                </FieldGroup>
                <FieldGroup label="隐藏信息" hint="除非被追问，角色不会主动说出">
                  <input
                    type="text"
                    value={form.hiddenInfo}
                    onChange={(e) => updateForm({ hiddenInfo: e.target.value })}
                    className="input-field"
                  />
                </FieldGroup>
              </>
            )}

            {/* 对话参数 */}
            {activeStep === 'params' && (
              <>
                <FieldGroup label="角色语速">
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={form.speechRate}
                    onChange={(e) => updateForm({ speechRate: Number(e.target.value) })}
                    className="w-full accent-coral"
                  />
                  <div className="flex justify-between text-[11px] text-text-tertiary mt-1">
                    <span>慢</span><span>标准</span><span>快</span>
                  </div>
                </FieldGroup>
                <FieldGroup label="音色">
                  <select value={form.voice} onChange={(e) => updateForm({ voice: e.target.value })} className="input-field">
                    <option>成熟男声</option>
                    <option>温柔女声</option>
                    <option>活力男声</option>
                    <option>沉稳女声</option>
                  </select>
                </FieldGroup>
                <FieldGroup label="谁先开场">
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateForm({ opener: 'ai' })}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-medium border transition-all ${
                        form.opener === 'ai' ? 'bg-coral border-coral text-white' : 'border-white/5 bg-dark-panel text-text-secondary'
                      }`}
                    >
                      AI 先说话
                    </button>
                    <button
                      onClick={() => updateForm({ opener: 'user' })}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-medium border transition-all ${
                        form.opener === 'user' ? 'bg-coral border-coral text-white' : 'border-white/5 bg-dark-panel text-text-secondary'
                      }`}
                    >
                      用户先说话
                    </button>
                  </div>
                </FieldGroup>
              </>
            )}

            {/* 评估配置 */}
            {activeStep === 'eval' && (
              <FieldGroup label={`维度权重（总和 ${totalWeight}%）`} hint="建议总计 100%">
                <div className="grid grid-cols-2 gap-2">
                  {DIMENSIONS.map((dim) => (
                    <div key={dim.key} className="bg-dark-panel rounded-xl p-3 border border-white/5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-primary font-medium">{dim.name}</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={form.dimensionWeights[dim.key] || 0}
                          onChange={(e) => updateForm({
                            dimensionWeights: { ...form.dimensionWeights, [dim.key]: Number(e.target.value) }
                          })}
                          className="w-12 px-1.5 py-1 text-center text-xs font-bold border border-white/8 rounded-lg bg-dark-card text-text-primary focus:border-coral focus:outline-none"
                        />
                      </div>
                      <p className="text-[10px] text-text-tertiary">{dim.desc}</p>
                    </div>
                  ))}
                </div>
                {totalWeight !== 100 && (
                  <p className="text-[11px] text-warning mt-2">⚠ 当前总和 {totalWeight}%，建议调整为 100%</p>
                )}
              </FieldGroup>
            )}

            {/* 底部操作条 */}
            <div className="pt-3 border-t border-white/5 flex items-center justify-between sticky bottom-0 bg-dark-card">
              <button
                onClick={handleReset}
                className="px-3 py-1.5 bg-dark-panel text-text-secondary rounded-full text-xs hover:bg-dark-elevated transition-colors"
              >
                重置
              </button>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 bg-dark-panel text-text-secondary rounded-full text-xs hover:bg-dark-elevated transition-colors">
                  保存草稿
                </button>
                <button
                  onClick={() => navigate('/practice/new')}
                  className="px-4 py-1.5 bg-coral text-white rounded-full text-xs font-medium hover:bg-coral-hover transition-colors"
                >
                  发布并试练
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input 统一样式 */}
      <style>{`
        .input-field {
          width: 100%;
          padding: 8px 12px;
          background: #22252D;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px;
          color: #F7F7FA;
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s;
        }
        .input-field:focus { border-color: rgba(232,92,98,0.4); }
        .input-field::placeholder { color: #6B7080; }
        select.input-field { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7080' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 30px; }
        textarea.input-field { min-height: 60px; }
      `}</style>
    </div>
  );
}

// ===== 子组件 =====

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-text-secondary font-medium mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-tertiary mt-1">{hint}</p>}
    </div>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  '电话销售': 'bg-coral/15 text-coral',
  '客户主动咨询': 'bg-cat-ground/15 text-cat-ground',
  '成交谈判': 'bg-cat-deal/15 text-cat-deal',
  '地推破冰': 'bg-cat-inquiry/15 text-cat-inquiry',
};

function ScenarioCard({ scenario, onEdit, onPractice }: { scenario: MineScenario; onEdit: () => void; onPractice: () => void }) {
  return (
    <div className="bg-dark-card rounded-2xl p-4 border border-white/5">
      {/* 顶部标签 */}
      <div className="flex items-center justify-between mb-2.5">
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${CATEGORY_COLORS[scenario.category] || 'bg-dark-panel text-text-secondary'}`}>
          {scenario.categoryIcon} {scenario.category}
        </span>
        {scenario.isDerived && (
          <span className="px-2 py-0.5 bg-dark-elevated text-text-tertiary rounded-full text-[11px]">
            我的派生
          </span>
        )}
      </div>

      {/* 内容 */}
      <h3 className="text-text-primary text-sm font-medium truncate">{scenario.name}</h3>
      <p className="text-[11px] text-text-secondary mt-1 line-clamp-2">{scenario.desc}</p>

      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        <span className="px-2 py-0.5 bg-dark-panel text-text-tertiary rounded-md text-[11px]">
          {scenario.diff} · {scenario.duration}
        </span>
        <span className="px-2 py-0.5 bg-dark-panel text-text-tertiary rounded-md text-[11px]">
          {scenario.version} · {scenario.updatedAt}
        </span>
        <span className={`px-2 py-0.5 rounded-md text-[11px] ${
          scenario.practiceCount > 0 ? 'bg-success/10 text-success' : 'bg-dark-panel text-text-tertiary'
        }`}>
          {scenario.practiceCount > 0 ? `已练 ${scenario.practiceCount} 次` : '未练习'}
        </span>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-1.5 mt-3 pt-3 border-t border-white/5">
        <button onClick={onEdit} className="flex-1 py-1.5 bg-dark-panel text-text-secondary text-[11px] rounded-lg font-medium hover:bg-coral/10 hover:text-coral transition-colors">✏️ 编辑</button>
        <button className="flex-1 py-1.5 bg-dark-panel text-text-secondary text-[11px] rounded-lg font-medium hover:bg-coral/10 hover:text-coral transition-colors">⧉ 复制</button>
        <button className="flex-1 py-1.5 bg-dark-panel text-text-secondary text-[11px] rounded-lg font-medium hover:bg-coral/10 hover:text-coral transition-colors">🗑 删除</button>
        <button onClick={onPractice} className="py-1.5 px-3 bg-coral/15 text-coral text-[11px] rounded-lg font-medium hover:bg-coral/25 transition-colors">▶ 试练</button>
      </div>
    </div>
  );
}
