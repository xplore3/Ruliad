import { useEffect, useState } from 'react';
import {
  apiError,
  createElement,
  createPersonaConfig,
  createSkillPoint,
  deleteElement,
  deletePersonaConfig,
  deleteSkillPoint,
  fetchManagementKnowledgeBase,
  fetchPersonaConfigs,
  fetchSkillPoints,
  listElements,
  saveManagementKnowledgeBase,
  updateElement,
  updatePersonaConfig,
  updateSkillPoint,
} from '../api';
import type { Element, KbEntry, PersonaConfig, SkillPoint } from '../types';
import Pagination from '../components/Pagination';

/** 各资源库列表的分页大小 */
const LIB_PAGE_SIZE = 10;

const input = 'input';
const card = 'card lib-card';

function Notice({ value }: { value: string }) {
  return value ? <p className="hint" style={{ marginBottom: 12 }}>{value}</p> : null;
}

export function SkillPointLibrary({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<SkillPoint[]>([]);
  const [draft, setDraft] = useState<Partial<SkillPoint>>({ name: '', description: '' });
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / LIB_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(currentPage * LIB_PAGE_SIZE, (currentPage + 1) * LIB_PAGE_SIZE);
  const load = () => fetchSkillPoints().then((r) => setItems(r.skillPoints)).catch((e) => setNotice(apiError(e, '加载失败')));
  useEffect(() => { void load(); }, []);
  const save = async () => {
    if (!draft.name?.trim()) return setNotice('名称必填');
    try {
      if (draft.id) await updateSkillPoint(draft.id, draft);
      else await createSkillPoint(draft);
      setDraft({ name: '', description: '' });
      setNotice('已保存');
      await load();
      onChanged?.();
    } catch (e) { setNotice(apiError(e, '保存失败')); }
  };
  const remove = async (id: string) => {
    try { await deleteSkillPoint(id); await load(); onChanged?.(); }
    catch (e) { setNotice(apiError(e, '删除失败')); }
  };
  return <div className={card} style={{ padding: 16 }}>
    <div className="sec-head"><h3>技能点库</h3><button className="btn btn-ghost btn-sm" onClick={() => setDraft({ name: '', description: '' })}>＋ 新建</button></div>
    <Notice value={notice} />
    <div className="lib-form" style={{ marginBottom: 16 }}>
      <label>名称<input className={input} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>说明<input className={input} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      <button className="btn btn-primary btn-sm" onClick={save}>{draft.id ? '保存修改' : '创建技能点'}</button>
    </div>
    <table className="lib-table"><thead><tr><th>名称</th><th>说明</th><th>操作</th></tr></thead><tbody>
      {pageItems.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.description}</td><td>
        <button className="btn btn-ghost btn-sm" onClick={() => setDraft(item)}>编辑</button>
        <button className="btn btn-ghost btn-sm" onClick={() => void remove(item.id)}>删除</button>
      </td></tr>)}
    </tbody></table>
    <Pagination page={currentPage} totalPages={totalPages} total={items.length} onChange={setPage} />
  </div>;
}

export function ElementLibrary() {
  const [items, setItems] = useState<Element[]>([]);
  const [draft, setDraft] = useState<Partial<Element>>({ name: '', type: 'C', content: '' });
  const [dynamicsText, setDynamicsText] = useState('');
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / LIB_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(currentPage * LIB_PAGE_SIZE, (currentPage + 1) * LIB_PAGE_SIZE);
  const [notice, setNotice] = useState('');
  const load = () => listElements().then((r) => setItems(r.elements)).catch((e) => setNotice(apiError(e, '加载失败')));
  useEffect(() => { void load(); }, []);
  const edit = (item: Element) => {
    setDraft(item);
    setDynamicsText(item.dynamics ? JSON.stringify(item.dynamics, null, 2) : '');
  };
  const save = async () => {
    if (!draft.name?.trim() || !draft.content?.trim()) return setNotice('名称和正文必填');
    try {
      const dynamics = dynamicsText.trim() ? JSON.parse(dynamicsText) : undefined;
      if (draft.id) await updateElement(draft.id, { ...draft, dynamics, expectedVersion: draft.version ?? 1 });
      else await createElement({ ...draft, dynamics });
      setDraft({ name: '', type: 'C', content: '' });
      setDynamicsText('');
      setNotice('已保存');
      await load();
    } catch (e) { setNotice(e instanceof SyntaxError ? '情绪动力学不是合法 JSON' : apiError(e, '保存失败')); }
  };
  const remove = async (id: string) => {
    try { await deleteElement(id); await load(); } catch (e) { setNotice(apiError(e, '删除失败')); }
  };
  return <div className={card} style={{ padding: 16 }}>
    <div className="sec-head"><h3>角色要素库</h3><button className="btn btn-ghost btn-sm" onClick={() => { setDraft({ name: '', type: 'C', content: '' }); setDynamicsText(''); }}>＋ 新建</button></div>
    <Notice value={notice} />
    <div className="lib-form">
      <label>名称<input className={input} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>类型<select className={input} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Element['type'] })}><option value="C">认知</option><option value="E">情绪</option><option value="B">行为</option><option value="S">情境</option></select></label>
      <label style={{ gridColumn: '1 / -1' }}>正文<textarea className={input} rows={3} value={draft.content ?? ''} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></label>
      <label style={{ gridColumn: '1 / -1' }}>情绪动力学 JSON（仅 E 类需要）<textarea className={input} rows={5} value={dynamicsText} onChange={(e) => setDynamicsText(e.target.value)} /></label>
      <button className="btn btn-primary btn-sm" onClick={save}>{draft.id ? '保存修改' : '创建要素'}</button>
    </div>
    <table className="lib-table" style={{ marginTop: 16 }}><thead><tr><th>名称</th><th>类型</th><th>层级</th><th>正文</th><th>操作</th></tr></thead><tbody>
      {pageItems.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.type}</td><td>{item.layer}</td><td>{item.content}</td><td>
        <button className="btn btn-ghost btn-sm" onClick={() => edit(item)}>编辑</button>
        <button className="btn btn-ghost btn-sm" onClick={() => void remove(item.id)}>删除</button>
      </td></tr>)}
    </tbody></table>
    <Pagination page={currentPage} totalPages={totalPages} total={items.length} onChange={setPage} />
  </div>;
}

const DEFAULT_BANDS = [
  { key: 'calm', minArousal: 0, maxArousal: 0.33, instruction: '保持平和友好的语气，按场景设定自然回应。' },
  { key: 'engaged', minArousal: 0.33, maxArousal: 0.66, instruction: '态度认真专注，按场景设定适度追问。' },
  { key: 'agitated', minArousal: 0.66, maxArousal: 1, instruction: '情绪更激动，按场景设定提高追问强度。' },
];

export function PersonaLibrary({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<PersonaConfig[]>([]);
  const [elements, setElements] = useState<Element[]>([]);
  const [draft, setDraft] = useState<Partial<PersonaConfig>>({});
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / LIB_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(currentPage * LIB_PAGE_SIZE, (currentPage + 1) * LIB_PAGE_SIZE);
  const [bandsText, setBandsText] = useState(JSON.stringify(DEFAULT_BANDS, null, 2));
  const [voiceText, setVoiceText] = useState('{}');
  const [notice, setNotice] = useState('');
  const load = () => fetchPersonaConfigs().then((r) => setItems(r.personaConfigs)).catch((e) => setNotice(apiError(e, '加载失败')));
  useEffect(() => { void load(); listElements().then((r) => setElements(r.elements)).catch(() => {}); }, []);
  const reset = () => {
    setDraft({ name: '', background: '', personalityTags: [], objections: [], hiddenInfo: [], elementIds: [], knowledgeBoundary: { mustNotKnow: [], loadedKnowledge: [] } });
    setBandsText(JSON.stringify(DEFAULT_BANDS, null, 2));
    setVoiceText('{}');
  };
  const edit = (item: PersonaConfig) => {
    setDraft(item);
    setBandsText(JSON.stringify(item.behaviorBands, null, 2));
    setVoiceText(JSON.stringify(item.voiceProfile ?? {}, null, 2));
  };
  const save = async () => {
    if (!draft.name?.trim() || !draft.background?.trim()) return setNotice('角色姓名和背景必填');
    try {
      const payload = {
        ...draft,
        name: draft.name,
        background: draft.background,
        behaviorBands: JSON.parse(bandsText),
        voiceProfile: JSON.parse(voiceText),
        knowledgeBoundary: draft.knowledgeBoundary ?? { mustNotKnow: [], loadedKnowledge: [] },
      };
      if (draft.id) await updatePersonaConfig(draft.id, { ...payload, expectedVersion: draft.version });
      else await createPersonaConfig(payload);
      reset();
      setNotice('已保存');
      await load();
      onChanged?.();
    } catch (e) { setNotice(e instanceof SyntaxError ? '行为档位或音色不是合法 JSON' : apiError(e, '保存失败')); }
  };
  const remove = async (id: string) => {
    try { await deletePersonaConfig(id); await load(); onChanged?.(); }
    catch (e) { setNotice(apiError(e, '删除失败')); }
  };
  const lines = (value: string) => value.split(/[\n；;]/).map((x) => x.trim()).filter(Boolean);
  return <div className={card} style={{ padding: 16 }}>
    <div className="sec-head"><h3>陪练角色库</h3><button className="btn btn-ghost btn-sm" onClick={reset}>＋ 新建</button></div>
    <Notice value={notice} />
    <div className="lib-form">
      <label>姓名<input className={input} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>职业<input className={input} value={draft.occupation ?? ''} onChange={(e) => setDraft({ ...draft, occupation: e.target.value })} /></label>
      <label>行业<input className={input} value={draft.industry ?? ''} onChange={(e) => setDraft({ ...draft, industry: e.target.value })} /></label>
      <label>决策风格<input className={input} value={draft.decisionStyle ?? ''} onChange={(e) => setDraft({ ...draft, decisionStyle: e.target.value })} /></label>
      <label style={{ gridColumn: '1 / -1' }}>背景<textarea className={input} rows={3} value={draft.background ?? ''} onChange={(e) => setDraft({ ...draft, background: e.target.value })} /></label>
      <label>性格标签（顿号分隔）<input className={input} value={(draft.personalityTags ?? []).join('、')} onChange={(e) => setDraft({ ...draft, personalityTags: lines(e.target.value) })} /></label>
      <label>典型异议（换行分隔）<textarea className={input} value={(draft.objections ?? []).join('\n')} onChange={(e) => setDraft({ ...draft, objections: lines(e.target.value) })} /></label>
      <label>禁止透露（换行分隔）<textarea className={input} value={(draft.hiddenInfo ?? []).join('\n')} onChange={(e) => setDraft({ ...draft, hiddenInfo: lines(e.target.value) })} /></label>
      <label>角色不应知道（换行分隔）<textarea className={input} value={(draft.knowledgeBoundary?.mustNotKnow ?? []).join('\n')} onChange={(e) => setDraft({ ...draft, knowledgeBoundary: { mustNotKnow: lines(e.target.value), loadedKnowledge: draft.knowledgeBoundary?.loadedKnowledge ?? [] } })} /></label>
      <label>角色额外知识（换行分隔）<textarea className={input} value={(draft.knowledgeBoundary?.loadedKnowledge ?? []).join('\n')} onChange={(e) => setDraft({ ...draft, knowledgeBoundary: { mustNotKnow: draft.knowledgeBoundary?.mustNotKnow ?? [], loadedKnowledge: lines(e.target.value) } })} /></label>
      <label style={{ gridColumn: '1 / -1' }}>行为档位 JSON<textarea className={input} rows={8} value={bandsText} onChange={(e) => setBandsText(e.target.value)} /></label>
      <label style={{ gridColumn: '1 / -1' }}>音色配置 JSON<textarea className={input} rows={3} value={voiceText} onChange={(e) => setVoiceText(e.target.value)} /></label>
      <fieldset style={{ gridColumn: '1 / -1' }}><legend>引用要素</legend><div className="lib-checks">
        {elements.map((element) => <label key={element.id}><input type="checkbox" checked={(draft.elementIds ?? []).includes(element.id)} onChange={(e) => setDraft({ ...draft, elementIds: e.target.checked ? [...(draft.elementIds ?? []), element.id] : (draft.elementIds ?? []).filter((id) => id !== element.id) })} />{element.name}</label>)}
      </div></fieldset>
      <button className="btn btn-primary btn-sm" onClick={save}>{draft.id ? '保存修改' : '创建角色'}</button>
    </div>
    <table className="lib-table" style={{ marginTop: 16 }}><thead><tr><th>姓名</th><th>职业</th><th>版本</th><th>背景</th><th>操作</th></tr></thead><tbody>
      {pageItems.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.occupation}</td><td>v{item.version}</td><td>{item.background}</td><td>
        <button className="btn btn-ghost btn-sm" onClick={() => edit(item)}>编辑</button>
        <button className="btn btn-ghost btn-sm" onClick={() => void remove(item.id)}>删除</button>
      </td></tr>)}
    </tbody></table>
    <Pagination page={currentPage} totalPages={totalPages} total={items.length} onChange={setPage} />
  </div>;
}

const KB_KIND_LABELS: Record<KbEntry['kind'], string> = { keypoint: '产品要点', redline: '红线', competitor: '竞品', faq: 'FAQ' };

export function ProductKBLibrary() {
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(entries.length / LIB_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  /** 分页切片但保留条目在 entries 中的原始下标，确保修改/删除仍作用于正确条目 */
  const pageEntries = entries
    .map((entry, index) => ({ entry, index }))
    .slice(currentPage * LIB_PAGE_SIZE, (currentPage + 1) * LIB_PAGE_SIZE);
  const load = () => fetchManagementKnowledgeBase().then((r) => {
    setName(r.kb?.name ?? '');
    setEntries(r.entries);
    setVersion(r.kb?.version ?? 0);
  }).catch((e) => setNotice(apiError(e, '加载失败')));
  useEffect(() => { void load(); }, []);
  const update = (index: number, patch: Partial<KbEntry>) => setEntries(entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  const save = async () => {
    if (!name.trim()) return setNotice('知识库名称必填');
    if (entries.some((entry) => !entry.title.trim() || !entry.content.trim())) return setNotice('每条目的标题和内容必填');
    try {
      const result = await saveManagementKnowledgeBase({ name, entries, expectedVersion: version });
      setNotice(`已保存，版本 v${result.version}`);
      await load();
    } catch (e) { setNotice(apiError(e, '保存失败')); }
  };
  return <div className={card} style={{ padding: 16 }}>
    <div className="sec-head"><h3>产品知识库</h3><button className="btn btn-primary btn-sm" onClick={save}>保存全部</button></div>
    <Notice value={notice} />
    <label>知识库名称<input className={input} value={name} onChange={(e) => setName(e.target.value)} /></label>
    <table className="lib-table" style={{ marginTop: 16 }}><thead><tr><th>类型</th><th>标题</th><th>内容</th><th>频率%</th><th>操作</th></tr></thead><tbody>
      {pageEntries.map(({ entry, index }) => <tr key={entry.id}><td><select className="lib-cell" value={entry.kind} onChange={(e) => update(index, { kind: e.target.value as KbEntry['kind'] })}>{Object.entries(KB_KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></td>
        <td><input className="lib-cell" value={entry.title} onChange={(e) => update(index, { title: e.target.value })} /></td>
        <td><textarea className="lib-cell" value={entry.content} onChange={(e) => update(index, { content: e.target.value })} /></td>
        <td><input className="lib-cell" type="number" value={entry.frequency ?? ''} onChange={(e) => update(index, { frequency: e.target.value === '' ? undefined : Number(e.target.value) })} /></td>
        <td><button className="btn btn-ghost btn-sm" onClick={() => setEntries(entries.filter((_, i) => i !== index))}>删除</button></td></tr>)}
    </tbody></table>
    <Pagination page={currentPage} totalPages={totalPages} total={entries.length} onChange={setPage} />
    <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setEntries([...entries, { id: crypto.randomUUID(), kind: 'keypoint', title: '', content: '' }])}>＋ 添加条目</button>
  </div>;
}
