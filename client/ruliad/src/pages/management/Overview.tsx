import { useEffect, useState } from 'react';
import { apiError, fetchManagementOverview } from '../../api';
import type { ManagementOverview } from '../../types';

const KIND_LABELS: Record<string, string> = {
  keypoint: '要点',
  redline: '红线',
  competitor: '竞品对比',
  faq: 'FAQ',
};

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ManagementOverview() {
  const [data, setData] = useState<ManagementOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchManagementOverview()
      .then(setData)
      .catch((e) => setError(apiError(e, '总览加载失败')))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ padding: 28, textAlign: 'center' }}>
        <p className="small muted" style={{ marginBottom: 12 }}>{error ?? '加载失败'}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );
  }

  const { stats, knowledgeBase: kb, attention, recent } = data;
  const statItems = [
    { label: '团队成员', value: stats.members, unit: '人' },
    { label: '小组', value: stats.teams, unit: '个' },
    { label: '练习场次', value: stats.practiceCount, unit: '场' },
    { label: '考核场次', value: stats.examCount, unit: '场' },
    { label: '通过率', value: stats.passRate ?? '—', unit: stats.passRate != null ? '%' : '' },
    { label: '平均分', value: stats.avgScore ?? '—', unit: stats.avgScore != null ? '分' : '' },
    { label: '认证人数', value: stats.certifiedMembers, unit: '人' },
    { label: '已完成', value: stats.completedCount, unit: '场' },
  ];

  return (
    <div>
      {/* 机构信息 */}
      <div className="card" style={{ padding: '16px 22px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="avatar av2" style={{ width: 42, height: 42, fontSize: 17, flex: 'none' }}>🏢</div>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 15.5 }}>{data.org.name ?? '未绑定机构'}</b>
          <div className="small muted">
            {data.me.name} · {data.me.managerTypeLabel ?? '管理者'}
          </div>
        </div>
      </div>

      {/* 统计 */}
      <div className="stats" style={{ marginBottom: 18 }}>
        {statItems.map((item) => (
          <div key={item.label} className="card stat">
            <div className="lb">{item.label}</div>
            <div className="vl">
              {item.value}
              {item.unit && <small> {item.unit}</small>}
            </div>
          </div>
        ))}
      </div>

      {/* 知识库概览 */}
      <div className="card" style={{ padding: '18px 22px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <b style={{ fontSize: 15.5 }}>📚 知识库</b>
          <span className="small muted">v{kb.version} · 生效于 {fmtDate(kb.effectiveAt)}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span className="chip chip-gray">{kb.name ?? '未命名知识库'}</span>
          <span className="chip chip-blue">共 {kb.entryCount} 条</span>
          {Object.entries(kb.kindCounts).map(([kind, count]) => (
            <span key={kind} className="chip chip-amber">{KIND_LABELS[kind] ?? kind} {count}</span>
          ))}
          {kb.entryCount === 0 && <span className="small muted">暂无知识条目，去「知识库管理」维护</span>}
        </div>
      </div>

      {/* 需关注 */}
      <div className="card" style={{ padding: '18px 22px', marginBottom: 18 }}>
        <b style={{ fontSize: 15.5 }}>⚠️ 需关注成员</b>
        {attention.length === 0 ? (
          <p className="small muted" style={{ marginTop: 10 }}>暂无需要特别关注的成员</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {attention.map((a) => (
              <div key={a.userId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="avatar av4" style={{ width: 30, height: 30, fontSize: 12, flex: 'none' }}>{a.userName[0] ?? '—'}</div>
                <b style={{ fontSize: 14 }}>{a.userName}</b>
                <span className="chip chip-coral">{a.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 近期活跃 */}
      <div className="card" style={{ padding: '18px 22px' }}>
        <b style={{ fontSize: 15.5 }}>🕒 近期活跃</b>
        {recent.length === 0 ? (
          <p className="small muted" style={{ marginTop: 10 }}>暂无成员活动</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {recent.map((m) => (
              <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="avatar av4" style={{ width: 30, height: 30, fontSize: 12, flex: 'none' }}>{m.name[0] ?? '—'}</div>
                <b style={{ fontSize: 14, flex: 1 }}>{m.name}</b>
                <span className="small muted">练习 {m.practiceCount} 场</span>
                <span className="small muted">{m.lastAt ? fmtDate(m.lastAt) : '未练习'}</span>
                <b style={{ fontSize: 15, color: m.lastScore == null ? '#9CA3AF' : m.lastScore >= 80 ? '#2FAE7B' : m.lastScore >= 60 ? '#F5A623' : '#FF6B5B' }}>
                  {m.lastScore ?? '—'}
                </b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
