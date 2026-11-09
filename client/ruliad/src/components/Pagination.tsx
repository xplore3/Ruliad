/** 通用分页条：复用「练习记录分页」样式（.pagination / .pg-btn / .pg-num），页码 0-based；仅 1 页时不显示 */
export default function Pagination({ page, totalPages, total, onChange }: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="pg-btn" disabled={page === 0} onClick={() => onChange(Math.max(0, page - 1))}>‹ 上一页</button>
      <div className="pg-pages">
        {pageNumbers(page, totalPages).map((p, i) =>
          p === '…'
            ? <span key={`ellipsis-${i}`} className="pg-ellipsis">…</span>
            : <button key={p} className={`pg-num${p === page ? ' on' : ''}`} onClick={() => onChange(p)}>{p + 1}</button>
        )}
      </div>
      <button className="pg-btn" disabled={page >= totalPages - 1} onClick={() => onChange(Math.min(totalPages - 1, page + 1))}>下一页 ›</button>
      <span className="pg-total">共 {total} 条</span>
    </div>
  );
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
