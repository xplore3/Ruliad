import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiError,
  fetchManagementKnowledgeBase,
  saveManagementKnowledgeBase,
} from '../../api';
import type { KbEntry, ManagementKb } from '../../types';

const KIND_LABELS: Record<KbEntry['kind'], string> = {
  keypoint: '要点',
  redline: '红线',
  competitor: '竞品对比',
  faq: 'FAQ',
};
const KIND_ORDER: KbEntry['kind'][] = ['keypoint', 'redline', 'competitor', 'faq'];

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 编辑中的条目（frequency 用字符串输入，保存时转 number） */
interface DraftEntry {
  id: string;
  kind: KbEntry['kind'];
  title: string;
  content: string;
  frequency: string;
}

export default function ManagementKnowledgeBase() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [version, setVersion] = useState(0);
  const [effectiveAt, setEffectiveAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetchManagementKnowledgeBase()
      .then((data: ManagementKb) => {
        setName(data.kb?.name ?? '产品知识库');
        setVersion(data.kb?.version ?? 0);
        setEffectiveAt(data.kb?.effectiveAt ?? null);
        setEntries(
          (data.entries ?? []).map((e) => ({
            id: e.id,
            kind: e.kind,
            title: e.title,
            content: e.content,
            frequency: e.frequency != null ? String(e.frequency) : '',
          }))
        );
      })
      .catch((e) => setError(apiError(e, '知识库加载失败')))
      .finally(() => setLoading(false));
  }, []);

  const kindCounts = useMemo(() => {
    const counts = {} as Record<string, number>;
    for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    return counts;
  }, [entries]);

  const updateEntry = (id: string, patch: Partial<DraftEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setSaveMsg(null);
  };

  const addEntry = () => {
    setEntries((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'keypoint',
        title: '',
        content: '',
        frequency: '',
      },
    ]);
    setSaveMsg(null);
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setSaveMsg(null);
  };

  const handleSave = async () => {
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveMsg({ kind: 'err', text: '请填写知识库名称' });
      return;
    }
    for (const [i, e] of entries.entries()) {
      if (!KIND_ORDER.includes(e.kind)) {
        setSaveMsg({ kind: 'err', text: `第 ${i + 1} 条类型无效` });
        return;
      }
      if (!e.title.trim() || !e.content.trim()) {
        setSaveMsg({ kind: 'err', text: `第 ${i + 1} 条的标题与内容必填` });
        return;
      }
      if (e.frequency !== '' && !Number.isFinite(Number(e.frequency))) {
        setSaveMsg({ kind: 'err', text: `第 ${i + 1} 条的频率需为数字` });
        return;
      }
    }

    setSaving(true);
    setSaveMsg(null);
    try {
      const payload = {
        name: trimmedName,
        entries: entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          title: e.title.trim(),
          content: e.content.trim(),
          ...(e.frequency !== '' ? { frequency: Number(e.frequency) } : {}),
        })),
      };
      const res = await saveManagementKnowledgeBase(payload);
      setVersion(res.version);
      setEffectiveAt(new Date().toISOString());
      setSaveMsg({ kind: 'ok', text: `已保存（版本 v${res.version}）` });
    } catch (e) {
      setSaveMsg({ kind: 'err', text: apiError(e, '保存失败，请稍后重试') });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: 28, textAlign: 'center' }}>
        <p className="small muted" style={{ marginBottom: 12 }}>{error}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );
  }

  return (
    <div>
      {/* 页头 */}
      <div className="card" style={{ padding: '16px 22px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="bar-title"><b style={{ fontSize: 15.5 }}>知识库管理</b></div>
          <span className="chip chip-gray">v{version}</span>
          {effectiveAt && <span className="small muted">生效于 {fmtDate(effectiveAt)}</span>}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost sm" onClick={() => navigate('/management')}>返回总览</button>
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>
          陪练时系统会按以下条目为 AI 陪练员提供产品知识；修改保存后即时生效于新的会话。
        </div>
      </div>

      {/* 名称与类型统计 */}
      <div className="card" style={{ padding: '16px 22px', marginBottom: 18 }}>
        <div className="small muted" style={{ marginBottom: 8 }}>知识库名称</div>
        <input
          className="input"
          style={{ width: '100%', maxWidth: 360 }}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入知识库名称"
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <span className="small muted">共 {entries.length} 条：</span>
          {KIND_ORDER.map((k) => (
            <span key={k} className={`chip ${k === 'redline' ? 'chip-coral' : k === 'keypoint' ? 'chip-blue' : k === 'competitor' ? 'chip-amber' : 'chip-green'}`}>
              {KIND_LABELS[k]} {kindCounts[k] ?? 0}
            </span>
          ))}
        </div>
      </div>

      {/* 条目列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 18 }}>
        {entries.length === 0 && (
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <p className="small muted" style={{ marginBottom: 14 }}>暂无知识条目，点击下方按钮添加第一条</p>
          </div>
        )}
        {entries.map((e, idx) => (
          <div key={e.id} className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <span className="small muted">#{idx + 1}</span>
              <select
                className="input"
                style={{ width: 130 }}
                value={e.kind}
                onChange={(ev) => updateEntry(e.id, { kind: ev.target.value as KbEntry['kind'] })}
              >
                {KIND_ORDER.map((k) => (
                  <option key={k} value={k}>{KIND_LABELS[k]}</option>
                ))}
              </select>
              <input
                className="input"
                style={{ flex: 1, minWidth: 160 }}
                placeholder="标题"
                value={e.title}
                maxLength={120}
                onChange={(ev) => updateEntry(e.id, { title: ev.target.value })}
              />
              <input
                className="input"
                style={{ width: 110 }}
                placeholder="频率(可选)"
                value={e.frequency}
                inputMode="numeric"
                onChange={(ev) => updateEntry(e.id, { frequency: ev.target.value })}
              />
              <button className="btn btn-ghost sm" onClick={() => removeEntry(e.id)}>删除</button>
            </div>
            <textarea
              className="input"
              style={{ width: '100%', minHeight: 72, resize: 'vertical' }}
              placeholder="内容（产品要点 / 竞品差异 / 标准答法等）"
              value={e.content}
              maxLength={2000}
              onChange={(ev) => updateEntry(e.id, { content: ev.target.value })}
            />
          </div>
        ))}
      </div>

      {/* 操作区 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 24 }}>
        <button className="btn ghost sm" onClick={addEntry}>+ 添加条目</button>
        <button className="btn primary" disabled={saving} onClick={handleSave}>
          {saving ? '保存中…' : '保存知识库'}
        </button>
        {saveMsg && (
          <span className="small" style={{ color: saveMsg.kind === 'ok' ? '#2FAE7B' : '#FF6B5B' }}>
            {saveMsg.text}
          </span>
        )}
      </div>
    </div>
  );
}
