import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiError,
  fetchCurrentUser,
} from '../api';
import type { User } from '../types';
import { isManagerRole, roleLabel } from '../lib/roles';

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrentUser()
      .then((u) => setUser(u))
      .catch((e) => setError(apiError(e, '加载失败，请稍后重试')));
  }, []);

  const isManager = isManagerRole(user?.role);
  const orgName = user?.organizationName ?? null;

  return (
    <main className="wrap">
      {error && (
        <section className="section" style={{ paddingBottom: 0 }}>
          <div className="card empty">
            <div className="ic">⚠️</div>
            <h3>加载失败</h3>
            <p>{error}</p>
          </div>
        </section>
      )}

      {/* 用户信息卡 */}
      <section className="card profile">
        <div className="avatar av5">{user?.name?.[0] ?? '我'}</div>
        <div className="pinfo">
          <h1>{user?.name ?? '—'}</h1>
          <span
            className={`chip ${isManager ? 'chip-coral' : 'chip-blue'}`}
            style={{ marginBottom: 8, alignSelf: 'flex-start' }}
          >
            {roleLabel(user)}
          </span>
        </div>
        <div className="pact">
          <button className="btn ghost sm" onClick={() => navigate('/settings')}>
            设置
          </button>
          <button className="btn ghost sm" onClick={() => navigate('/settings', { state: { scrollTo: 'about' } })}>
            关于
          </button>
        </div>
      </section>

      {/* 所属机构（由系统管理员统一分配，用户端只读展示） */}
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="org-mark" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="small muted">所属机构</div>
            <b style={{ fontSize: 16 }}>{orgName ?? '尚未加入机构'}</b>
            {orgName ? (
              <div
                className="small"
                style={{ marginTop: 6, lineHeight: 1.7, color: '#4B5563', wordBreak: 'break-word' }}
              >
                {user?.organizationDescription?.trim() || '暂无简介'}
              </div>
            ) : (
              <div className="small muted" style={{ marginTop: 2 }}>
                加入机构请联系系统管理员
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 我的入口 */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="card me-list">
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/practice-records'); }}>
            <i className="me-dot" />练习记录<span className="arrow">›</span>
          </a>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/ability'); }}>
            <i className="me-dot" />能力进阶图<span className="arrow">›</span>
          </a>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/feedback'); }}>
            <i className="me-dot" />意见反馈<span className="arrow">›</span>
          </a>
          {isManager && (
            <a href="#" onClick={(e) => { e.preventDefault(); navigate('/management'); }}>
              <i className="me-dot" />团队能力管理<span className="arrow">›</span>
            </a>
          )}
          {(user?.role === 'admin' || user?.role === 'platform') && (
            <a href="#" onClick={(e) => { e.preventDefault(); navigate('/recordings'); }}>
              <i className="me-dot" />录音管理<span className="arrow">›</span>
            </a>
          )}
          {(user?.role === 'admin' || user?.role === 'platform') && (
            <a href="#" onClick={(e) => { e.preventDefault(); navigate('/admin/feedback'); }}>
              <i className="me-dot" />反馈管理<span className="arrow">›</span>
            </a>
          )}
          {user?.role === 'admin' && (
            <a href="#" onClick={(e) => { e.preventDefault(); navigate('/admin/organizations'); }}>
              <i className="me-dot" />机构管理<span className="arrow">›</span>
            </a>
          )}
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/build'); }}>
            <i className="me-dot" />我的场景<span className="arrow">›</span>
          </a>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/settings'); }}>
            <i className="me-dot" />设置<span className="arrow">›</span>
          </a>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/settings', { state: { scrollTo: 'about' } }); }}>
            <i className="me-dot" />关于<span className="arrow">›</span>
          </a>
        </div>
      </section>

    </main>
  );
}
