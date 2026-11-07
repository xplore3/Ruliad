import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  apiError,
  deleteRecording,
  fetchRecordings,
  fetchScenarios,
  recordingAudioUrl,
} from '../api';
import type { RecordingGroup, RecordingItem } from '../api';
import type { Scenario } from '../types';

/** 录音管理（admin/platform）：查看全部用户的练习录音，支持筛选、回放与删除。
 *  同一场练习会话的录音归为一组，组内按说话顺序（回合序号）排列。 */

const MODE_CHIPS = ['全部', '练习', '考核'] as const;
const PAGE_SIZE = 20;

type ModeChip = (typeof MODE_CHIPS)[number];

const MODE_LABEL: Record<string, string> = { practice: '练习', exam: '考核' };

function fmtTime(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDuration(sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}分${p2(s)}秒` : `${s}秒`;
}

function p2(n: number) {
  return String(n).padStart(2, '0');
}

function fmtSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Recordings() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<RecordingGroup[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalGroups, setTotalGroups] = useState(0);
  const [groupOffset, setGroupOffset] = useState(0);
  const [mode, setMode] = useState<ModeChip>('全部');
  const [scenarioId, setScenarioId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const queryMode = mode === '全部' ? undefined : (mode === '练习' ? 'practice' : 'exam');

  // 关键字输入防抖：停止输入 300ms 后再请求后端
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRecordings({
        mode: queryMode,
        scenarioId: scenarioId || undefined,
        keyword: debouncedKeyword || undefined,
        limit: PAGE_SIZE,
        offset: 0,
      });
      setGroups(res.groups);
      setTotalItems(res.totalItems);
      setTotalGroups(res.total);
      setGroupOffset(res.groups.length);
    } catch (e) {
      setError(apiError(e, '加载失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  }, [queryMode, scenarioId, debouncedKeyword]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  useEffect(() => {
    fetchScenarios()
      .then((res) => setScenarios(res.scenarios))
      .catch(() => {
        /* 场景加载失败不阻塞列表 */
      });
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetchRecordings({
        mode: queryMode,
        scenarioId: scenarioId || undefined,
        keyword: debouncedKeyword || undefined,
        limit: PAGE_SIZE,
        offset: groupOffset,
      });
      setGroups((prev) => [...prev, ...res.groups]);
      setGroupOffset((prev) => prev + res.groups.length);
      setTotalItems(res.totalItems);
      setTotalGroups(res.total);
    } catch (e) {
      setError(apiError(e, '加载更多失败，请稍后重试'));
    } finally {
      setLoadingMore(false);
    }
  };

  const hasMore = groupOffset < totalGroups;

  const handleDelete = async (r: RecordingItem) => {
    if (!window.confirm(`确定删除该录音吗？\n\n用户：${r.userName}\n场景：${r.scenarioName}\n第 ${r.turnSeq} 轮 · ${fmtTime(r.createdAt)}\n\n删除后不可恢复。`)) {
      return;
    }
    const targetGroup = groups.find((g) => g.sessionId === r.sessionId);
    const removeGroup = targetGroup ? targetGroup.items.length === 1 : true;
    setDeletingId(r.id);
    try {
      await deleteRecording(r.id);
      setGroups((prev) =>
        prev.flatMap((g) => {
          if (g.sessionId !== r.sessionId) return [g];
          const items = g.items.filter((x) => x.id !== r.id);
          if (items.length === 0) return [];
          const startedAt = items.reduce(
            (min, x) => (x.createdAt < min ? x.createdAt : min),
            items[0].createdAt
          );
          const lastAt = items.reduce(
            (max, x) => (x.createdAt > max ? x.createdAt : max),
            items[0].createdAt
          );
          return [{ ...g, items, turnCount: items.length, startedAt, lastAt }];
        })
      );
      if (removeGroup) setTotalGroups((prev) => Math.max(0, prev - 1));
      setTotalItems((prev) => Math.max(0, prev - 1));
    } catch (e) {
      alert(apiError(e, '删除失败，请稍后重试'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="wrap">
      <section className="section" style={{ paddingBottom: 12 }}>
        <div className="sec-head">
          <h2>🎙️ 录音管理</h2>
          <span className="more">
            共 {totalItems} 条录音{totalGroups > 0 ? ` · ${totalGroups} 场练习` : ''}
          </span>
        </div>

        {/* 筛选行 */}
        <div className="filterbar">
          <div className="group">
            {MODE_CHIPS.map((m) => (
              <span
                key={m}
                className={`chip${mode === m ? ' on' : ''}`}
                onClick={() => setMode(m)}
              >
                {m}
              </span>
            ))}
          </div>
          <select
            className="input"
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)}
          >
            <option value="">全部场景</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <input
            className="input"
            style={{ flex: 1, minWidth: 160 }}
            placeholder="按用户名搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </section>

      {/* 录音列表：按练习会话分组 */}
      <section className="section" style={{ paddingTop: 0, paddingBottom: 36 }}>
        <div className="rec-list">
          {loading && (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
            </div>
          )}

          {!loading && error && (
            <div className="card empty">
              <div className="ic">⚠️</div>
              <h3>加载失败</h3>
              <p>{error}</p>
              <button className="btn primary" onClick={() => void loadFirst()}>重试</button>
            </div>
          )}

          {!loading && !error && groups.map((g) => {
            const firstTurn = g.items[0]?.turnSeq ?? 0;
            const lastTurn = g.items[g.items.length - 1]?.turnSeq ?? 0;
            return (
              <div className="card rec-group" key={g.sessionId}>
                <div className="rec-group-head">
                  <div className="avatar av2">{g.userName[0] ?? '?'}</div>
                  <div className="rmain">
                    <h3>
                      {g.scenarioName}{' '}
                      <span className={`chip ${g.mode === 'exam' ? 'coral' : 'blue'}`}>
                        {MODE_LABEL[g.mode] ?? g.mode}
                      </span>
                      <span className="chip gray">{g.turnCount} 条录音</span>
                    </h3>
                    <div className="meta">
                      {g.userName} ·{' '}
                      {firstTurn === lastTurn ? `第 ${firstTurn} 轮` : `第 ${firstTurn}–${lastTurn} 轮`}{' '}
                      · {fmtTime(g.startedAt)}
                      {g.lastAt !== g.startedAt ? ` ~ ${fmtTime(g.lastAt)}` : ''}
                    </div>
                  </div>
                  <Link className="btn ghost sm rec-group-link" to={`/review/${g.sessionId}`}>
                    📊 评分报告
                  </Link>
                </div>

                <div className="rec-turns">
                  {g.items.map((r) => (
                    <div className="rec-turn" key={r.id}>
                      <span className="turn-no">第 {r.turnSeq} 轮</span>
                      <span className="turn-meta">
                        {fmtTime(r.createdAt)} · 时长 {fmtDuration(r.durationSec)} · {fmtSize(r.fileSize)}
                      </span>
                      <audio
                        controls
                        preload="none"
                        src={recordingAudioUrl(r.id)}
                      />
                      <button
                        className="btn ghost sm"
                        disabled={deletingId === r.id}
                        onClick={() => void handleDelete(r)}
                      >
                        {deletingId === r.id ? '删除中…' : '删除'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {!loading && !error && groups.length === 0 && (
            <div className="card empty">
              <div className="ic">🎙️</div>
              <h3>{keyword ? '没有匹配的录音' : '还没有练习录音'}</h3>
              <p>{keyword ? '换个关键词试试' : '学员完成语音练习后，录音会出现在这里'}</p>
              <button className="btn primary" onClick={() => navigate('/home')}>去首页</button>
            </div>
          )}
        </div>

        {/* 加载更多 */}
        {!loading && !error && hasMore && (
          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <button className="btn btn-ghost btn-sm" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? '加载中…' : `加载更多（已 ${groupOffset} / ${totalGroups} 场练习）`}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
