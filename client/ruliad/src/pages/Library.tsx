import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiError,
  batchCreateCustomerQuestions,
  createCustomerQuestion,
  createGoldenCase,
  createScenario,
  createScoreItem,
  deleteAnalysisStandard,
  deleteCustomerQuestion,
  deleteGoldenCase,
  deleteRealismStandard,
  deleteScenario,
  deleteScenarioGuidance,
  deleteScoreItem,
  extractLibraryRows,
  fetchPersonaConfigs,
  fetchScenarios,
  fetchSkillPoints,
  getStoredUser,
  listAnalysisStandards,
  listCustomerQuestions,
  listGoldenCases,
  listRealismStandards,
  listScenarioGuidances,
  listScoreItems,
  saveAnalysisStandard,
  saveRealismStandard,
  saveScenarioGuidance,
  updateCustomerQuestion,
  updateGoldenCase,
  updateScenario,
  updateScoreItem,
} from '../api';
import type {
  CustomerQuestion,
  GoldenCase,
  PersonaConfig,
  Scenario,
  ScenarioParticipant,
  ScoreItemDef,
  ScoreLevel,
  SkillPoint,
} from '../types';
import type {
  AnalysisStandard,
  DemoScriptTemplate,
  DifficultyLevel,
  DurationParams,
  RealismStandard,
  ScenarioGuidance,
} from '../lib/guidance';

/** ===== 通用行模型：clean=已入库未改 / dirty=已改 / draft=新草稿 / deleted=待删除 ===== */

type RowStatus = 'clean' | 'dirty' | 'draft' | 'deleted';

interface Row<T> {
  key: string;
  data: T;
  status: RowStatus;
  prevStatus?: RowStatus;
  error?: string;
  warn?: string[];
}

function useRows<T extends { id?: string }>() {
  const [rows, setRows] = useState<Row<T>[]>([]);
  const counter = useRef(0);
  const nextKey = (prefix: string) => `${prefix}-${++counter.current}`;

  const loadRows = (items: T[]) =>
    setRows(items.map((d) => ({ key: d.id ?? nextKey('row'), data: d, status: 'clean' as const })));

  const addDrafts = (drafts: { data: T; warn?: string[] }[]) =>
    setRows((prev) => [
      ...prev,
      ...drafts.map((d) => ({ key: nextKey('draft'), data: d.data, status: 'draft' as const, warn: d.warn })),
    ]);

  const updateRow = (key: string, patch: Partial<T>) =>
    setRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? { ...r, data: { ...r.data, ...patch }, status: r.status === 'clean' ? 'dirty' : r.status, error: undefined }
          : r
      )
    );

  const markSaved = (key: string, data: T) =>
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, data, status: 'clean' as const, error: undefined, warn: undefined } : r
      )
    );

  const markError = (key: string, error: string) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, error } : r)));

  const toggleDelete = (key: string) =>
    setRows((prev) =>
      prev.flatMap((r) => {
        if (r.key !== key) return [r];
        if (r.status === 'draft') return [];
        if (r.status === 'deleted') return [{ ...r, status: r.prevStatus ?? 'clean', prevStatus: undefined }];
        return [{ ...r, prevStatus: r.status, status: 'deleted' as const }];
      })
    );

  return { rows, setRows, loadRows, addDrafts, updateRow, markSaved, markError, toggleDelete };
}

interface SaveHandlers<T extends { id?: string }> {
  validate: (d: T) => string | null;
  create: (d: T) => Promise<T>;
  update: (id: string, d: T) => Promise<T>;
  remove: (id: string) => Promise<unknown>;
}

/** 批量保存：草稿→create，脏行→update，删除标记→remove；失败行标注错误 */
async function saveRows<T extends { id?: string }>(
  rows: Row<T>[],
  handlers: SaveHandlers<T>,
  setRows: React.Dispatch<React.SetStateAction<Row<T>[]>>
): Promise<{ saved: number; failed: number }> {
  let saved = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === 'clean') continue;
    if (row.status === 'deleted') {
      try {
        await handlers.remove(row.data.id!);
        setRows((prev) => prev.filter((r) => r.key !== row.key));
        saved += 1;
      } catch (err) {
        failed += 1;
        setRows((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, error: apiError(err, '删除失败') } : r))
        );
      }
      continue;
    }
    const invalid = handlers.validate(row.data);
    if (invalid) {
      failed += 1;
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, error: invalid } : r)));
      continue;
    }
    try {
      if (row.status === 'draft') await handlers.create(row.data);
      else await handlers.update(row.data.id!, row.data);
      saved += 1;
    } catch (err) {
      failed += 1;
      setRows((prev) =>
        prev.map((r) => (r.key === row.key ? { ...r, error: apiError(err, '保存失败') } : r))
      );
    }
  }
  return { saved, failed };
}

/** ===== 粘贴表格解析 ===== */

function splitTableLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  return line.split(/[,，;；]/).map((c) => c.trim());
}

/** 解析粘贴文本为二维表；首行若命中表头名则按列名映射 */
function parseTableText(text: string, headers: string[]): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  if (lines.length === 0) return [];
  const first = splitTableLine(lines[0]);
  const hitCount = first.filter((c) => headers.includes(c)).length;
  const body = hitCount >= Math.max(1, Math.floor(headers.length / 2)) ? lines.slice(1) : lines;
  return body.map(splitTableLine);
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v.replace('%', ''));
  return Number.isFinite(n) ? n : undefined;
};

/** ===== 通用 UI 小组件 ===== */

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="lib-overlay" onClick={onClose}>
      <div className="card lib-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lib-panel-head">
          <h3>{title}</h3>
          <button className="act-btn" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 详情弹窗：编辑暂存到行（计入待保存改动）；「保存此行」立即入库 */
function DetailModal({ title, saving, onSave, onClose, children }: {
  title: string;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="lib-overlay" onClick={onClose}>
      <div className="card lib-panel lib-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="lib-panel-head">
          <h3>{title}</h3>
          <button className="act-btn" onClick={onClose}>✕</button>
        </div>
        <div className="lib-form">{children}</div>
        <div className="lib-panel-foot">
          <span className="lib-hint">「完成」暂存为待保存改动；「保存此行」立即入库</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>完成</button>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={onSave}>
            {saving ? '保存中…' : '保存此行'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`lib-field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function CellInput({ value, onChange, placeholder, type }: {
  value: string | number | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      className="lib-cell"
      type={type ?? 'text'}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function CellTextarea({ value, onChange, placeholder, rows = 2 }: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className="lib-cell"
      rows={rows}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** 弹窗内的输入控件（用 .input 样式） */
function MInput({ value, onChange, placeholder, type }: {
  value: string | number | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      className="input"
      type={type ?? 'text'}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function MTextarea({ value, onChange, placeholder, rows = 3 }: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className="input"
      rows={rows}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** 字符串数组 ↔ 每行一条的 textarea */
function LinesTextarea({ value, onChange, placeholder, rows = 3 }: {
  value: string[] | undefined;
  onChange: (v: string[]) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <MTextarea
      value={(value ?? []).join('\n')}
      rows={rows}
      placeholder={placeholder ?? '每行一条'}
      onChange={(v) => onChange(v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))}
    />
  );
}

function SkillPointPicker({ value, onChange, options }: {
  value: string[];
  onChange: (ids: string[]) => void;
  options: SkillPoint[];
}) {
  const names = options.filter((o) => value.includes(o.id)).map((o) => o.name);
  return (
    <details className="lib-multi">
      <summary>{names.length > 0 ? names.join('、') : '选择技能点'}</summary>
      <div className="lib-multi-list">
        {options.map((o) => (
          <label key={o.id}>
            <input
              type="checkbox"
              checked={value.includes(o.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, o.id] : value.filter((id) => id !== o.id))
              }
            />
            {o.name}
          </label>
        ))}
      </div>
    </details>
  );
}

/** 弹窗内的技能点多选（平铺 checkbox，不用下拉） */
function SkillPointChecks({ value, onChange, options }: {
  value: string[];
  onChange: (ids: string[]) => void;
  options: SkillPoint[];
}) {
  return (
    <div className="lib-checks">
      {options.map((o) => (
        <label key={o.id}>
          <input
            type="checkbox"
            checked={value.includes(o.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, o.id] : value.filter((id) => id !== o.id))
            }
          />
          {o.name}
        </label>
      ))}
    </div>
  );
}

function RowStatusChip({ row }: { row: Row<unknown> }) {
  if (row.status === 'draft') return <span className="chip chip-amber">草稿</span>;
  if (row.status === 'dirty') return <span className="chip chip-blue">已改</span>;
  if (row.status === 'deleted') return <span className="chip chip-gray">待删除</span>;
  return null;
}

interface ToolbarProps {
  pendingCount: number;
  saving: boolean;
  onAdd: () => void;
  /** 不传则隐藏（该库不支持 AI 提炼/粘贴表格时） */
  onExtract?: () => void;
  onPaste?: () => void;
  onReload: () => void;
  onSave: () => void;
}

function Toolbar({ pendingCount, saving, onAdd, onExtract, onPaste, onReload, onSave }: ToolbarProps) {
  return (
    <div className="lib-toolbar">
      <button className="btn btn-ghost btn-sm" onClick={onAdd}>＋ 新增行</button>
      {onExtract && <button className="btn btn-ghost btn-sm" onClick={onExtract}>🤖 AI 提炼</button>}
      {onPaste && <button className="btn btn-ghost btn-sm" onClick={onPaste}>📋 粘贴表格</button>}
      <button className="btn btn-ghost btn-sm" onClick={onReload}>↻ 刷新</button>
      <span style={{ flex: 1 }} />
      {pendingCount > 0 && <span className="chip chip-amber">{pendingCount} 项待保存</span>}
      <button className="btn btn-primary btn-sm" disabled={saving || pendingCount === 0} onClick={onSave}>
        {saving ? '保存中…' : '保存全部改动'}
      </button>
    </div>
  );
}

/** ===== 行内/弹窗共用的子结构编辑器 ===== */

function LevelsEditor({ levels, onChange }: { levels: ScoreLevel[]; onChange: (levels: ScoreLevel[]) => void }) {
  const update = (idx: number, patch: Partial<ScoreLevel>) =>
    onChange(levels.map((lv, i) => (i === idx ? { ...lv, ...patch } : lv)));
  return (
    <div>
      <table className="lib-table">
        <thead><tr><th>key</th><th>档位名</th><th>分数</th><th>描述</th><th></th></tr></thead>
        <tbody>
          {levels.map((lv, idx) => (
            <tr key={idx}>
              <td><CellInput value={lv.key} onChange={(v) => update(idx, { key: v })} /></td>
              <td><CellInput value={lv.label} onChange={(v) => update(idx, { label: v })} /></td>
              <td><CellInput type="number" value={lv.score} onChange={(v) => update(idx, { score: Number(v) })} /></td>
              <td><CellInput value={lv.description} onChange={(v) => update(idx, { description: v })} /></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => onChange(levels.filter((_, i) => i !== idx))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 8 }}
        onClick={() => onChange([...levels, { key: `lv${levels.length + 1}`, label: '', score: 0, description: '' }])}
      >
        ＋ 加一档
      </button>
    </div>
  );
}

function TranscriptEditor({ transcript, onChange }: {
  transcript: GoldenCase['transcript'];
  onChange: (t: GoldenCase['transcript']) => void;
}) {
  const update = (idx: number, patch: Partial<GoldenCase['transcript'][number]>) =>
    onChange(transcript.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  return (
    <div>
      <table className="lib-table">
        <thead><tr><th>#</th><th>角色</th><th>内容</th><th></th></tr></thead>
        <tbody>
          {transcript.map((t, idx) => (
            <tr key={idx}>
              <td>{t.seq}</td>
              <td>
                <select className="lib-cell" value={t.speaker} onChange={(e) => update(idx, { speaker: e.target.value as 'trainee' | 'persona' })}>
                  <option value="trainee">学员</option>
                  <option value="persona">客户</option>
                </select>
              </td>
              <td style={{ minWidth: 320 }}><CellTextarea value={t.text} rows={1} onChange={(v) => update(idx, { text: v })} /></td>
              <td>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onChange(transcript.filter((_, i) => i !== idx).map((t2, i) => ({ ...t2, seq: i + 1 })))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 8 }}
        onClick={() => onChange([...transcript, { seq: transcript.length + 1, speaker: 'trainee', text: '' }])}
      >
        ＋ 加一轮
      </button>
    </div>
  );
}

function ExpectedEditor({ expected, onChange, scoreItems }: {
  expected: GoldenCase['expected'];
  onChange: (e: GoldenCase['expected']) => void;
  scoreItems: ScoreItemDef[];
}) {
  const update = (idx: number, patch: Partial<GoldenCase['expected'][number]>) =>
    onChange(expected.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  return (
    <div>
      <table className="lib-table">
        <thead><tr><th>评分项</th><th>期望档位 key</th><th></th></tr></thead>
        <tbody>
          {expected.map((e, idx) => (
            <tr key={idx}>
              <td>
                <select className="lib-cell" value={e.itemId} onChange={(ev) => update(idx, { itemId: ev.target.value })}>
                  <option value="">选择评分项…</option>
                  {scoreItems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  {e.itemId && !scoreItems.some((s) => s.id === e.itemId) && <option value={e.itemId}>{e.itemId}（未匹配）</option>}
                </select>
              </td>
              <td><CellInput value={e.levelKey} onChange={(v) => update(idx, { levelKey: v })} placeholder="如 excellent" /></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => onChange(expected.filter((_, i) => i !== idx))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 8 }}
        onClick={() => onChange([...expected, { itemId: '', levelKey: '' }])}
      >
        ＋ 加一项
      </button>
    </div>
  );
}

function ParticipantsEditor({ participants, onChange }: {
  participants: ScenarioParticipant[];
  onChange: (p: ScenarioParticipant[]) => void;
}) {
  const update = (idx: number, patch: Partial<ScenarioParticipant>) =>
    onChange(participants.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  return (
    <div>
      {participants.map((p, idx) => (
        <div key={idx} className="lib-participant">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              value={p.name}
              placeholder="参与者名称/角色（必填）"
              onChange={(e) => update(idx, { name: e.target.value })}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => onChange(participants.filter((_, i) => i !== idx))}>✕</button>
          </div>
          <div className="lib-form">
            <Field label="主要特征"><MInput value={p.traits} onChange={(v) => update(idx, { traits: v || undefined })} /></Field>
            <Field label="说话特点"><MInput value={p.speakingStyle} onChange={(v) => update(idx, { speakingStyle: v || undefined })} /></Field>
            <Field label="话语范围"><MInput value={p.speechScope} onChange={(v) => update(idx, { speechScope: v || undefined })} /></Field>
            <Field label="言语要求"><MInput value={p.languageRequirements} onChange={(v) => update(idx, { languageRequirements: v || undefined })} /></Field>
            <Field label="参与目的" wide><MInput value={p.goal} onChange={(v) => update(idx, { goal: v || undefined })} /></Field>
          </div>
        </div>
      ))}
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => onChange([...participants, { name: '' }])}
      >
        ＋ 加一位参与者
      </button>
    </div>
  );
}

/** ===== 页面 ===== */

type TabKey = 'scenarios' | 'questions' | 'score-items' | 'golden-cases' | 'analysis-standards' | 'realism-standards' | 'guidance';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'scenarios', label: '场景库' },
  { key: 'questions', label: '客户提问库' },
  { key: 'score-items', label: '评分项' },
  { key: 'golden-cases', label: '金标准案例' },
  { key: 'analysis-standards', label: '分析标准库' },
  { key: 'realism-standards', label: '真实度标准库' },
  { key: 'guidance', label: '场景引导包' },
];

const DIFF_LABELS: Record<number, string> = { 1: '初级', 2: '进阶', 3: '挑战' };

/** 场景库「配置引导」跳转引导包 Tab 时携带的目标 */
interface GuidanceFocus {
  id?: string;
  scenarioId?: string;
  name?: string;
}

export default function Library() {
  const navigate = useNavigate();
  const isAdmin = getStoredUser()?.role === 'admin';
  const [tab, setTab] = useState<TabKey>('scenarios');
  const [notice, setNotice] = useState<string | null>(null);
  const [skillPoints, setSkillPoints] = useState<SkillPoint[]>([]);
  const [personas, setPersonas] = useState<PersonaConfig[]>([]);
  const [scoreItems, setScoreItems] = useState<ScoreItemDef[]>([]);
  /** 已配置的引导包列表（场景库「引导包」列用；引导包 Tab 保存后通过 reloadGuidances 刷新） */
  const [guidances, setGuidances] = useState<ScenarioGuidance[]>([]);
  const [guidanceFocus, setGuidanceFocus] = useState<GuidanceFocus | null>(null);

  const reloadGuidances = () => {
    listScenarioGuidances().then((r) => setGuidances(r.items)).catch(() => {});
  };

  useEffect(() => {
    fetchSkillPoints().then((r) => setSkillPoints(r.skillPoints)).catch(() => {});
    fetchPersonaConfigs().then((r) => setPersonas(r.personaConfigs)).catch(() => {});
    listScoreItems().then((r) => setScoreItems(r.items)).catch(() => {});
    reloadGuidances();
  }, []);

  /** 场景库跳转：已有引导包 → 打开编辑；未配置 → 新建草稿并预填场景 */
  const configureGuidance = (focus: GuidanceFocus) => {
    setGuidanceFocus(focus);
    setTab('guidance');
    setNotice(null);
  };

  if (!isAdmin) {
    return (
      <div className="section">
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <h3>仅管理员可访问资源库管理</h3>
          <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => navigate('/build')}>返回构建页</button>
        </div>
      </div>
    );
  }

  return (
    <div className="section" style={{ paddingTop: 16 }}>
      <div className="sec-head">
        <h2><span>🗂</span> 资源库管理</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/build')}>← 返回构建</button>
      </div>

      <div className="seg seg-lg" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => { setTab(t.key); setNotice(null); }}>
            {t.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="card" style={{ padding: '10px 16px', marginBottom: 12, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{notice}</span>
          <button className="act-btn" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      {tab === 'scenarios' && (
        <ScenarioTab skillPoints={skillPoints} personas={personas} guidances={guidances} onConfigureGuidance={configureGuidance} setNotice={setNotice} />
      )}
      {tab === 'questions' && <QuestionTab skillPoints={skillPoints} setNotice={setNotice} />}
      {tab === 'score-items' && (
        <ScoreItemTab skillPoints={skillPoints} setNotice={setNotice} onChanged={() => listScoreItems().then((r) => setScoreItems(r.items)).catch(() => {})} />
      )}
      {tab === 'golden-cases' && <GoldenCaseTab scoreItems={scoreItems} setNotice={setNotice} />}
      {tab === 'analysis-standards' && (
        <StandardTab
          categoryOptions={ANALYSIS_CATEGORY_OPTIONS}
          hasExample
          emptyDraft={{ name: '', category: 'method', description: '' }}
          extractTarget="analysis-standard"
          pasteExample={'名称\t分类\t说明\t示例\n语速平稳\t语速\t保持 200-240 字/分钟，重点词放慢\t介绍价格时放慢报数'}
          list={() => listAnalysisStandards().then((r) => r.items)}
          save={saveAnalysisStandard}
          remove={deleteAnalysisStandard}
          setNotice={setNotice}
        />
      )}
      {tab === 'realism-standards' && (
        <StandardTab
          categoryOptions={REALISM_CATEGORY_OPTIONS}
          hasExample={false}
          emptyDraft={{ name: '', category: 'reaction', description: '' }}
          extractTarget="realism-standard"
          pasteExample={'名称\t分类\t说明\n直接拒绝\t拒绝行为\t客户不问理由直接拒绝，测试销售的第一反应'}
          list={() => listRealismStandards().then((r) => r.items)}
          save={saveRealismStandard}
          remove={deleteRealismStandard}
          setNotice={setNotice}
        />
      )}
      {tab === 'guidance' && (
        <GuidanceTab
          focus={guidanceFocus}
          onFocusHandled={() => setGuidanceFocus(null)}
          onChanged={reloadGuidances}
          setNotice={setNotice}
        />
      )}
    </div>
  );
}

/** ===== Tab 5/6：分析标准库 / 真实度标准库（同一套行内编辑表格，仅分类选项与有无示例列不同） ===== */

const ANALYSIS_CATEGORY_OPTIONS = [
  { value: 'tone', label: '语调' },
  { value: 'pace', label: '语速' },
  { value: 'method', label: '关键方法' },
  { value: 'etiquette', label: '礼仪' },
];

const REALISM_CATEGORY_OPTIONS = [
  { value: 'reaction', label: '反应自然度' },
  { value: 'objection', label: '拒绝行为' },
  { value: 'stalling', label: '拖延行为' },
  { value: 'emotion', label: '情绪变化' },
];

interface StandardRowData {
  id?: string;
  name: string;
  category: string;
  description: string;
  example?: string;
}

function StandardTab({ categoryOptions, hasExample, emptyDraft, extractTarget, pasteExample, list, save, remove, setNotice }: {
  categoryOptions: { value: string; label: string }[];
  hasExample: boolean;
  /** AI 提炼 target（后端 /library/extract 已支持） */
  extractTarget: 'analysis-standard' | 'realism-standard';
  /** 粘贴表格示例文本 */
  pasteExample: string;
  emptyDraft: StandardRowData;
  list: () => Promise<(AnalysisStandard | RealismStandard)[]>;
  save: (d: StandardRowData) => Promise<StandardRowData>;
  remove: (id: string) => Promise<unknown>;
  setNotice: (s: string | null) => void;
}) {
  const { rows, setRows, loadRows, addDrafts, updateRow, toggleDelete } = useRows<StandardRowData>();
  const [panel, setPanel] = useState<'extract' | 'paste' | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    setLoading(true);
    list()
      .then((items) => loadRows(items.map((s) => ({ id: s.id, name: s.name, category: s.category, description: s.description, example: 'example' in s ? s.example : undefined }))))
      .catch((err) => setNotice(apiError(err, '加载标准库失败')))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 分类值解析：英文枚举原样保留，中文标签映射回枚举值，其余按自定义保留并提示 */
  const resolveCategory = (v: string): { category: string; warn?: string } => {
    const t = v.trim();
    if (!t) return { category: emptyDraft.category };
    const byValue = categoryOptions.find((c) => c.value === t);
    if (byValue) return { category: byValue.value };
    const byLabel = categoryOptions.find((c) => c.label === t);
    if (byLabel) return { category: byLabel.value };
    return { category: t, warn: `分类「${t}」未匹配，已按自定义保留` };
  };

  const mapExtracted = (r: Record<string, unknown>): { data: StandardRowData; warn?: string[] } => {
    const cat = resolveCategory(String(r.category ?? ''));
    return {
      data: {
        name: String(r.name ?? ''),
        category: cat.category,
        description: String(r.description ?? ''),
        example: hasExample && r.example ? String(r.example) : undefined,
      },
      warn: cat.warn ? [cat.warn] : undefined,
    };
  };

  const mapPasted = (cells: string[][]): { data: StandardRowData; warn?: string[] }[] =>
    cells.map((c) => {
      const cat = resolveCategory(c[1] ?? '');
      return {
        data: {
          name: c[0] ?? '',
          category: cat.category,
          description: c[2] ?? '',
          example: hasExample ? c[3] || undefined : undefined,
        },
        warn: cat.warn ? [cat.warn] : undefined,
      };
    });

  const pasteHeaders = hasExample ? ['名称', '分类', '说明', '示例'] : ['名称', '分类', '说明'];

  const handlers: SaveHandlers<StandardRowData> = {
    validate: (d) => {
      if (!d.name?.trim()) return '名称必填';
      if (!d.category) return '请选择分类';
      if (!d.description?.trim()) return '说明必填';
      return null;
    },
    // 后端 upsert：带 id 更新，否则新建
    create: (d) => save(d),
    update: (id, d) => save({ ...d, id }),
    remove: (id) => remove(id),
  };

  const pendingCount = rows.filter((r) => r.status !== 'clean').length;

  const saveAll = async () => {
    setSaving(true);
    const { saved, failed } = await saveRows(rows, handlers, setRows);
    setSaving(false);
    setNotice(`保存完成：成功 ${saved} 项${failed ? `，失败 ${failed} 项（见行内提示）` : ''}`);
    if (saved > 0) reload();
  };

  return (
    <div className="card lib-card">
      <Toolbar
        pendingCount={pendingCount}
        saving={saving}
        onAdd={() => addDrafts([{ data: { ...emptyDraft } }])}
        onExtract={() => setPanel('extract')}
        onPaste={() => setPanel('paste')}
        onReload={reload}
        onSave={saveAll}
      />
      {loading ? (
        <p style={{ padding: 16, color: '#6B7280', fontSize: 13 }}>加载中…</p>
      ) : (
        <div className="lib-table-wrap">
          <table className="lib-table">
            <thead>
              <tr>
                <th>状态</th><th>名称</th><th>分类</th><th>说明</th>{hasExample && <th>示例</th>}<th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={`lib-row-${row.status}`}>
                  <td><RowStatusChip row={row} />{row.error && <div className="lib-err">{row.error}</div>}</td>
                  <td><CellInput value={row.data.name} onChange={(v) => updateRow(row.key, { name: v })} /></td>
                  <td>
                    <select className="lib-cell" value={row.data.category} onChange={(e) => updateRow(row.key, { category: e.target.value })}>
                      {categoryOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      {row.data.category && !categoryOptions.some((c) => c.value === row.data.category) && (
                        <option value={row.data.category}>{row.data.category}（自定义）</option>
                      )}
                    </select>
                  </td>
                  <td style={{ minWidth: 260 }}><CellTextarea value={row.data.description} onChange={(v) => updateRow(row.key, { description: v })} /></td>
                  {hasExample && (
                    <td style={{ minWidth: 200 }}><CellTextarea value={row.data.example} onChange={(v) => updateRow(row.key, { example: v || undefined })} /></td>
                  )}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleDelete(row.key)}>
                      {row.status === 'deleted' ? '恢复' : '删除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {panel === 'extract' && (
        <ExtractPanel target={extractTarget} onClose={() => setPanel(null)} onRows={(rs) => addDrafts(rs.map(mapExtracted))} />
      )}
      {panel === 'paste' && (
        <PastePanel
          headers={pasteHeaders}
          example={pasteExample}
          onClose={() => setPanel(null)}
          onRows={(rs) => addDrafts(mapPasted(rs))}
        />
      )}
    </div>
  );
}

/** ===== AI 提炼 / 粘贴表格 面板（各 Tab 复用） ===== */

function ExtractPanel({ target, onClose, onRows }: {
  target: 'scenario' | 'question' | 'score-item' | 'golden-case' | 'analysis-standard' | 'realism-standard';
  onClose: () => void;
  onRows: (rows: Record<string, unknown>[]) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await extractLibraryRows(target, text.trim());
      setReply(res.reply);
      if (res.rows.length === 0) setError('未提炼出有效条目，可换一段文字重试');
      else {
        onRows(res.rows);
        onClose();
      }
    } catch (err) {
      setError(apiError(err, '提炼失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="🤖 AI 提炼：整段文字 → 表格行" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 8px' }}>
        粘贴培训材料、会议纪要、话术文档等整段文字，AI 会提炼为结构化条目加入表格（草稿状态，确认后才入库）。
      </p>
      <textarea className="input" rows={8} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="在此粘贴整段文字…" />
      {reply && <p style={{ fontSize: 13, color: '#2FAE7B', margin: '8px 0 0' }}>{reply}</p>}
      {error && <p style={{ fontSize: 13, color: '#E85A4A', margin: '8px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>取消</button>
        <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={run}>
          {busy ? '提炼中…' : '开始提炼'}
        </button>
      </div>
    </Panel>
  );
}

function PastePanel({ headers, example, onClose, onRows }: {
  headers: string[];
  example: string;
  onClose: () => void;
  onRows: (rows: string[][]) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    const parsed = parseTableText(text, headers);
    if (parsed.length === 0) {
      setError('未解析到有效行');
      return;
    }
    onRows(parsed);
    onClose();
  };

  return (
    <Panel title="📋 粘贴表格（Excel / TSV / CSV）" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 8px' }}>
        从 Excel 复制后直接粘贴（Tab 分隔），或用逗号/分号分隔。列顺序：{headers.join(' / ')}。首行是表头会自动跳过。
      </p>
      <textarea className="input" rows={8} style={{ width: '100%' }} value={text} onChange={(e) => { setText(e.target.value); setError(null); }} placeholder={example} />
      {error && <p style={{ fontSize: 13, color: '#E85A4A', margin: '8px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>取消</button>
        <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={run}>解析并加入表格</button>
      </div>
    </Panel>
  );
}

/** ===== Tab 1：场景库 ===== */

interface ScenarioRowData {
  id?: string;
  name: string;
  sceneType: 'drill' | 'practical';
  difficulty: number;
  durationMinutes: number;
  passScore: number;
  personaConfigId: string;
  skillPointIds: string[];
  methodology?: string;
  source?: string;
  coverageTopics?: string[];
  productKBId?: string;
  script?: NonNullable<Scenario['script']>;
  participants?: ScenarioParticipant[];
}

const SCENARIO_HEADERS = ['名称', '类型', '难度', '时长', '及格分', '角色', '技能点', '方法论', '话题'];

function toScenarioRow(s: Scenario): ScenarioRowData {
  return {
    id: s.id,
    name: s.name,
    sceneType: s.sceneType ?? 'practical',
    difficulty: s.difficulty ?? 1,
    durationMinutes: s.durationMinutes,
    passScore: s.successCriteria?.passScore ?? 70,
    personaConfigId: s.personaConfigId,
    skillPointIds: s.skillPointIds ?? [],
    methodology: s.methodology,
    source: s.source,
    coverageTopics: s.coverageTopics,
    productKBId: s.productKBId,
    script: s.script,
    participants: s.participants,
  };
}

function toScenarioPayload(d: ScenarioRowData) {
  return {
    name: d.name.trim(),
    personaConfigId: d.personaConfigId,
    skillPointIds: d.skillPointIds,
    passScore: d.passScore,
    durationMinutes: d.durationMinutes,
    difficulty: d.difficulty,
    coverageTopics: d.coverageTopics,
    methodology: d.methodology,
    source: d.source,
    sceneType: d.sceneType,
    productKBId: d.productKBId,
    script: d.script ?? null,
    participants: d.participants ?? null,
  };
}

function ScenarioTab({ skillPoints, personas, guidances, onConfigureGuidance, setNotice }: {
  skillPoints: SkillPoint[];
  personas: PersonaConfig[];
  guidances: ScenarioGuidance[];
  onConfigureGuidance: (focus: GuidanceFocus) => void;
  setNotice: (s: string | null) => void;
}) {
  const { rows, setRows, loadRows, addDrafts, updateRow, markSaved, markError, toggleDelete } = useRows<ScenarioRowData>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingOne, setSavingOne] = useState(false);
  const [panel, setPanel] = useState<'extract' | 'paste' | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    fetchScenarios()
      .then((r) => loadRows(r.scenarios.map(toScenarioRow)))
      .catch((err) => setNotice(apiError(err, '加载场景失败')))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlers: SaveHandlers<ScenarioRowData> = {
    validate: (d) => {
      if (!d.name?.trim()) return '名称必填';
      if (!d.personaConfigId) return '请选择陪练角色';
      if (!d.skillPointIds.length) return '请至少选择一个技能点';
      if (!Number.isFinite(d.passScore) || !Number.isFinite(d.durationMinutes)) return '及格分/时长必须为数字';
      return null;
    },
    create: async (d) => toScenarioRow(await createScenario(toScenarioPayload(d))),
    update: async (id, d) => toScenarioRow(await updateScenario(id, toScenarioPayload(d))),
    remove: (id) => deleteScenario(id),
  };

  const pendingCount = rows.filter((r) => r.status !== 'clean').length;

  const saveAll = async () => {
    setSaving(true);
    const { saved, failed } = await saveRows(rows, handlers, setRows);
    setSaving(false);
    setNotice(`保存完成：成功 ${saved} 项${failed ? `，失败 ${failed} 项（见行内提示）` : ''}`);
    if (saved > 0) reload();
  };

  const saveOne = async (row: Row<ScenarioRowData>) => {
    const invalid = handlers.validate(row.data);
    if (invalid) return markError(row.key, invalid);
    setSavingOne(true);
    try {
      const saved = row.status === 'draft'
        ? await handlers.create(row.data)
        : await handlers.update(row.data.id!, row.data);
      markSaved(row.key, saved);
      setNotice('已保存此行');
    } catch (err) {
      markError(row.key, apiError(err, '保存失败'));
    } finally {
      setSavingOne(false);
    }
  };

  const mapExtracted = (r: Record<string, unknown>): { data: ScenarioRowData; warn?: string[] } => {
    const warn: string[] = [];
    if (r.unresolvedPersona) warn.push(`角色「${String(r.unresolvedPersona)}」未匹配，请手动选择`);
    if (Array.isArray(r.unresolvedSkillPoints) && r.unresolvedSkillPoints.length > 0) {
      warn.push(`技能点未匹配：${(r.unresolvedSkillPoints as string[]).join('、')}`);
    }
    const sceneType = r.sceneType === 'drill' ? 'drill' : 'practical';
    return {
      data: {
        name: String(r.name ?? ''),
        sceneType,
        difficulty: Number(r.difficulty) || 1,
        durationMinutes: Number(r.durationMinutes) || 10,
        passScore: Number(r.passScore) || 70,
        personaConfigId: String(r.personaConfigId ?? ''),
        skillPointIds: Array.isArray(r.skillPointIds) ? (r.skillPointIds as string[]) : [],
        methodology: r.methodology ? String(r.methodology) : undefined,
        coverageTopics: Array.isArray(r.coverageTopics) ? (r.coverageTopics as string[]) : undefined,
      },
      warn: warn.length > 0 ? warn : undefined,
    };
  };

  const mapPasted = (cells: string[][]): { data: ScenarioRowData; warn?: string[] }[] =>
    cells.map((c) => {
      const warn: string[] = [];
      const personaName = c[5];
      const persona = personaName ? personas.find((p) => p.name === personaName) : undefined;
      if (personaName && !persona) warn.push(`角色「${personaName}」未匹配，请手动选择`);
      const spNames = (c[6] ?? '').split(/[、/]/).map((s) => s.trim()).filter(Boolean);
      const ids: string[] = [];
      const missed: string[] = [];
      for (const n of spNames) {
        const sp = skillPoints.find((s) => s.name === n);
        if (sp) ids.push(sp.id);
        else missed.push(n);
      }
      if (missed.length > 0) warn.push(`技能点未匹配：${missed.join('、')}`);
      const typeText = c[1] ?? '';
      const sceneType = /实战|自由/.test(typeText) || typeText === 'drill' ? 'drill' as const : 'practical' as const;
      return {
        data: {
          name: c[0] ?? '',
          sceneType,
          difficulty: num(c[2]) ?? 1,
          durationMinutes: num(c[3]) ?? 10,
          passScore: num(c[4]) ?? 70,
          personaConfigId: persona?.id ?? '',
          skillPointIds: ids,
          methodology: c[7] || undefined,
          coverageTopics: c[8] ? c[8].split(/[、/]/).map((s) => s.trim()).filter(Boolean) : undefined,
        },
        warn: warn.length > 0 ? warn : undefined,
      };
    });

  const detailRow = rows.find((r) => r.key === detailKey);

  return (
    <div className="card lib-card">
      <Toolbar
        pendingCount={pendingCount}
        saving={saving}
        onAdd={() => addDrafts([{ data: { name: '', sceneType: 'practical', difficulty: 1, durationMinutes: 10, passScore: 70, personaConfigId: '', skillPointIds: [] } }])}
        onExtract={() => setPanel('extract')}
        onPaste={() => setPanel('paste')}
        onReload={reload}
        onSave={saveAll}
      />
      {loading ? (
        <p style={{ padding: 16, color: '#6B7280', fontSize: 13 }}>加载中…</p>
      ) : (
        <div className="lib-table-wrap">
          <table className="lib-table">
            <thead>
              <tr>
                <th>状态</th><th>名称</th><th>类型</th><th>难度</th><th>时长(分)</th><th>及格分</th>
                <th>陪练角色</th><th>技能点</th><th>方法论</th><th>话题</th><th>引导包</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={`lib-row-${row.status}`}>
                  <td><RowStatusChip row={row} />{row.error && <div className="lib-err">{row.error}</div>}
                    {row.warn?.map((w) => <div key={w} className="lib-warn">{w}</div>)}
                  </td>
                  <td><CellInput value={row.data.name} onChange={(v) => updateRow(row.key, { name: v })} /></td>
                  <td>
                    <select className="lib-cell" value={row.data.sceneType} onChange={(e) => updateRow(row.key, { sceneType: e.target.value as 'drill' | 'practical' })}>
                      <option value="practical">实用场景</option>
                      <option value="drill">实战训练</option>
                    </select>
                  </td>
                  <td>
                    <select className="lib-cell" value={row.data.difficulty} onChange={(e) => updateRow(row.key, { difficulty: Number(e.target.value) })}>
                      {[1, 2, 3].map((d) => <option key={d} value={d}>{DIFF_LABELS[d]}</option>)}
                    </select>
                  </td>
                  <td><CellInput type="number" value={row.data.durationMinutes} onChange={(v) => updateRow(row.key, { durationMinutes: Number(v) })} /></td>
                  <td><CellInput type="number" value={row.data.passScore} onChange={(v) => updateRow(row.key, { passScore: Number(v) })} /></td>
                  <td>
                    <select className="lib-cell" value={row.data.personaConfigId} onChange={(e) => updateRow(row.key, { personaConfigId: e.target.value })}>
                      <option value="">选择角色…</option>
                      {personas.map((p) => <option key={p.id} value={p.id}>{p.name}{p.occupation ? `（${p.occupation}）` : ''}</option>)}
                    </select>
                  </td>
                  <td><SkillPointPicker value={row.data.skillPointIds} options={skillPoints} onChange={(ids) => updateRow(row.key, { skillPointIds: ids })} /></td>
                  <td><CellInput value={row.data.methodology} onChange={(v) => updateRow(row.key, { methodology: v || undefined })} /></td>
                  <td><CellInput value={row.data.coverageTopics?.join('、')} onChange={(v) => updateRow(row.key, { coverageTopics: v ? v.split(/[、/]/).map((s) => s.trim()).filter(Boolean) : undefined })} placeholder="话题1、话题2" /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {row.data.id ? (() => {
                      const g = guidances.find((x) => x.scenarioId === row.data.id);
                      return g ? (
                        <button className="btn btn-ghost btn-sm" title={`编辑引导包「${g.name}」`} onClick={() => onConfigureGuidance({ id: g.id })}>已配置 ✓</button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => onConfigureGuidance({ scenarioId: row.data.id!, name: row.data.name })}>配置引导</button>
                      );
                    })() : <span style={{ color: '#9CA3AF', fontSize: 12 }}>保存后可配置</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {row.status !== 'deleted' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setDetailKey(row.key)}>详情</button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleDelete(row.key)}>
                      {row.status === 'deleted' ? '恢复' : '删除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {panel === 'extract' && <ExtractPanel target="scenario" onClose={() => setPanel(null)} onRows={(rs) => addDrafts(rs.map(mapExtracted))} />}
      {panel === 'paste' && (
        <PastePanel
          headers={SCENARIO_HEADERS}
          example={'名称\t类型\t难度\t时长\t及格分\t角色\t技能点\t方法论\t话题\n首次拜访消化科主任\t实用场景\t2\t10\t70\t王主任\t破冰、需求挖掘\t张伟三步破冰法\t产品优势、临床数据'}
          onClose={() => setPanel(null)}
          onRows={(rs) => addDrafts(mapPasted(rs))}
        />
      )}
      {detailRow && (
        <DetailModal
          title={`场景详情：${detailRow.data.name || '（未命名）'}`}
          saving={savingOne}
          onSave={() => saveOne(detailRow)}
          onClose={() => setDetailKey(null)}
        >
          <Field label="名称" wide><MInput value={detailRow.data.name} onChange={(v) => updateRow(detailRow.key, { name: v })} /></Field>
          <Field label="类型">
            <select className="input" value={detailRow.data.sceneType} onChange={(e) => updateRow(detailRow.key, { sceneType: e.target.value as 'drill' | 'practical' })}>
              <option value="practical">实用场景（有剧本）</option>
              <option value="drill">实战训练（自由对练）</option>
            </select>
          </Field>
          <Field label="难度">
            <select className="input" value={detailRow.data.difficulty} onChange={(e) => updateRow(detailRow.key, { difficulty: Number(e.target.value) })}>
              {[1, 2, 3].map((d) => <option key={d} value={d}>{DIFF_LABELS[d]}</option>)}
            </select>
          </Field>
          <Field label="时长（分钟）"><MInput type="number" value={detailRow.data.durationMinutes} onChange={(v) => updateRow(detailRow.key, { durationMinutes: Number(v) })} /></Field>
          <Field label="及格分"><MInput type="number" value={detailRow.data.passScore} onChange={(v) => updateRow(detailRow.key, { passScore: Number(v) })} /></Field>
          <Field label="陪练角色">
            <select className="input" value={detailRow.data.personaConfigId} onChange={(e) => updateRow(detailRow.key, { personaConfigId: e.target.value })}>
              <option value="">选择角色…</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.name}{p.occupation ? `（${p.occupation}）` : ''}</option>)}
            </select>
          </Field>
          <Field label="方法论标签"><MInput value={detailRow.data.methodology} onChange={(v) => updateRow(detailRow.key, { methodology: v || undefined })} placeholder="如「张伟三步破冰法 · L2」" /></Field>
          <Field label="来源"><MInput value={detailRow.data.source} onChange={(v) => updateRow(detailRow.key, { source: v || undefined })} placeholder="官方 / 企业定制 / 自建" /></Field>
          <Field label="产品知识库 ID"><MInput value={detailRow.data.productKBId} onChange={(v) => updateRow(detailRow.key, { productKBId: v || undefined })} placeholder="可选，优先于角色默认知识库" /></Field>
          <Field label="考核技能点" wide>
            <SkillPointChecks value={detailRow.data.skillPointIds} options={skillPoints} onChange={(ids) => updateRow(detailRow.key, { skillPointIds: ids })} />
          </Field>
          <Field label="覆盖话题" wide>
            <LinesTextarea value={detailRow.data.coverageTopics} onChange={(v) => updateRow(detailRow.key, { coverageTopics: v })} placeholder="学员需覆盖的话题点，每行一条" />
          </Field>
          {detailRow.data.sceneType !== 'drill' && (
            <div className="lib-fieldset">
              <h4>剧本</h4>
              <div className="lib-form">
                <Field label="执行顺序（流程/步骤）" wide>
                  <MTextarea value={detailRow.data.script?.executionOrder} onChange={(v) => updateRow(detailRow.key, { script: { ...detailRow.data.script, executionOrder: v || undefined } })} />
                </Field>
                <Field label="目的" wide>
                  <MTextarea value={detailRow.data.script?.purpose} rows={2} onChange={(v) => updateRow(detailRow.key, { script: { ...detailRow.data.script, purpose: v || undefined } })} />
                </Field>
                <Field label="话题" wide>
                  <LinesTextarea value={detailRow.data.script?.topics} onChange={(v) => updateRow(detailRow.key, { script: { ...detailRow.data.script, topics: v } })} />
                </Field>
                <Field label="客户的主要问题" wide>
                  <LinesTextarea value={detailRow.data.script?.customerQuestions} onChange={(v) => updateRow(detailRow.key, { script: { ...detailRow.data.script, customerQuestions: v } })} />
                </Field>
                <Field label="主要考核点" wide>
                  <LinesTextarea value={detailRow.data.script?.assessmentPoints} onChange={(v) => updateRow(detailRow.key, { script: { ...detailRow.data.script, assessmentPoints: v } })} />
                </Field>
              </div>
            </div>
          )}
          <div className="lib-fieldset">
            <h4>参与者设定</h4>
            <ParticipantsEditor
              participants={detailRow.data.participants ?? []}
              onChange={(p) => updateRow(detailRow.key, { participants: p })}
            />
          </div>
        </DetailModal>
      )}
    </div>
  );
}

/** ===== Tab 2：客户提问库 ===== */

type QuestionRowData = Partial<CustomerQuestion> & { id?: string };

const QUESTION_HEADERS = ['分类', '问题', '参考应答', '难度', '频率', '技能点'];

function QuestionTab({ skillPoints, setNotice }: { skillPoints: SkillPoint[]; setNotice: (s: string | null) => void }) {
  const { rows, setRows, loadRows, addDrafts, updateRow, markSaved, markError, toggleDelete } = useRows<QuestionRowData>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingOne, setSavingOne] = useState(false);
  const [panel, setPanel] = useState<'extract' | 'paste' | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    listCustomerQuestions()
      .then((r) => loadRows(r.questions))
      .catch((err) => setNotice(apiError(err, '加载问题库失败')))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (d: QuestionRowData) => (!d.category?.trim() || !d.question?.trim() ? '分类 / 问题必填' : null);

  const pendingCount = rows.filter((r) => r.status !== 'clean').length;
  const draftRows = rows.filter((r) => r.status === 'draft');

  const saveAll = async () => {
    setSaving(true);
    let saved = 0;
    let failed = 0;
    const validDrafts: QuestionRowData[] = [];
    for (const row of draftRows) {
      const invalid = validate(row.data);
      if (invalid) {
        failed += 1;
        markError(row.key, invalid);
      } else {
        validDrafts.push(row.data);
      }
    }
    if (validDrafts.length > 0) {
      try {
        await batchCreateCustomerQuestions(validDrafts.map((d) => ({
          category: d.category!.trim(),
          question: d.question!.trim(),
          referenceAnswer: d.referenceAnswer,
          difficulty: d.difficulty,
          skillPointIds: d.skillPointIds,
          frequency: d.frequency,
        })));
        saved += validDrafts.length;
      } catch (err) {
        failed += validDrafts.length;
        setNotice(apiError(err, '批量保存失败'));
      }
    }
    const rest = await saveRows(rows.filter((r) => r.status === 'dirty' || r.status === 'deleted'), {
      validate,
      create: (d) => createCustomerQuestion(d),
      update: (id, d) => updateCustomerQuestion(id, d),
      remove: (id) => deleteCustomerQuestion(id),
    }, setRows);
    saved += rest.saved;
    failed += rest.failed;
    setSaving(false);
    setNotice(`保存完成：成功 ${saved} 项${failed ? `，失败 ${failed} 项（见行内提示）` : ''}`);
    if (saved > 0) reload();
  };

  const saveOne = async (row: Row<QuestionRowData>) => {
    const invalid = validate(row.data);
    if (invalid) return markError(row.key, invalid);
    setSavingOne(true);
    try {
      const saved = row.status === 'draft'
        ? await createCustomerQuestion(row.data)
        : await updateCustomerQuestion(row.data.id!, row.data);
      markSaved(row.key, saved);
      setNotice('已保存此行');
    } catch (err) {
      markError(row.key, apiError(err, '保存失败'));
    } finally {
      setSavingOne(false);
    }
  };

  const mapExtracted = (r: Record<string, unknown>): { data: QuestionRowData; warn?: string[] } => {
    const warn: string[] = [];
    if (Array.isArray(r.unresolvedSkillPoints) && r.unresolvedSkillPoints.length > 0) {
      warn.push(`技能点未匹配：${(r.unresolvedSkillPoints as string[]).join('、')}`);
    }
    return {
      data: {
        category: String(r.category ?? ''),
        question: String(r.question ?? ''),
        referenceAnswer: r.referenceAnswer ? String(r.referenceAnswer) : undefined,
        difficulty: Number(r.difficulty) || undefined,
        frequency: Number(r.frequency) || undefined,
        skillPointIds: Array.isArray(r.skillPointIds) ? (r.skillPointIds as string[]) : [],
      },
      warn: warn.length > 0 ? warn : undefined,
    };
  };

  const mapPasted = (cells: string[][]): { data: QuestionRowData; warn?: string[] }[] =>
    cells.map((c) => {
      const spNames = (c[5] ?? '').split(/[、/]/).map((s) => s.trim()).filter(Boolean);
      const ids = spNames.map((n) => skillPoints.find((s) => s.name === n)?.id).filter((x): x is string => !!x);
      return {
        data: {
          category: c[0] ?? '',
          question: c[1] ?? '',
          referenceAnswer: c[2] || undefined,
          difficulty: num(c[3]),
          frequency: num(c[4]),
          skillPointIds: ids,
        },
      };
    });

  const detailRow = rows.find((r) => r.key === detailKey);

  return (
    <div className="card lib-card">
      <Toolbar
        pendingCount={pendingCount}
        saving={saving}
        onAdd={() => addDrafts([{ data: { category: '', question: '', skillPointIds: [] } }])}
        onExtract={() => setPanel('extract')}
        onPaste={() => setPanel('paste')}
        onReload={reload}
        onSave={saveAll}
      />
      {loading ? (
        <p style={{ padding: 16, color: '#6B7280', fontSize: 13 }}>加载中…</p>
      ) : (
        <div className="lib-table-wrap">
          <table className="lib-table">
            <thead>
              <tr><th>状态</th><th>分类</th><th>客户提问</th><th>参考应答</th><th>难度</th><th>频率%</th><th>技能点</th><th>操作</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={`lib-row-${row.status}`}>
                  <td><RowStatusChip row={row} />{row.error && <div className="lib-err">{row.error}</div>}
                    {row.warn?.map((w) => <div key={w} className="lib-warn">{w}</div>)}
                  </td>
                  <td><CellInput value={row.data.category} onChange={(v) => updateRow(row.key, { category: v })} placeholder="价格 / 效果…" /></td>
                  <td style={{ minWidth: 220 }}><CellTextarea value={row.data.question} onChange={(v) => updateRow(row.key, { question: v })} /></td>
                  <td style={{ minWidth: 220 }}><CellTextarea value={row.data.referenceAnswer} onChange={(v) => updateRow(row.key, { referenceAnswer: v || undefined })} /></td>
                  <td>
                    <select className="lib-cell" value={row.data.difficulty ?? ''} onChange={(e) => updateRow(row.key, { difficulty: e.target.value ? Number(e.target.value) : undefined })}>
                      <option value="">-</option>
                      <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                    </select>
                  </td>
                  <td><CellInput type="number" value={row.data.frequency} onChange={(v) => updateRow(row.key, { frequency: v === '' ? undefined : Number(v) })} /></td>
                  <td><SkillPointPicker value={row.data.skillPointIds ?? []} options={skillPoints} onChange={(ids) => updateRow(row.key, { skillPointIds: ids })} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {row.status !== 'deleted' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setDetailKey(row.key)}>详情</button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleDelete(row.key)}>
                      {row.status === 'deleted' ? '恢复' : '删除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {panel === 'extract' && <ExtractPanel target="question" onClose={() => setPanel(null)} onRows={(rs) => addDrafts(rs.map(mapExtracted))} />}
      {panel === 'paste' && (
        <PastePanel
          headers={QUESTION_HEADERS}
          example={'分类\t问题\t参考应答\t难度\t频率\t技能点\n价格\t你们这个课太贵了\t强调投入产出比与不过退款保障\t2\t35\t异议处理'}
          onClose={() => setPanel(null)}
          onRows={(rs) => addDrafts(mapPasted(rs))}
        />
      )}
      {detailRow && (
        <DetailModal
          title={`问题详情：${detailRow.data.question?.slice(0, 20) || '（未填写）'}`}
          saving={savingOne}
          onSave={() => saveOne(detailRow)}
          onClose={() => setDetailKey(null)}
        >
          <Field label="分类"><MInput value={detailRow.data.category} onChange={(v) => updateRow(detailRow.key, { category: v })} placeholder="价格 / 效果 / 竞品 / 服务…" /></Field>
          <Field label="难度">
            <select className="input" value={detailRow.data.difficulty ?? ''} onChange={(e) => updateRow(detailRow.key, { difficulty: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">未设置</option>
              <option value={1}>1（常规）</option><option value={2}>2（较难）</option><option value={3}>3（尖锐）</option>
            </select>
          </Field>
          <Field label="出现频率 %"><MInput type="number" value={detailRow.data.frequency} onChange={(v) => updateRow(detailRow.key, { frequency: v === '' ? undefined : Number(v) })} /></Field>
          <Field label="客户提问" wide>
            <MTextarea rows={3} value={detailRow.data.question} onChange={(v) => updateRow(detailRow.key, { question: v })} />
          </Field>
          <Field label="参考应答要点" wide>
            <MTextarea rows={5} value={detailRow.data.referenceAnswer} onChange={(v) => updateRow(detailRow.key, { referenceAnswer: v || undefined })} />
          </Field>
          <Field label="关联技能点" wide>
            <SkillPointChecks value={detailRow.data.skillPointIds ?? []} options={skillPoints} onChange={(ids) => updateRow(detailRow.key, { skillPointIds: ids })} />
          </Field>
        </DetailModal>
      )}
    </div>
  );
}

/** ===== Tab 3：评分项 ===== */

const DEFAULT_LEVELS: ScoreLevel[] = [
  { key: 'excellent', label: '优秀', score: 100, description: '' },
  { key: 'pass', label: '达标', score: 60, description: '' },
  { key: 'fail', label: '未达标', score: 0, description: '' },
];

const LAYER_LABELS: Record<ScoreItemDef['layer'], string> = { company: '公司层', team: '团队层', personal: '个人层' };

const SCORE_ITEM_HEADERS = ['名称', '技能点', '层级', '权重', '行为锚定', '判定Prompt'];

type ScoreItemRowData = Omit<ScoreItemDef, 'id' | 'tenantId'> & { id?: string };

function ScoreItemTab({ skillPoints, setNotice, onChanged }: {
  skillPoints: SkillPoint[];
  setNotice: (s: string | null) => void;
  onChanged: () => void;
}) {
  const { rows, setRows, loadRows, addDrafts, updateRow, markSaved, markError, toggleDelete } = useRows<ScoreItemRowData>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingOne, setSavingOne] = useState(false);
  const [panel, setPanel] = useState<'extract' | 'paste' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    listScoreItems()
      .then((r) => loadRows(r.items))
      .catch((err) => setNotice(apiError(err, '加载评分项失败')))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlers: SaveHandlers<ScoreItemRowData> = {
    validate: (d) => {
      if (!d.name?.trim()) return '名称必填';
      if (!d.skillPointId) return '请选择技能点';
      if (!d.levels?.length) return '至少一个档位';
      return null;
    },
    create: (d) => createScoreItem(d),
    update: (id, d) => updateScoreItem(id, d),
    remove: (id) => deleteScoreItem(id),
  };

  const pendingCount = rows.filter((r) => r.status !== 'clean').length;

  const saveAll = async () => {
    setSaving(true);
    const { saved, failed } = await saveRows(rows, handlers, setRows);
    setSaving(false);
    setNotice(`保存完成：成功 ${saved} 项${failed ? `，失败 ${failed} 项（见行内提示）` : ''}`);
    if (saved > 0) { reload(); onChanged(); }
  };

  const saveOne = async (row: Row<ScoreItemRowData>) => {
    const invalid = handlers.validate(row.data);
    if (invalid) return markError(row.key, invalid);
    setSavingOne(true);
    try {
      const saved = row.status === 'draft'
        ? await handlers.create(row.data)
        : await handlers.update(row.data.id!, row.data);
      markSaved(row.key, saved);
      setNotice('已保存此行');
      onChanged();
    } catch (err) {
      markError(row.key, apiError(err, '保存失败'));
    } finally {
      setSavingOne(false);
    }
  };

  const mapExtracted = (r: Record<string, unknown>): { data: ScoreItemRowData; warn?: string[] } => {
    const warn: string[] = [];
    if (r.unresolvedSkillPoint) warn.push(`技能点「${String(r.unresolvedSkillPoint)}」未匹配，请手动选择`);
    const levels = Array.isArray(r.levels)
      ? (r.levels as Record<string, unknown>[]).map((lv) => ({
          key: String(lv.key ?? ''),
          label: String(lv.label ?? ''),
          score: Number(lv.score) || 0,
          description: String(lv.description ?? ''),
        })).filter((lv) => lv.key && lv.label)
      : [];
    const layer = r.layer === 'team' || r.layer === 'personal' ? r.layer : 'company';
    return {
      data: {
        name: String(r.name ?? ''),
        skillPointId: String(r.skillPointId ?? ''),
        behaviorAnchor: String(r.behaviorAnchor ?? ''),
        judgePrompt: String(r.judgePrompt ?? ''),
        weight: Number(r.weight) || 1,
        layer,
        isObservation: r.isObservation === true,
        levels: levels.length > 0 ? levels : DEFAULT_LEVELS,
      },
      warn: warn.length > 0 ? warn : undefined,
    };
  };

  const mapPasted = (cells: string[][]): { data: ScoreItemRowData; warn?: string[] }[] =>
    cells.map((c) => {
      const warn: string[] = [];
      const sp = c[1] ? skillPoints.find((s) => s.name === c[1]) : undefined;
      if (c[1] && !sp) warn.push(`技能点「${c[1]}」未匹配，请手动选择`);
      const layerText = c[2] ?? '';
      const layer: ScoreItemDef['layer'] = /团队/.test(layerText) ? 'team' : /个人/.test(layerText) ? 'personal' : 'company';
      return {
        data: {
          name: c[0] ?? '',
          skillPointId: sp?.id ?? '',
          layer,
          weight: num(c[3]) ?? 1,
          behaviorAnchor: c[4] ?? '',
          judgePrompt: c[5] ?? '',
          isObservation: false,
          levels: DEFAULT_LEVELS,
        },
        warn: warn.length > 0 ? warn : undefined,
      };
    });

  const detailRow = rows.find((r) => r.key === detailKey);

  return (
    <div className="card lib-card">
      <Toolbar
        pendingCount={pendingCount}
        saving={saving}
        onAdd={() => addDrafts([{ data: { name: '', skillPointId: '', behaviorAnchor: '', judgePrompt: '', weight: 1, layer: 'company', isObservation: false, levels: DEFAULT_LEVELS } }])}
        onExtract={() => setPanel('extract')}
        onPaste={() => setPanel('paste')}
        onReload={reload}
        onSave={saveAll}
      />
      {loading ? (
        <p style={{ padding: 16, color: '#6B7280', fontSize: 13 }}>加载中…</p>
      ) : (
        <div className="lib-table-wrap">
          <table className="lib-table">
            <thead>
              <tr><th>状态</th><th>名称</th><th>技能点</th><th>层级</th><th>权重</th><th>观察项</th><th>行为锚定</th><th>判定 Prompt</th><th>档位</th><th>操作</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.key}>
                  <tr className={`lib-row-${row.status}`}>
                    <td><RowStatusChip row={row} />{row.error && <div className="lib-err">{row.error}</div>}
                      {row.warn?.map((w) => <div key={w} className="lib-warn">{w}</div>)}
                    </td>
                    <td><CellInput value={row.data.name} onChange={(v) => updateRow(row.key, { name: v })} /></td>
                    <td>
                      <select className="lib-cell" value={row.data.skillPointId} onChange={(e) => updateRow(row.key, { skillPointId: e.target.value })}>
                        <option value="">选择技能点…</option>
                        {skillPoints.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="lib-cell" value={row.data.layer} onChange={(e) => updateRow(row.key, { layer: e.target.value as ScoreItemDef['layer'] })}>
                        {(Object.keys(LAYER_LABELS) as ScoreItemDef['layer'][]).map((l) => <option key={l} value={l}>{LAYER_LABELS[l]}</option>)}
                      </select>
                    </td>
                    <td><CellInput type="number" value={row.data.weight} onChange={(v) => updateRow(row.key, { weight: Number(v) })} /></td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={row.data.isObservation} onChange={(e) => updateRow(row.key, { isObservation: e.target.checked })} />
                    </td>
                    <td style={{ minWidth: 200 }}><CellTextarea value={row.data.behaviorAnchor} onChange={(v) => updateRow(row.key, { behaviorAnchor: v })} /></td>
                    <td style={{ minWidth: 200 }}><CellTextarea value={row.data.judgePrompt} onChange={(v) => updateRow(row.key, { judgePrompt: v })} /></td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === row.key ? null : row.key)}>
                        {expanded === row.key ? '收起' : `档位(${row.data.levels.length})`}
                      </button>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {row.status !== 'deleted' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetailKey(row.key)}>详情</button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleDelete(row.key)}>
                        {row.status === 'deleted' ? '恢复' : '删除'}
                      </button>
                    </td>
                  </tr>
                  {expanded === row.key && (
                    <tr className={`lib-row-${row.status}`}>
                      <td colSpan={10}>
                        <div className="lib-sub">
                          <LevelsEditor levels={row.data.levels} onChange={(levels) => updateRow(row.key, { levels })} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {panel === 'extract' && <ExtractPanel target="score-item" onClose={() => setPanel(null)} onRows={(rs) => addDrafts(rs.map(mapExtracted))} />}
      {panel === 'paste' && (
        <PastePanel
          headers={SCORE_ITEM_HEADERS}
          example={'名称\t技能点\t层级\t权重\t行为锚定\t判定Prompt\n破冰开场\t破冰\t公司层\t1\t开场30秒内说明来意\t判断学员是否在开场30秒内清晰说明来意'}
          onClose={() => setPanel(null)}
          onRows={(rs) => addDrafts(mapPasted(rs))}
        />
      )}
      {detailRow && (
        <DetailModal
          title={`评分项详情：${detailRow.data.name || '（未命名）'}`}
          saving={savingOne}
          onSave={() => saveOne(detailRow)}
          onClose={() => setDetailKey(null)}
        >
          <Field label="名称" wide><MInput value={detailRow.data.name} onChange={(v) => updateRow(detailRow.key, { name: v })} /></Field>
          <Field label="所属技能点">
            <select className="input" value={detailRow.data.skillPointId} onChange={(e) => updateRow(detailRow.key, { skillPointId: e.target.value })}>
              <option value="">选择技能点…</option>
              {skillPoints.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          </Field>
          <Field label="层级">
            <select className="input" value={detailRow.data.layer} onChange={(e) => updateRow(detailRow.key, { layer: e.target.value as ScoreItemDef['layer'] })}>
              {(Object.keys(LAYER_LABELS) as ScoreItemDef['layer'][]).map((l) => <option key={l} value={l}>{LAYER_LABELS[l]}</option>)}
            </select>
          </Field>
          <Field label="权重"><MInput type="number" value={detailRow.data.weight} onChange={(v) => updateRow(detailRow.key, { weight: Number(v) })} /></Field>
          <Field label="观察项">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={detailRow.data.isObservation} onChange={(e) => updateRow(detailRow.key, { isObservation: e.target.checked })} />
              记录但不计分（冲突裁决用）
            </label>
          </Field>
          <Field label="行为锚定描述" wide>
            <MTextarea rows={3} value={detailRow.data.behaviorAnchor} onChange={(v) => updateRow(detailRow.key, { behaviorAnchor: v })} />
          </Field>
          <Field label="判定 Prompt 模板" wide>
            <MTextarea rows={4} value={detailRow.data.judgePrompt} onChange={(v) => updateRow(detailRow.key, { judgePrompt: v })} />
          </Field>
          <div className="lib-fieldset">
            <h4>档位（levels）</h4>
            <LevelsEditor levels={detailRow.data.levels} onChange={(levels) => updateRow(detailRow.key, { levels })} />
          </div>
        </DetailModal>
      )}
    </div>
  );
}

/** ===== Tab 4：金标准案例 ===== */

type GoldenCaseRowData = Omit<GoldenCase, 'id'> & { id?: string };

function GoldenCaseTab({ scoreItems, setNotice }: { scoreItems: ScoreItemDef[]; setNotice: (s: string | null) => void }) {
  const { rows, setRows, loadRows, addDrafts, updateRow, markSaved, markError, toggleDelete } = useRows<GoldenCaseRowData>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingOne, setSavingOne] = useState(false);
  const [panel, setPanel] = useState<'extract' | 'paste' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    listGoldenCases()
      .then((r) => loadRows(r.cases))
      .catch((err) => setNotice(apiError(err, '加载金标准案例失败')))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlers: SaveHandlers<GoldenCaseRowData> = {
    validate: (d) => {
      if (!d.name?.trim()) return '名称必填';
      if (!d.transcript?.length) return '对话不能为空（详情中编辑）';
      if (!d.expected?.length) return '期望判定不能为空（详情中编辑）';
      if (d.expected.some((e) => !e.itemId || !e.levelKey)) return '期望判定的评分项与档位必填';
      return null;
    },
    create: (d) => createGoldenCase(d),
    update: (id, d) => updateGoldenCase(id, d),
    remove: (id) => deleteGoldenCase(id),
  };

  const pendingCount = rows.filter((r) => r.status !== 'clean').length;

  const saveAll = async () => {
    setSaving(true);
    const { saved, failed } = await saveRows(rows, handlers, setRows);
    setSaving(false);
    setNotice(`保存完成：成功 ${saved} 项${failed ? `，失败 ${failed} 项（见行内提示）` : ''}`);
    if (saved > 0) reload();
  };

  const saveOne = async (row: Row<GoldenCaseRowData>) => {
    const invalid = handlers.validate(row.data);
    if (invalid) return markError(row.key, invalid);
    setSavingOne(true);
    try {
      const saved = row.status === 'draft'
        ? await handlers.create(row.data)
        : await handlers.update(row.data.id!, row.data);
      markSaved(row.key, saved);
      setNotice('已保存此行');
    } catch (err) {
      markError(row.key, apiError(err, '保存失败'));
    } finally {
      setSavingOne(false);
    }
  };

  const mapExtracted = (r: Record<string, unknown>): { data: GoldenCaseRowData; warn?: string[] } => {
    const warn: string[] = [];
    if (Array.isArray(r.unresolvedScoreItems) && r.unresolvedScoreItems.length > 0) {
      warn.push(`评分项未匹配：${(r.unresolvedScoreItems as string[]).join('、')}，请手动指定`);
    }
    const transcript = Array.isArray(r.transcript)
      ? (r.transcript as Record<string, unknown>[])
          .map((t, i) => ({
            seq: Number(t.seq) || i + 1,
            speaker: (t.speaker === 'persona' ? 'persona' : 'trainee') as 'persona' | 'trainee',
            text: String(t.text ?? ''),
          }))
          .filter((t) => t.text)
      : [];
    const expected = Array.isArray(r.expected)
      ? (r.expected as Record<string, unknown>[]).map((e) => ({
          itemId: String(e.itemId ?? ''),
          levelKey: String(e.levelKey ?? ''),
        }))
      : [];
    return { data: { name: String(r.name ?? ''), transcript, expected }, warn: warn.length > 0 ? warn : undefined };
  };

  // 粘贴格式：# 案例名 起一个新案例；「学员：…」/「客户：…」为对话行
  const parseGoldenPaste = (text: string): { data: GoldenCaseRowData; warn?: string[] }[] => {
    const out: { data: GoldenCaseRowData; warn?: string[] }[] = [];
    let current: GoldenCaseRowData | null = null;
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      if (l.startsWith('#')) {
        if (current) out.push({ data: current });
        current = { name: l.replace(/^#+\s*/, ''), transcript: [], expected: [] };
        continue;
      }
      const m = l.match(/^(学员|客户|销售|trainee|persona)[:：](.*)$/);
      if (m && current) {
        current.transcript.push({
          seq: current.transcript.length + 1,
          speaker: /客户|persona/.test(m[1]) ? 'persona' : 'trainee',
          text: m[2].trim(),
        });
      }
    }
    if (current) out.push({ data: current });
    return out.map((o) => ({
      ...o,
      warn: ['期望判定需在详情中补充后才能保存'],
    }));
  };

  const detailRow = rows.find((r) => r.key === detailKey);

  return (
    <div className="card lib-card">
      <Toolbar
        pendingCount={pendingCount}
        saving={saving}
        onAdd={() => addDrafts([{ data: { name: '', transcript: [], expected: [] } }])}
        onExtract={() => setPanel('extract')}
        onPaste={() => setPanel('paste')}
        onReload={reload}
        onSave={saveAll}
      />
      {loading ? (
        <p style={{ padding: 16, color: '#6B7280', fontSize: 13 }}>加载中…</p>
      ) : (
        <div className="lib-table-wrap">
          <table className="lib-table">
            <thead>
              <tr><th>状态</th><th>案例名称</th><th>对话轮数</th><th>期望判定数</th><th>编辑</th><th>操作</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.key}>
                  <tr className={`lib-row-${row.status}`}>
                    <td><RowStatusChip row={row} />{row.error && <div className="lib-err">{row.error}</div>}
                      {row.warn?.map((w) => <div key={w} className="lib-warn">{w}</div>)}
                    </td>
                    <td style={{ minWidth: 180 }}><CellInput value={row.data.name} onChange={(v) => updateRow(row.key, { name: v })} /></td>
                    <td>{row.data.transcript.length} 轮</td>
                    <td>{row.data.expected.length} 项</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === row.key ? null : row.key)}>
                        {expanded === row.key ? '收起' : '展开编辑'}
                      </button>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {row.status !== 'deleted' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetailKey(row.key)}>详情</button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleDelete(row.key)}>
                        {row.status === 'deleted' ? '恢复' : '删除'}
                      </button>
                    </td>
                  </tr>
                  {expanded === row.key && (
                    <tr className={`lib-row-${row.status}`}>
                      <td colSpan={6}>
                        <div className="lib-sub">
                          <h4>对话（transcript）</h4>
                          <TranscriptEditor transcript={row.data.transcript} onChange={(t) => updateRow(row.key, { transcript: t })} />
                          <h4 style={{ marginTop: 16 }}>期望判定（expected）</h4>
                          <ExpectedEditor expected={row.data.expected} onChange={(e) => updateRow(row.key, { expected: e })} scoreItems={scoreItems} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {panel === 'extract' && <ExtractPanel target="golden-case" onClose={() => setPanel(null)} onRows={(rs) => addDrafts(rs.map(mapExtracted))} />}
      {panel === 'paste' && (
        <GoldenPastePanel onClose={() => setPanel(null)} onRows={parseGoldenPaste} onAdd={addDrafts} />
      )}
      {detailRow && (
        <DetailModal
          title={`金标准案例：${detailRow.data.name || '（未命名）'}`}
          saving={savingOne}
          onSave={() => saveOne(detailRow)}
          onClose={() => setDetailKey(null)}
        >
          <Field label="案例名称" wide><MInput value={detailRow.data.name} onChange={(v) => updateRow(detailRow.key, { name: v })} /></Field>
          <div className="lib-fieldset">
            <h4>对话（transcript）</h4>
            <TranscriptEditor transcript={detailRow.data.transcript} onChange={(t) => updateRow(detailRow.key, { transcript: t })} />
          </div>
          <div className="lib-fieldset">
            <h4>期望判定（expected）</h4>
            <ExpectedEditor expected={detailRow.data.expected} onChange={(e) => updateRow(detailRow.key, { expected: e })} scoreItems={scoreItems} />
          </div>
        </DetailModal>
      )}
    </div>
  );
}

function GoldenPastePanel({ onClose, onRows, onAdd }: {
  onClose: () => void;
  onRows: (text: string) => { data: GoldenCaseRowData; warn?: string[] }[];
  onAdd: (drafts: { data: GoldenCaseRowData; warn?: string[] }[]) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    const parsed = onRows(text);
    if (parsed.length === 0) {
      setError('未解析到案例：以「# 案例名」开头，「学员：…」「客户：…」为对话行');
      return;
    }
    onAdd(parsed);
    onClose();
  };
  return (
    <Panel title="📋 粘贴案例文本" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 8px' }}>
        格式：「# 案例名」起一个新案例；对话行用「学员：…」/「客户：…」。可粘贴多个案例。
      </p>
      <textarea className="input" rows={10} style={{ width: '100%' }} value={text} onChange={(e) => { setText(e.target.value); setError(null); }} placeholder={'# 首次拜访标准流程\n学员：王主任您好，我是…\n客户：你只有五分钟，说吧\n学员：…'} />
      {error && <p style={{ fontSize: 13, color: '#E85A4A', margin: '8px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>取消</button>
        <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={run}>解析并加入表格</button>
      </div>
    </Panel>
  );
}

/** ===== Tab 7：场景引导包 ===== */

type GuidanceRowData = Omit<ScenarioGuidance, 'id' | 'tenantId'> & { id?: string };

const DEFAULT_DURATION: DurationParams = { targetMinutes: 10, minTurns: 6, maxTurns: 20, countdownSeconds: 600 };

function newGuidanceDraft(scenarioId = '', name = ''): GuidanceRowData {
  return {
    scenarioId,
    name,
    qualifyQuestions: [],
    demo: null,
    keyPoints: [],
    analysisStandardIds: [],
    realismStandardIds: [],
    difficultyLevels: [],
    defaultDifficulty: 1,
    duration: { ...DEFAULT_DURATION },
    liveIntro: { narration: '', goal: '' },
    voiceProfile: { style: '', arousal: 0.5 },
    scoringFocus: [],
  };
}

function toGuidanceRow(g: ScenarioGuidance): GuidanceRowData {
  return {
    id: g.id,
    scenarioId: g.scenarioId,
    name: g.name,
    qualifyQuestions: g.qualifyQuestions ?? [],
    demo: g.demo ?? null,
    keyPoints: g.keyPoints ?? [],
    analysisStandardIds: g.analysisStandardIds ?? [],
    realismStandardIds: g.realismStandardIds ?? [],
    difficultyLevels: g.difficultyLevels ?? [],
    defaultDifficulty: g.defaultDifficulty ?? 1,
    duration: g.duration ?? { ...DEFAULT_DURATION },
    liveIntro: g.liveIntro ?? { narration: '', goal: '' },
    voiceProfile: g.voiceProfile ?? { style: '', arousal: 0.5 },
    scoringFocus: g.scoringFocus ?? [],
  };
}

/** 难度档位行编辑器（level 1-5 / 档位名 / 说明 / 对 AI 客户行为要求） */
function DifficultyLevelsEditor({ levels, onChange }: { levels: DifficultyLevel[]; onChange: (l: DifficultyLevel[]) => void }) {
  const update = (idx: number, patch: Partial<DifficultyLevel>) =>
    onChange(levels.map((lv, i) => (i === idx ? { ...lv, ...patch } : lv)));
  return (
    <div>
      <table className="lib-table">
        <thead><tr><th>等级(1-5)</th><th>档位名</th><th>难度说明</th><th>AI 客户行为要求</th><th></th></tr></thead>
        <tbody>
          {levels.map((lv, idx) => (
            <tr key={idx}>
              <td style={{ width: 90 }}><CellInput type="number" value={lv.level} onChange={(v) => update(idx, { level: Math.max(1, Math.min(5, Number(v) || 1)) })} /></td>
              <td><CellInput value={lv.label} onChange={(v) => update(idx, { label: v })} placeholder="如 温和客户" /></td>
              <td style={{ minWidth: 200 }}><CellTextarea rows={1} value={lv.description} onChange={(v) => update(idx, { description: v })} /></td>
              <td style={{ minWidth: 220 }}><CellTextarea rows={1} value={lv.customerBehavior} onChange={(v) => update(idx, { customerBehavior: v })} /></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => onChange(levels.filter((_, i) => i !== idx))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 8 }}
        onClick={() => onChange([...levels, { level: Math.min(5, levels.length + 1), label: '', description: '', customerBehavior: '' }])}
      >
        ＋ 加一档
      </button>
    </div>
  );
}

/** 通用 id/name 多选（平铺 checkbox，用于分析标准 / 真实度标准引用） */
function IdNameChecks({ value, onChange, options }: {
  value: string[];
  onChange: (ids: string[]) => void;
  options: { id: string; name: string }[];
}) {
  if (options.length === 0) return <span style={{ fontSize: 13, color: '#9CA3AF' }}>暂无条目，请先到对应标准库添加</span>;
  return (
    <div className="lib-checks">
      {options.map((o) => (
        <label key={o.id}>
          <input
            type="checkbox"
            checked={value.includes(o.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, o.id] : value.filter((id) => id !== o.id))
            }
          />
          {o.name}
        </label>
      ))}
    </div>
  );
}

function GuidanceTab({ focus, onFocusHandled, onChanged, setNotice }: {
  focus: GuidanceFocus | null;
  onFocusHandled: () => void;
  onChanged: () => void;
  setNotice: (s: string | null) => void;
}) {
  const { rows, setRows, loadRows, addDrafts, updateRow, markSaved, markError, toggleDelete } = useRows<GuidanceRowData>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingOne, setSavingOne] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [analysisStandards, setAnalysisStandards] = useState<AnalysisStandard[]>([]);
  const [realismStandards, setRealismStandards] = useState<RealismStandard[]>([]);
  /** 编辑器内示范剧本的 JSON 草稿（完成/保存时解析回 demo 字段） */
  const [demoText, setDemoText] = useState('');
  const [noDemo, setNoDemo] = useState(false);
  const [demoErr, setDemoErr] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    listScenarioGuidances()
      .then((r) => loadRows(r.items.map(toGuidanceRow)))
      .catch((err) => setNotice(apiError(err, '加载场景引导包失败')))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchScenarios().then((r) => setScenarios(r.scenarios)).catch(() => {});
    listAnalysisStandards().then((r) => setAnalysisStandards(r.items)).catch(() => {});
    listRealismStandards().then((r) => setRealismStandards(r.items)).catch(() => {});
  }, []);

  const openEditor = (row: Row<GuidanceRowData>) => {
    setDemoText(row.data.demo ? JSON.stringify(row.data.demo, null, 2) : '');
    setNoDemo(row.data.demo === null);
    setDemoErr(null);
    setDetailKey(row.key);
  };

  // 场景库「配置引导 / 已配置」跳转：已有 → 直接打开编辑器；未配置 → 新建草稿并预填场景
  useEffect(() => {
    if (!focus || loading) return;
    if (focus.id) {
      const row = rows.find((r) => r.data.id === focus.id);
      if (row) openEditor(row);
      else setNotice('未找到对应引导包，可能已被删除');
    } else if (focus.scenarioId) {
      addDrafts([{ data: newGuidanceDraft(focus.scenarioId, focus.name ?? '') }]);
      setNotice('已新建引导包草稿并预填场景，点击「编辑」完善后保存');
    }
    onFocusHandled();
  }, [focus, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 解析编辑器里的示范 JSON；无示范模式 → demo=null */
  const parseDemoInput = (): { demo: DemoScriptTemplate | null } | { error: string } => {
    if (noDemo) return { demo: null };
    const text = demoText.trim();
    if (!text) return { error: '示范 JSON 不能为空；若无示范请勾选「无示范模式」' };
    try {
      const parsed = JSON.parse(text) as DemoScriptTemplate;
      if (!parsed || !Array.isArray(parsed.lines)) return { error: '示范 JSON 需包含 lines 数组' };
      return { demo: parsed };
    } catch {
      return { error: '示范 JSON 解析失败，请检查格式' };
    }
  };

  /** 「完成」：尽力把示范 JSON 暂存进行数据；解析失败保留原值并提示 */
  const closeEditor = () => {
    const row = rows.find((r) => r.key === detailKey);
    if (row) {
      const d = parseDemoInput();
      if ('error' in d) {
        // 未填且原本就没示范时不算错误
        if (!(demoText.trim() === '' && row.data.demo === null && !noDemo)) setNotice(`示范 JSON 未暂存：${d.error}`);
      } else {
        updateRow(row.key, { demo: d.demo });
      }
    }
    setDetailKey(null);
  };

  const validate = (d: GuidanceRowData) => {
    if (!d.scenarioId) return '请选择绑定场景';
    if (!d.name?.trim()) return '名称必填';
    if (!d.qualifyQuestions?.length) return '资格问题至少一题（编辑器中每行一条）';
    const dur = d.duration;
    if (![dur.targetMinutes, dur.minTurns, dur.maxTurns, dur.countdownSeconds].every(Number.isFinite)) {
      return '时长参数必须为数字';
    }
    return null;
  };

  const pendingCount = rows.filter((r) => r.status !== 'clean').length;

  const saveAll = async () => {
    setSaving(true);
    const { saved, failed } = await saveRows(rows, {
      validate,
      create: (d) => saveScenarioGuidance(d),
      update: (id, d) => saveScenarioGuidance({ ...d, id }),
      remove: (id) => deleteScenarioGuidance(id),
    }, setRows);
    setSaving(false);
    setNotice(`保存完成：成功 ${saved} 项${failed ? `，失败 ${failed} 项（见行内提示）` : ''}`);
    if (saved > 0) { reload(); onChanged(); }
  };

  const saveOne = async (row: Row<GuidanceRowData>) => {
    const d = parseDemoInput();
    if ('error' in d) {
      setDemoErr(d.error);
      return;
    }
    setDemoErr(null);
    const payload = { ...row.data, demo: d.demo };
    const invalid = validate(payload);
    if (invalid) return markError(row.key, invalid);
    setSavingOne(true);
    try {
      const saved = await saveScenarioGuidance(row.status === 'draft' ? payload : { ...payload, id: row.data.id });
      markSaved(row.key, toGuidanceRow(saved));
      setNotice('已保存此行');
      onChanged();
    } catch (err) {
      markError(row.key, apiError(err, '保存失败'));
    } finally {
      setSavingOne(false);
    }
  };

  const detailRow = rows.find((r) => r.key === detailKey);
  const scenarioName = (id: string) => scenarios.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="card lib-card">
      <Toolbar
        pendingCount={pendingCount}
        saving={saving}
        onAdd={() => addDrafts([{ data: newGuidanceDraft() }])}
        onReload={reload}
        onSave={saveAll}
      />
      {loading ? (
        <p style={{ padding: 16, color: '#6B7280', fontSize: 13 }}>加载中…</p>
      ) : (
        <div className="lib-table-wrap">
          <table className="lib-table">
            <thead>
              <tr><th>状态</th><th>名称</th><th>绑定场景</th><th>资格问题</th><th>示范</th><th>操作</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={`lib-row-${row.status}`}>
                  <td><RowStatusChip row={row} />{row.error && <div className="lib-err">{row.error}</div>}</td>
                  <td style={{ minWidth: 160 }}><CellInput value={row.data.name} onChange={(v) => updateRow(row.key, { name: v })} /></td>
                  <td>
                    <select className="lib-cell" value={row.data.scenarioId} onChange={(e) => updateRow(row.key, { scenarioId: e.target.value })}>
                      <option value="">选择场景…</option>
                      {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      {row.data.scenarioId && !scenarios.some((s) => s.id === row.data.scenarioId) && (
                        <option value={row.data.scenarioId}>{row.data.scenarioId}（未匹配）</option>
                      )}
                    </select>
                  </td>
                  <td>{row.data.qualifyQuestions.length} 题</td>
                  <td>{row.data.demo ? `有（${row.data.demo.lines.length} 句）` : '无示范模式'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {row.status !== 'deleted' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => openEditor(row)}>编辑</button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleDelete(row.key)}>
                      {row.status === 'deleted' ? '恢复' : '删除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailRow && (
        <DetailModal
          title={`引导包：${detailRow.data.name || '（未命名）'}${detailRow.data.scenarioId ? ` · ${scenarioName(detailRow.data.scenarioId)}` : ''}`}
          saving={savingOne}
          onSave={() => saveOne(detailRow)}
          onClose={closeEditor}
        >
          <Field label="绑定场景">
            <select className="input" value={detailRow.data.scenarioId} onChange={(e) => updateRow(detailRow.key, { scenarioId: e.target.value })}>
              <option value="">选择场景…</option>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="名称"><MInput value={detailRow.data.name} onChange={(v) => updateRow(detailRow.key, { name: v })} /></Field>
          <Field label="资格问题（第1步，1~2 题）" wide>
            <LinesTextarea value={detailRow.data.qualifyQuestions} onChange={(v) => updateRow(detailRow.key, { qualifyQuestions: v })} placeholder="每行一题，如：你做过地推吗？" />
          </Field>
          <Field label="讲解要点（第3步）" wide>
            <LinesTextarea value={detailRow.data.keyPoints} onChange={(v) => updateRow(detailRow.key, { keyPoints: v })} placeholder="每行一个要点" />
          </Field>
          <Field label="引用分析标准" wide>
            <IdNameChecks value={detailRow.data.analysisStandardIds} options={analysisStandards} onChange={(ids) => updateRow(detailRow.key, { analysisStandardIds: ids })} />
          </Field>
          <Field label="引用真实度标准" wide>
            <IdNameChecks value={detailRow.data.realismStandardIds} options={realismStandards} onChange={(ids) => updateRow(detailRow.key, { realismStandardIds: ids })} />
          </Field>
          <div className="lib-fieldset">
            <h4>难度档位（第4步）</h4>
            <DifficultyLevelsEditor levels={detailRow.data.difficultyLevels} onChange={(v) => updateRow(detailRow.key, { difficultyLevels: v })} />
            <div className="lib-form" style={{ marginTop: 8 }}>
              <Field label="默认难度"><MInput type="number" value={detailRow.data.defaultDifficulty} onChange={(v) => updateRow(detailRow.key, { defaultDifficulty: Number(v) || 1 })} /></Field>
            </div>
          </div>
          <div className="lib-fieldset">
            <h4>时长参数（第4步）</h4>
            <div className="lib-form">
              <Field label="目标时长（分钟）"><MInput type="number" value={detailRow.data.duration.targetMinutes} onChange={(v) => updateRow(detailRow.key, { duration: { ...detailRow.data.duration, targetMinutes: Number(v) } })} /></Field>
              <Field label="最少轮次"><MInput type="number" value={detailRow.data.duration.minTurns} onChange={(v) => updateRow(detailRow.key, { duration: { ...detailRow.data.duration, minTurns: Number(v) } })} /></Field>
              <Field label="最多轮次"><MInput type="number" value={detailRow.data.duration.maxTurns} onChange={(v) => updateRow(detailRow.key, { duration: { ...detailRow.data.duration, maxTurns: Number(v) } })} /></Field>
              <Field label="倒计时（秒）"><MInput type="number" value={detailRow.data.duration.countdownSeconds} onChange={(v) => updateRow(detailRow.key, { duration: { ...detailRow.data.duration, countdownSeconds: Number(v) } })} /></Field>
            </div>
          </div>
          <Field label="开场旁白（liveIntro.narration）" wide>
            <MTextarea rows={3} value={detailRow.data.liveIntro.narration} onChange={(v) => updateRow(detailRow.key, { liveIntro: { ...detailRow.data.liveIntro, narration: v } })} />
          </Field>
          <Field label="演练目标（liveIntro.goal）" wide>
            <MInput value={detailRow.data.liveIntro.goal} onChange={(v) => updateRow(detailRow.key, { liveIntro: { ...detailRow.data.liveIntro, goal: v } })} />
          </Field>
          <div className="lib-fieldset">
            <h4>教练音色（voiceProfile）</h4>
            <div className="lib-form">
              <Field label="风格 style"><MInput value={detailRow.data.voiceProfile.style} onChange={(v) => updateRow(detailRow.key, { voiceProfile: { ...detailRow.data.voiceProfile, style: v } })} /></Field>
              <Field label="唤醒度 arousal(0-1)"><MInput type="number" value={detailRow.data.voiceProfile.arousal} onChange={(v) => updateRow(detailRow.key, { voiceProfile: { ...detailRow.data.voiceProfile, arousal: Number(v) } })} /></Field>
              <Field label="激情 excitement"><MInput type="number" value={detailRow.data.voiceProfile.excitement} onChange={(v) => updateRow(detailRow.key, { voiceProfile: { ...detailRow.data.voiceProfile, excitement: v === '' ? undefined : Number(v) } })} /></Field>
              <Field label="语速 rate"><MInput type="number" value={detailRow.data.voiceProfile.rate} onChange={(v) => updateRow(detailRow.key, { voiceProfile: { ...detailRow.data.voiceProfile, rate: v === '' ? undefined : Number(v) } })} /></Field>
            </div>
          </div>
          <Field label="重点评分维度（第5步）" wide>
            <LinesTextarea value={detailRow.data.scoringFocus} onChange={(v) => updateRow(detailRow.key, { scoringFocus: v })} placeholder="每行一个维度" />
          </Field>
          <div className="lib-fieldset">
            <h4>示范剧本（第2步）</h4>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 8 }}>
              <input type="checkbox" checked={noDemo} onChange={(e) => { setNoDemo(e.target.checked); setDemoErr(null); }} />
              无示范模式（如现场成交，保存为 null，练习页跳过示范直接进讲解）
            </label>
            {!noDemo && (
              <MTextarea
                rows={10}
                value={demoText}
                placeholder={'{"lines":[{"role":"sales","text":"您好！","excitement":3}],"faqPick":2,"faqPoolRef":"..."}'}
                onChange={(v) => { setDemoText(v); setDemoErr(null); }}
              />
            )}
            {demoErr && <p style={{ fontSize: 13, color: '#E85A4A', margin: '6px 0 0' }}>{demoErr}</p>}
          </div>
        </DetailModal>
      )}
    </div>
  );
}
