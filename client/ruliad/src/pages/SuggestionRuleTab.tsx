import { useEffect, useState } from 'react';
import {
  apiError,
  deleteSuggestionRule,
  listSuggestionRules,
  saveSuggestionRule,
  type SuggestionRuleItem,
} from '../api';

const CATEGORY_OPTIONS = ['', '地推', '电销', '咨询接待', '现场成交'] as const;

const KEY_LABELS: Record<string, string> = {
  'ground-push-incomplete': '地推·未完成演练',
  'taboo-deterministic': '忌讳项·确定性规则',
  'generic-goal': '通用·改进目标兜底',
  'summary-fallback': '通用·教练总结兜底',
};

/** 改进建议库：点评/改进建议的文案与阶段逻辑；评分引擎按 key+category 读取 */
export default function SuggestionRuleTab({ setNotice }: { setNotice: (notice: string | null) => void }) {
  const [items, setItems] = useState<SuggestionRuleItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState('');
  const [draftData, setDraftData] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => listSuggestionRules().then((r) => setItems(r.items)).catch((e) => setNotice(apiError(e, '加载失败')));
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const expand = (rule: SuggestionRuleItem) => {
    if (expandedId === rule.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(rule.id);
    setDraftName(rule.name);
    setDraftCategory(rule.category ?? '');
    setDraftData(JSON.stringify(rule.data, null, 2));
  };

  const save = async (rule: SuggestionRuleItem) => {
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(draftData);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
      data = parsed;
    } catch {
      setNotice('规则内容必须是合法的 JSON 对象');
      return;
    }
    if (!draftName.trim()) return setNotice('规则名称必填');
    setBusy(true);
    try {
      await saveSuggestionRule({ id: rule.id, name: draftName.trim(), key: rule.key, category: draftCategory || undefined, data });
      setNotice(`已保存「${draftName.trim()}」，之后的评分立即按新建议输出`);
      setExpandedId(null);
      await reload();
    } catch (e) {
      setNotice(apiError(e, '保存失败'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rule: SuggestionRuleItem) => {
    if (!window.confirm(`确定删除「${rule.name}」？删除后该规则组回退为系统默认建议。`)) return;
    setBusy(true);
    try {
      await deleteSuggestionRule(rule.id);
      setNotice('已删除，该规则组回退为系统默认建议');
      if (expandedId === rule.id) setExpandedId(null);
      await reload();
    } catch (e) {
      setNotice(apiError(e, '删除失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card lib-card" style={{ padding: 20 }}>
      <div className="fs-head">
        <div>
          <h3>改进建议库</h3>
          <p className="hint">
            点评与改进建议的唯一来源：评分引擎按规则键 + 场景分类读取，不再写死在代码里。
            修改保存后立即生效；删除某条规则会回退为系统默认建议。也可以用场景编辑器的语音指令直接改。
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {items.map((rule) => (
          <div key={rule.id} className="card inner-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong>{rule.name}</strong>
              <span className="chip gray">{KEY_LABELS[rule.key] ?? rule.key}</span>
              <span className="chip blue">{rule.category || '通用'}</span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-ghost btn-sm" onClick={() => expand(rule)}>
                {expandedId === rule.id ? '收起' : '编辑'}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void remove(rule)}>删除</button>
            </div>
            {expandedId === rule.id && (
              <div style={{ marginTop: 12 }}>
                <div className="field">
                  <label>规则名称</label>
                  <input className="input" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                </div>
                <div className="field">
                  <label>适用场景分类（空=通用）</label>
                  <select className="input" value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)}>
                    {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c || '通用'}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>规则内容（JSON：阶段定义、建议文本、模板等）</label>
                  <textarea
                    className="input"
                    rows={18}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                    value={draftData}
                    onChange={(e) => setDraftData(e.target.value)}
                  />
                </div>
                <p className="hint">规则键 key 不可修改（评分引擎按 key 定位）：{rule.key}</p>
                <button className="btn btn-primary" disabled={busy} onClick={() => void save(rule)}>保存</button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="hint">暂无建议规则。</p>}
      </div>
    </div>
  );
}
