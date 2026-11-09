import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiError,
  deleteFeedback,
  fetchAllFeedback,
  replyFeedback,
  updateFeedbackStatus,
} from '../../api';
import type { Feedback, FeedbackStatus, FeedbackType } from '../../types';
import {
  FEEDBACK_STATUS_CHIP,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPE_LABELS,
} from '../../types';
import VoiceCommandReview from '../VoiceCommandReview';

const STATUS_FILTERS: Array<{ key: FeedbackStatus | ''; label: string }> = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待处理' },
  { key: 'processing', label: '处理中' },
  { key: 'resolved', label: '已解决' },
  { key: 'closed', label: '已关闭' },
];

const STATUS_ACTIONS: FeedbackStatus[] = ['pending', 'processing', 'resolved', 'closed'];

const PAGE_SIZE = 20;

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 单条反馈（管理视角）：摘要行 + 展开后回复/状态操作 */
function AdminFeedbackItem({
  fb,
  expanded,
  onToggle,
  onReply,
  onStatus,
  onDelete,
  busy,
}: {
  fb: Feedback;
  expanded: boolean;
  onToggle: () => void;
  onReply: (content: string) => void;
  onStatus: (status: FeedbackStatus) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const submitReply = async () => {
    const text = replyText.trim();
    if (!text || sending || busy) return;
    setSending(true);
    try {
      await onReply(text);
      setReplyText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* 摘要行（点击展开/收起） */}
      <div className="fb-admin-item" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onToggle(); }}>
        <div className="avatar av5">{fb.userName?.[0] ?? '用'}</div>
        <div className="fb-admin-main">
          <div className="fb-admin-head">
            <span className={`chip ${FEEDBACK_STATUS_CHIP[fb.status] ?? 'chip-gray'}`}>
              {FEEDBACK_STATUS_LABELS[fb.status] ?? fb.status}
            </span>
            <span className="chip chip-blue">{FEEDBACK_TYPE_LABELS[fb.type] ?? fb.type}</span>
            <b>{fb.userName}</b>
            <time>{fmtDateTime(fb.createdAt)}</time>
          </div>
          <p className="fb-admin-content">{fb.content}</p>
          <div className="fb-admin-foot">
            {fb.source?.trim() && (
              <span className="fb-source"><span className="ic">📍</span>{fb.source}</span>
            )}
            <span className="replied">
              {fb.replies.length > 0 ? `已回复 ${fb.replies.length} 条` : '未回复'}
            </span>
            <span className="arrow" style={{ marginLeft: 'auto' }}>{expanded ? '⌃' : '⌄'}</span>
          </div>
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="fb-admin-detail" style={{ borderTop: '1px solid #F1F2F4' }}>
          <div className="fb-admin-head">
            <span className={`chip ${FEEDBACK_STATUS_CHIP[fb.status] ?? 'chip-gray'}`}>
              {FEEDBACK_STATUS_LABELS[fb.status] ?? fb.status}
            </span>
            <span className="chip chip-blue">{FEEDBACK_TYPE_LABELS[fb.type] ?? fb.type}</span>
            <time>{fmtDateTime(fb.createdAt)}</time>
          </div>

          <p className="fb-content">{fb.content}</p>
          {fb.source?.trim() && (
            <div className="fb-source"><span className="ic">📍</span>{fb.source}</div>
          )}

          {/* 回复列表 */}
          <div className="fb-replies">
            {fb.replies.length === 0 && (
              <div className="small muted" style={{ paddingTop: 12 }}>暂无回复</div>
            )}
            {fb.replies.map((r) => (
              <div key={r.id} className="fb-reply">
                <div className="fb-reply-head">
                  <b>{r.userName}</b>
                  <time>{fmtDateTime(r.createdAt)}</time>
                </div>
                <p>{r.content}</p>
              </div>
            ))}
          </div>

          {/* 回复输入 */}
          <div className="fb-reply-box">
            <textarea
              className="input"
              rows={2}
              maxLength={1000}
              placeholder="输入回复内容，提交后用户可在「意见反馈」中看到…"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              disabled={sending || busy}
            />
            <button className="btn btn-primary" onClick={submitReply} disabled={sending || busy || !replyText.trim()}>
              {sending ? '发送中…' : '回复'}
            </button>
          </div>

          {/* 状态操作 + 删除 */}
          <div className="fb-detail-foot">
            <span className="small muted">标记为：</span>
            {STATUS_ACTIONS.map((s) => (
              <button
                key={s}
                className={`chip ${fb.status === s ? FEEDBACK_STATUS_CHIP[s] : 'chip-gray'}`}
                style={{ cursor: 'pointer', border: 'none' }}
                onClick={() => onStatus(s)}
                disabled={busy || fb.status === s}
              >
                {FEEDBACK_STATUS_LABELS[s]}
              </button>
            ))}
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 'auto', color: '#D43D2A' }}
              onClick={onDelete}
              disabled={busy}
            >
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FeedbackManagement() {
  const navigate = useNavigate();
  const [section, setSection] = useState<'feedback' | 'ai'>('feedback');
  const [status, setStatus] = useState<FeedbackStatus | ''>('');
  const [type, setType] = useState<FeedbackType | ''>('');
  const [items, setItems] = useState<Feedback[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (reset: boolean) => {
      const nextOffset = reset ? 0 : offset;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const res = await fetchAllFeedback({
          status,
          type,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        setItems((prev) => (reset ? res.feedbacks : [...prev, ...res.feedbacks]));
        setTotal(res.total);
        setOffset(nextOffset + res.feedbacks.length);
      } catch (err) {
        setError(apiError(err, '反馈列表加载失败'));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [status, type, offset]
  );

  // 筛选条件变化 → 重新加载
  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, type]);

  const patchItem = (id: string, patch: Partial<Feedback>) =>
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const handleReply = async (id: string, content: string) => {
    setBusyId(id);
    try {
      const reply = await replyFeedback(id, content);
      setItems((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, replies: [...f.replies, reply] } : f
        )
      );
    } catch (err) {
      setError(apiError(err, '回复失败，请稍后重试'));
    } finally {
      setBusyId(null);
    }
  };

  const handleStatus = async (id: string, statusValue: FeedbackStatus) => {
    setBusyId(id);
    try {
      const updated = await updateFeedbackStatus(id, statusValue);
      patchItem(id, { status: updated.status });
    } catch (err) {
      setError(apiError(err, '状态更新失败，请稍后重试'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除这条反馈吗？删除后不可恢复。')) return;
    setBusyId(id);
    try {
      await deleteFeedback(id);
      setItems((prev) => prev.filter((f) => f.id !== id));
      setTotal((v) => Math.max(0, v - 1));
      if (expandedId === id) setExpandedId(null);
    } catch (err) {
      setError(apiError(err, '删除失败，请稍后重试'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="wrap">
      <div className="sec-head" style={{ marginBottom: 14, paddingTop: 10 }}>
        <h2 className="bar-title">反馈管理</h2>
        <button className="more back-link" onClick={() => navigate('/profile')}>返回我的 ›</button>
      </div>

      <div className="seg seg-lg" style={{ marginBottom: 16 }}>
        <button className={section === 'feedback' ? 'on' : ''} onClick={() => setSection('feedback')}>用户反馈</button>
        <button className={section === 'ai' ? 'on' : ''} onClick={() => setSection('ai')}>AI自动提炼</button>
      </div>

      {section === 'ai' ? <VoiceCommandReview /> : <>
        <div className="filterbar">
          <div className="group">
            {STATUS_FILTERS.map((f) => (
              <button key={f.key} className={`chip ${status === f.key ? 'on' : ''}`} onClick={() => setStatus(f.key)}>{f.label}</button>
            ))}
          </div>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as FeedbackType | '')}>
            <option value="">全部类型</option><option value="suggestion">功能建议</option>
            <option value="bug">问题反馈</option><option value="other">其他</option>
          </select>
          <span className="small muted" style={{ marginLeft: 'auto' }}>共 {total} 条</span>
        </div>

        {error && <div className="fb-notice err" style={{ marginBottom: 12 }}>{error}</div>}
        {loading && <div className="card empty">加载中…</div>}
        {!loading && !error && items.length === 0 && <div className="card empty"><div className="ic">📭</div><h3>暂无反馈</h3><p>当前筛选条件下没有用户反馈</p></div>}

        <div className="fb-list">
          {items.map((fb) => <AdminFeedbackItem
            key={fb.id} fb={fb} expanded={expandedId === fb.id}
            onToggle={() => setExpandedId((prev) => (prev === fb.id ? null : fb.id))}
            onReply={(content) => void handleReply(fb.id, content)}
            onStatus={(s) => void handleStatus(fb.id, s)}
            onDelete={() => void handleDelete(fb.id)} busy={busyId === fb.id}
          />)}
        </div>

        {!loading && items.length < total && <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={() => void load(false)} disabled={loadingMore}>
            {loadingMore ? '加载中…' : `加载更多（还有 ${total - items.length} 条）`}
          </button>
        </div>}
      </>}
    </main>
  );
}
