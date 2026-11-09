import { useEffect, useState } from 'react';
import { apiError, listVoiceEditCommands, reviewVoiceEditCommand } from '../api';
import type { VoiceEditCommand } from '../types';

const STATUS_LABELS: Record<VoiceEditCommand['status'], string> = {
  previewed: '仅预览', applied: '已应用', pending_review: '待处理', in_review: '处理中', resolved: '已解决', rejected: '不采纳',
};

const TARGET_LABELS: Record<string, string> = {
  scenario: '场景', persona: '角色', 'skill-point': '技能点', element: '要素', 'product-kb': '产品知识库',
  'demo-faq': '示范问答', 'demo-script': '示范剧本', 'drill-script': '演练剧本', 'score-item': '评分标准',
  'golden-case': '回归案例', 'briefing-standard': '讲解标准', 'realism-standard': '真实度标准', 'scenario-guidance': '场景指引',
};

export default function VoiceCommandReview() {
  const [items, setItems] = useState<VoiceEditCommand[]>([]);
  const [generalOnly, setGeneralOnly] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => listVoiceEditCommands(generalOnly).then((r) => setItems(r.items)).catch((e) => setNotice(apiError(e, '命令记录加载失败')));
  useEffect(() => { void load(); }, [generalOnly]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const review = async (status: 'in_review' | 'resolved' | 'rejected') => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await reviewVoiceEditCommand(selected.id, { status, reviewNote: note });
      setNotice('处理状态已保存');
      setSelectedId(null);
      setNote('');
      await load();
    } catch (e) { setNotice(apiError(e, '保存失败')); }
    finally { setBusy(false); }
  };
  return <div className="card lib-card" style={{ padding: 20 }}>
    <div className="sec-head">
      <div><h3>AI自动提炼</h3><p className="hint">展示用户通过场景语音创建、修改和资源编辑产生的命令与通用建议；在这里统一处理，不直接修改业务资源。</p></div>
      <button className="btn btn-ghost btn-sm" onClick={() => setGeneralOnly(!generalOnly)}>{generalOnly ? '查看全部命令' : '只看通用建议'}</button>
    </div>
    {notice && <p className="hint">{notice}</p>}
    <table className="lib-table"><thead><tr><th>时间</th><th>用户</th><th>对象</th><th>命令</th><th>影响场景</th><th>状态</th><th>操作</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}>
        <td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.userId}</td>
        <td>{TARGET_LABELS[item.target] ?? item.target} · {item.action === 'create' ? '新建' : '修改'}</td>
        <td style={{ maxWidth: 360 }}>{item.text}{item.general && <div className="lib-warn">{item.generalReason || '通用/共享问题'}</div>}</td>
        <td>{item.affectedScenarioIds.length}</td><td>{STATUS_LABELS[item.status]}</td>
        <td><button className="btn btn-ghost btn-sm" onClick={() => { setSelectedId(item.id); setNote(item.reviewNote ?? ''); }}>查看/处理</button></td>
      </tr>)}
    </tbody></table>
    {items.length === 0 && <p className="hint" style={{ marginTop: 16 }}>暂无记录</p>}
    {selected && <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <h3>命令详情</h3>
      <p><b>原始命令：</b>{selected.text}</p>
      {selected.transcript && <p><b>语音转写：</b>{selected.transcript}</p>}
      <p><b>通用问题：</b>{selected.generalReason || (selected.general ? '通用或共享修改' : '否')}</p>
      <p><b>资源 ID：</b>{selected.resourceId || '新建'}；<b>影响场景 ID：</b>{selected.affectedScenarioIds.join('、') || '无'}</p>
      <pre className="input" style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>{JSON.stringify(selected.patch, null, 2)}</pre>
      <label>处理记录<textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="记录技术方案、处理结果或不采纳原因" /></label>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void review('in_review')}>标记处理中</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void review('resolved')}>标记已解决</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void review('rejected')}>不采纳</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => setSelectedId(null)}>关闭</button>
      </div>
    </div>}
  </div>;
}
