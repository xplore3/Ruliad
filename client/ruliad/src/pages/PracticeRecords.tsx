import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiError, fetchMySessions } from '../api';
import type { MySessionRecord } from '../api';

/** 练习记录：当前用户全部练习会话（含筛选、分页），入口在【我的】页与能力进阶图 */

const TIME_TABS = ['全部', '本周', '本月'] as const;
const MODE_OPTIONS = ['全部模式', '练习', '考核'] as const;

const MODE_LABEL: Record<string, string> = { practice: '练习', exam: '考核' };
const MODE_ICON: Record<string, string> = { practice: '🎯', exam: '📋' };

const scoreClass = (s: number) => (s >= 85 ? 's-hi' : s >= 60 ? 's-mid' : 's-lo');

const PAGE_SIZE = 8;

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diffDays === 0) return `今天 ${hm}`;
  if (diffDays === 1) return `昨天 ${hm}`;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const nums: (number | '…')[] = [0];
  const s = Math.max(1, current - 1);
  const e = Math.min(total - 2, current + 1);
  if (s > 1) nums.push('…');
  for (let i = s; i <= e; i++) nums.push(i);
  if (e < total - 2) nums.push('…');
  nums.push(total - 1);
  return nums;
}

export default function PracticeRecords() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<MySessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeTab, setTimeTab] = useState<(typeof TIME_TABS)[number]>('全部');
  const [mode, setMode] = useState<(typeof MODE_OPTIONS)[number]>('全部模式');
  const [category, setCategory] = useState<string>('全部类别');
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetchMySessions()
      .then((mine) => setRecords(mine.records))
      .catch((e) => setError(apiError(e, '加载失败，请稍后重试')))
      .finally(() => setLoading(false));
  }, []);

  const completed = useMemo(
    () => records.filter((r) => r.status === 'completed' && r.totalScore != null),
    [records]
  );
  const avgScore = completed.length > 0
    ? Math.round(completed.reduce((sum, r) => sum + (r.totalScore ?? 0), 0) / completed.length)
    : null;

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const r of records) if (r.scenarioName) names.add(r.scenarioName);
    return ['全部类别', ...names];
  }, [records]);

  const filtered = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return records.filter((r) => {
      const at = new Date(r.at);
      if (timeTab === '本周' && at < weekStart) return false;
      if (timeTab === '本月' && at < monthStart) return false;
      if (mode !== '全部模式' && MODE_LABEL[r.mode] !== mode) return false;
      if (category !== '全部类别' && r.scenarioName !== category) return false;
      return true;
    });
  }, [records, timeTab, mode, category]);

  const handleRecordClick = (r: MySessionRecord) => {
    if (r.status === 'completed' && r.totalScore != null) {
      navigate(`/review/${r.sessionId}`);
    } else {
      alert('本次练习未完成，暂无报告');
    }
  };

  // 筛选变化时回到第一页
  useEffect(() => { setPage(0); }, [timeTab, mode, category]);
  // 筛选后总页数变少时修正当前页
  useEffect(() => {
    const t = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > t - 1) setPage(t - 1);
  }, [filtered.length, page]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shownRecords = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <main className="wrap">
      {/* 页头 + 汇总 */}
      <section className="section" style={{ paddingBottom: 4 }}>
        <div className="sec-head">
          <h2>📒 练习记录</h2>
          <span className="more">共 {records.length} 场</span>
        </div>

        <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 8 }}>
          <div className="card stat">
            <div className="lb">累计场次</div>
            <div className="vl">{records.length}</div>
          </div>
          <div className="card stat">
            <div className="lb">已完成</div>
            <div className="vl">{completed.length}</div>
          </div>
          <div className="card stat">
            <div className="lb">平均分</div>
            <div className="vl">{avgScore ?? '—'}</div>
          </div>
        </div>
      </section>

      {/* 筛选 */}
      <section className="section" style={{ paddingTop: 0, paddingBottom: 4 }}>
        <div className="filterbar">
          <div className="group">
            {TIME_TABS.map((t) => (
              <span
                key={t}
                className={`chip${timeTab === t ? ' on' : ''}`}
                onClick={() => setTimeTab(t)}
              >
                {t}
              </span>
            ))}
          </div>
          <select
            className="input"
            value={mode}
            onChange={(e) => setMode(e.target.value as (typeof MODE_OPTIONS)[number])}
          >
            {MODE_OPTIONS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </section>

      {/* 记录列表 + 分页 */}
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
            </div>
          )}

          {!loading && !error && shownRecords.map((r) => {
            const done = r.status === 'completed' && r.totalScore != null;
            const modeLabel = MODE_LABEL[r.mode] ?? r.mode;
            const meta = [
              `${MODE_ICON[r.mode] ?? '🎯'} ${modeLabel}模式`,
              fmtTime(r.at),
              r.durationSec != null ? `用时 ${Math.max(1, Math.round(r.durationSec / 60))} 分钟` : null,
            ].filter(Boolean).join(' · ');
            return (
              <div
                key={r.sessionId}
                className="card rec"
                onClick={() => handleRecordClick(r)}
                style={{ cursor: 'pointer' }}
              >
                <div className={`avatar ${r.mode === 'exam' ? 'av3' : 'av1'}`}>
                  {MODE_ICON[r.mode] ?? '🎯'}
                </div>
                <div className="rmain">
                  <h3>
                    {r.scenarioName ?? '练习场景'}{' '}
                    <span className={`chip ${r.mode === 'exam' ? 'coral' : 'blue'}`}>{modeLabel}</span>
                  </h3>
                  <div className="meta">{meta}</div>
                </div>
                <div className="rscore">
                  {done ? (
                    <>
                      <b className={scoreClass(r.totalScore ?? 0)}>{r.totalScore}</b>
                      <span className="unit"> 分</span>
                    </>
                  ) : (
                    <b className="muted" style={{ fontSize: '13px', fontWeight: 500 }}>未完成</b>
                  )}
                </div>
                <span className="rlink">{done ? '报告 ›' : ''}</span>
              </div>
            );
          })}

          {!loading && !error && filtered.length === 0 && (
            <div className="card empty">
              <div className="ic">🎯</div>
              <h3>还没有练习记录</h3>
              <p>从首页挑一个场景，开始你的第一次练习吧</p>
              <button className="btn primary" onClick={() => navigate('/home')}>
                去首页
              </button>
            </div>
          )}
        </div>

        {/* 分页 */}
        {!loading && !error && totalPages > 1 && (
          <>
            <div className="small muted" style={{ textAlign: 'center', marginTop: 18 }}>
              共 {filtered.length} 条 · 第 {page + 1} / {totalPages} 页
            </div>
            <div className="pagination">
              <button
                className="pg-btn"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ‹ 上一页
              </button>
              <div className="pg-pages">
                {pageNumbers(page, totalPages).map((p, i) =>
                  p === '…' ? (
                    <span key={`e${i}`} className="pg-ellipsis">…</span>
                  ) : (
                    <span
                      key={p}
                      className={`pg-num${p === page ? ' on' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p + 1}
                    </span>
                  )
                )}
              </div>
              <button
                className="pg-btn"
                disabled={page === totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                下一页 ›
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
