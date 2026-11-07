import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { fetchInstitutionOnboardingStatus, getStoredUser } from '../api';

const TABS = [
  { to: '/management', label: '总览', end: true },
  { to: '/management/team-results', label: '团队成果', end: false },
  { to: '/management/team-ability', label: '团队能力', end: false },
  { to: '/management/knowledge-base', label: '知识库管理', end: false },
];

/** 机构资料初始化入口卡片（仅系统管理员/平台管理员可见） */
function InstitutionOnboardingEntry() {
  const navigate = useNavigate();
  const canManageInstitution = ['admin', 'platform'].includes(getStoredUser()?.role ?? '');
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!canManageInstitution) return;
    fetchInstitutionOnboardingStatus()
      .then((status) => setCompleted(status.completed))
      .catch(() => undefined);
  }, [canManageInstitution]);

  if (!canManageInstitution) return null;

  return (
    <div
      role="button"
      tabIndex={0}
      className="card train-card"
      style={{ marginBottom: 18, minHeight: 0 }}
      onClick={() => navigate('/institution-onboarding')}
      onKeyDown={(event) => {
        if (event.key === 'Enter') navigate('/institution-onboarding');
      }}
    >
      <div className="train-left">
        <div className="train-icon">🏢</div>
        <h3>{completed ? '修改初始化信息' : '初始化信息'}</h3>
        <p className="desc">
          {completed
            ? '查看并修改已提交的机构问答，重新提交后应用于所有场景'
            : '通过 20 个问题建立培训机构定制资料库，供所有场景使用'}
        </p>
        <div className="train-meta">
          <span className="train-go">{completed ? '修改并重新提交 →' : '开始初始化 →'}</span>
        </div>
      </div>
    </div>
  );
}

export default function Management() {
  return (
    <main className="wrap" style={{ paddingTop: 10 }}>
      <div className="sec-head" style={{ marginBottom: 12 }}>
        <h2 className="bar-title">团队能力管理</h2>
        <NavLink to="/profile" className="more" style={{ color: '#FF6B5B' }}>返回我的 ›</NavLink>
      </div>

      {/* 子导航 */}
      <div className="cats">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `chip ${isActive ? 'active' : 'chip-gray'}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      <div style={{ paddingTop: 18 }}>
        <InstitutionOnboardingEntry />
        <Outlet />
      </div>
    </main>
  );
}
