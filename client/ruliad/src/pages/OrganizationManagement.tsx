import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiError,
  createOrganization,
  fetchOrganizations,
  fetchUsers,
  updateOrganization,
  updateUser,
} from '../api';
import type { ManagerType, OrganizationItem, User } from '../types';
import { roleLabel } from '../lib/roles';

/** 未分配机构用户的占位 orgId（注册默认 / 尚未加入任何机构） */
const UNASSIGNED = 'default';

/** 机构成员列表分页：每页条数 */
const PAGE_SIZE = 10;

/** 可选身份：练习者（普通成员）+ 三类负责人（同时设为管理者） */
const IDENTITIES = [
  { value: 'trainee', label: '练习者' },
  { value: 'org_head', label: '机构负责人' },
  { value: 'sales_head', label: '销售负责人' },
  { value: 'training_head', label: '培训负责人' },
] as const;

type Identity = (typeof IDENTITIES)[number]['value'];

/** 用户当前身份：练习者 → trainee；管理者无细分类型时按机构负责人展示（与后端默认一致） */
function identityOf(user: User): Identity {
  if (user.role === 'trainee') return 'trainee';
  return (user.managerType as Identity | undefined) ?? 'org_head';
}

/**
 * 身份 → PATCH 字段：
 * - 练习者：角色降为 trainee，清除管理者类型
 * - 负责人：角色为练习者时升为 supervisor；已是管理者则保持原角色（不降级 admin/executive/platform），仅补管理者类型
 */
function identityPatch(identity: Identity, current: User): { role: User['role']; managerType: ManagerType | null } {
  if (identity === 'trainee') return { role: 'trainee', managerType: null };
  return {
    role: current.role === 'trainee' ? 'supervisor' : current.role,
    managerType: identity,
  };
}

export default function OrganizationManagement() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<OrganizationItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 一级机构选择框：选定后展示该机构的所有用户
  const [selectedOrgId, setSelectedOrgId] = useState('');
  // 成员列表分页（0 基页码，每页 PAGE_SIZE 条）
  const [memberPage, setMemberPage] = useState(0);

  // 新建机构
  const [newOrgName, setNewOrgName] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [orgMsg, setOrgMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 用户加入机构
  const [assignUserId, setAssignUserId] = useState('');
  const [assignOrgId, setAssignOrgId] = useState('');
  const [assignIdentity, setAssignIdentity] = useState<Identity>('trainee');
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 成员身份行内编辑
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
  const [memberMsg, setMemberMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 机构简介编辑（按机构 id 记草稿，避免相互覆盖）
  const [introDrafts, setIntroDrafts] = useState<Record<string, string>>({});
  const [introBusyId, setIntroBusyId] = useState<string | null>(null);
  const [introMsg, setIntroMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [orgRes, userList] = await Promise.all([fetchOrganizations(), fetchUsers()]);
    setOrgs(orgRes.organizations);
    setUsers(userList);
  }, []);

  useEffect(() => {
    reload()
      .catch((e) => setError(apiError(e, '加载失败，请稍后重试')))
      .finally(() => setLoading(false));
  }, [reload]);

  const orgName = useCallback(
    (orgId: string) => {
      if (orgId === UNASSIGNED) return '未分配机构';
      return orgs.find((o) => o.id === orgId)?.name ?? '未知机构';
    },
    [orgs]
  );

  /** 用户选择列表：未分配的排在最前，其余按姓名 */
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const au = a.orgId === UNASSIGNED ? 0 : 1;
      const bu = b.orgId === UNASSIGNED ? 0 : 1;
      if (au !== bu) return au - bu;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }, [users]);

  const unassignedUsers = useMemo(() => users.filter((u) => u.orgId === UNASSIGNED), [users]);

  /** 当前选中机构；未选择时显示引导态 */
  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === selectedOrgId) ?? null,
    [orgs, selectedOrgId]
  );
  const selectedMembers = useMemo(
    () => (selectedOrg ? users.filter((u) => u.orgId === selectedOrg.id) : []),
    [users, selectedOrg]
  );

  /** 分页：总页数 / 有效当前页 / 当前页成员 */
  const pageCount = Math.max(1, Math.ceil(selectedMembers.length / PAGE_SIZE));
  const safePage = Math.min(memberPage, pageCount - 1);
  const pageMembers = useMemo(
    () => selectedMembers.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [selectedMembers, safePage]
  );

  /** 切换机构时重置到第一页 */
  const pickOrg = (orgId: string) => {
    setSelectedOrgId(orgId);
    setMemberPage(0);
  };

  // 机构列表变化时补齐简介草稿（不覆盖已编辑内容）
  useEffect(() => {
    setIntroDrafts((prev) => {
      const next = { ...prev };
      for (const o of orgs) {
        if (next[o.id] === undefined) next[o.id] = o.description ?? '';
      }
      return next;
    });
  }, [orgs]);

  const handleCreateOrg = async () => {
    const name = newOrgName.trim();
    if (!name) {
      setOrgMsg({ kind: 'err', text: '请输入机构名称' });
      return;
    }
    if (creatingOrg) return;
    setCreatingOrg(true);
    setOrgMsg(null);
    try {
      const { organization } = await createOrganization(name);
      setNewOrgName('');
      setOrgMsg({ kind: 'ok', text: `机构「${name}」已创建` });
      await reload();
      pickOrg(organization.id);
    } catch (e) {
      setOrgMsg({ kind: 'err', text: apiError(e, '创建机构失败，请稍后重试') });
    } finally {
      setCreatingOrg(false);
    }
  };

  const handleAssign = async () => {
    if (!assignUserId) {
      setAssignMsg({ kind: 'err', text: '请选择用户' });
      return;
    }
    if (!assignOrgId) {
      setAssignMsg({ kind: 'err', text: '请选择目标机构' });
      return;
    }
    const target = users.find((u) => u.id === assignUserId);
    if (!target) {
      setAssignMsg({ kind: 'err', text: '用户不存在，请重新选择' });
      return;
    }
    if (assigning) return;
    setAssigning(true);
    setAssignMsg(null);
    try {
      await updateUser(assignUserId, {
        ...identityPatch(assignIdentity, target),
        orgId: assignOrgId,
      });
      setAssignMsg({
        kind: 'ok',
        text: `已将「${target.name}」加入「${orgName(assignOrgId)}」`,
      });
      await reload();
    } catch (e) {
      setAssignMsg({ kind: 'err', text: apiError(e, '加入机构失败，请稍后重试') });
    } finally {
      setAssigning(false);
    }
  };

  const handleMemberIdentity = async (member: User, identity: Identity) => {
    if (memberBusyId) return;
    setMemberBusyId(member.id);
    setMemberMsg(null);
    try {
      await updateUser(member.id, identityPatch(identity, member));
      const patch = identityPatch(identity, member);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === member.id
            ? { ...u, role: patch.role, managerType: patch.managerType ?? undefined }
            : u
        )
      );
      setMemberMsg({ kind: 'ok', text: `已更新「${member.name}」的身份` });
    } catch (e) {
      setMemberMsg({ kind: 'err', text: apiError(e, '更新身份失败，请稍后重试') });
    } finally {
      setMemberBusyId(null);
    }
  };

  const handleSaveIntro = async (org: OrganizationItem) => {
    if (introBusyId) return;
    setIntroBusyId(org.id);
    setIntroMsg(null);
    try {
      await updateOrganization(org.id, { description: (introDrafts[org.id] ?? '').trim() });
      setIntroMsg({ kind: 'ok', text: `「${org.name}」机构简介已保存` });
      await reload();
    } catch (e) {
      setIntroMsg({ kind: 'err', text: apiError(e, '保存机构简介失败，请稍后重试') });
    } finally {
      setIntroBusyId(null);
    }
  };

  const renderMemberRow = (member: User) => (
    <div
      key={member.id}
      className="card"
      style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
    >
      <div className="avatar av1" style={{ width: 36, height: 36, fontSize: 15, flex: 'none' }}>
        {member.name?.[0] ?? '·'}
      </div>
      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
        <b style={{ fontSize: 14.5 }}>{member.name}</b>
        <div className="small muted">{member.username}</div>
      </div>
      <span className={`chip ${member.role === 'trainee' ? 'chip-blue' : 'chip-coral'}`}>
        {roleLabel(member)}
      </span>
      <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        身份
        <select
          className="input"
          style={{ width: 150 }}
          value={identityOf(member)}
          disabled={memberBusyId === member.id}
          onChange={(e) => void handleMemberIdentity(member, e.target.value as Identity)}
        >
          {IDENTITIES.map((it) => (
            <option key={it.value} value={it.value}>{it.label}</option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <main className="wrap">
      <section className="section" style={{ paddingBottom: 12 }}>
        <div className="sec-head">
          <h2>🏢 机构管理</h2>
          <span className="more" style={{ color: '#FF6B5B', cursor: 'pointer' }} onClick={() => navigate('/profile')}>
            返回我的 ›
          </span>
        </div>
        <p className="small muted" style={{ marginTop: -4 }}>
          机构的新建与成员归属仅系统管理员可操作；练习者/管理者加入或调整机构均由本页统一分配。
        </p>
      </section>

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

      {!loading && !error && (
        <>
          {/* 一级机构选择框：选定后展示该机构的所有用户 */}
          <section className="section" style={{ paddingBottom: 6 }}>
            <div className="card" style={{ padding: '18px 22px' }}>
              <div className="small muted" style={{ marginBottom: 10 }}>
                机构用户查询
                {unassignedUsers.length > 0 ? `（${unassignedUsers.length} 人未分配机构）` : ''}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  className="input"
                  style={{ flex: '1 1 260px' }}
                  value={selectedOrgId}
                  onChange={(e) => pickOrg(e.target.value)}
                >
                  <option value="">请选择机构…</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}（成员 {o.memberCount} 人）
                    </option>
                  ))}
                </select>
                {selectedOrg && (
                  <button
                    className="btn ghost sm"
                    onClick={() => pickOrg('')}
                  >
                    清除选择
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* 选中机构的成员列表 */}
          {selectedOrg && (
            <section className="section" style={{ paddingBottom: 6 }}>
              <div className="sec-head">
                <h2>🏢 {selectedOrg.name}</h2>
                <span className="more">成员 {selectedOrg.memberCount} 人 · 小组 {selectedOrg.teamCount} 个</span>
              </div>
              {/* 机构简介（展示给机构成员） */}
              <div className="card" style={{ padding: '12px 16px 14px', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="small muted">机构简介</span>
                  <span className="small muted" style={{ marginLeft: 'auto' }}>
                    {(introDrafts[selectedOrg.id] ?? '').length}/300
                  </span>
                  <button
                    className="btn ghost sm"
                    disabled={introBusyId === selectedOrg.id}
                    onClick={() => void handleSaveIntro(selectedOrg)}
                  >
                    {introBusyId === selectedOrg.id ? '保存中…' : '保存简介'}
                  </button>
                </div>
                <textarea
                  className="input"
                  style={{ width: '100%', minHeight: 56, marginTop: 8, resize: 'vertical' }}
                  placeholder="填写机构简介，将展示给该机构下的成员"
                  maxLength={300}
                  value={introDrafts[selectedOrg.id] ?? ''}
                  onChange={(e) =>
                    setIntroDrafts((prev) => ({ ...prev, [selectedOrg.id]: e.target.value }))
                  }
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {selectedMembers.length === 0 && (
                  <div className="card" style={{ padding: '22px 20px', textAlign: 'center' }}>
                    <span className="small muted">该机构暂无成员，可在下方「用户加入机构」中添加</span>
                  </div>
                )}
                {pageMembers.map(renderMemberRow)}
              </div>
              {selectedMembers.length > PAGE_SIZE && (
                <div
                  className="card"
                  style={{
                    marginTop: 10,
                    padding: '10px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    className="btn ghost sm"
                    disabled={safePage === 0}
                    onClick={() => setMemberPage(safePage - 1)}
                  >
                    ‹ 上一页
                  </button>
                  <span className="small muted">
                    第 {safePage + 1} / {pageCount} 页 · 共 {selectedMembers.length} 人
                  </span>
                  <button
                    className="btn ghost sm"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setMemberPage(safePage + 1)}
                  >
                    下一页 ›
                  </button>
                </div>
              )}
            </section>
          )}

          {/* 新建机构 */}
          <section className="section" style={{ paddingBottom: 6 }}>
            <div className="card" style={{ padding: '18px 22px' }}>
              <div className="small muted" style={{ marginBottom: 10 }}>新建机构</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  style={{ flex: '1 1 240px' }}
                  placeholder="输入机构名称"
                  value={newOrgName}
                  maxLength={60}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateOrg(); }}
                />
                <button className="btn primary sm" disabled={creatingOrg} onClick={() => void handleCreateOrg()}>
                  {creatingOrg ? '创建中…' : '新建机构'}
                </button>
              </div>
              {orgMsg && (
                <div
                  className="small"
                  style={{ marginTop: 10, color: orgMsg.kind === 'ok' ? '#2FAE7B' : '#FF6B5B' }}
                >
                  {orgMsg.text}
                </div>
              )}
            </div>
          </section>

          {/* 用户加入机构 */}
          <section className="section" style={{ paddingBottom: 6 }}>
            <div className="card" style={{ padding: '18px 22px' }}>
              <div className="small muted" style={{ marginBottom: 10 }}>
                用户加入机构{unassignedUsers.length > 0 ? `（${unassignedUsers.length} 人未分配）` : ''}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  className="input"
                  style={{ flex: '1 1 240px' }}
                  value={assignUserId}
                  onChange={(e) => setAssignUserId(e.target.value)}
                >
                  <option value="">选择用户</option>
                  {sortedUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}（{u.username}）· {u.orgId === UNASSIGNED ? '未分配' : orgName(u.orgId)}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  style={{ flex: '1 1 180px' }}
                  value={assignOrgId}
                  onChange={(e) => {
                    setAssignOrgId(e.target.value);
                    if (e.target.value) pickOrg(e.target.value);
                  }}
                >
                  <option value="">选择机构</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <select
                  className="input"
                  style={{ width: 160 }}
                  value={assignIdentity}
                  onChange={(e) => setAssignIdentity(e.target.value as Identity)}
                >
                  {IDENTITIES.map((it) => (
                    <option key={it.value} value={it.value}>{it.label}</option>
                  ))}
                </select>
                <button className="btn primary sm" disabled={assigning} onClick={() => void handleAssign()}>
                  {assigning ? '提交中…' : '加入机构'}
                </button>
              </div>
              {assignMsg && (
                <div
                  className="small"
                  style={{ marginTop: 10, color: assignMsg.kind === 'ok' ? '#2FAE7B' : '#FF6B5B' }}
                >
                  {assignMsg.text}
                </div>
              )}
            </div>
          </section>

          {/* 未分配机构 */}
          {!selectedOrg && unassignedUsers.length > 0 && (
            <section className="section" style={{ paddingBottom: 6 }}>
              <div className="sec-head">
                <h2>👤 未分配机构</h2>
                <span className="more">{unassignedUsers.length} 人</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {unassignedUsers.map(renderMemberRow)}
              </div>
            </section>
          )}

          {memberMsg && (
            <div
              className="small"
              style={{
                position: 'sticky',
                bottom: memberMsg && introMsg ? 56 : 12,
                margin: '4px auto 12px',
                width: 'fit-content',
                padding: '8px 16px',
                borderRadius: 999,
                background: memberMsg.kind === 'ok' ? '#EAF8F1' : '#FFF0EE',
                color: memberMsg.kind === 'ok' ? '#2FAE7B' : '#FF6B5B',
              }}
            >
              {memberMsg.text}
            </div>
          )}
          {introMsg && (
            <div
              className="small"
              style={{
                position: 'sticky',
                bottom: 12,
                margin: '4px auto 12px',
                width: 'fit-content',
                padding: '8px 16px',
                borderRadius: 999,
                background: introMsg.kind === 'ok' ? '#EAF8F1' : '#FFF0EE',
                color: introMsg.kind === 'ok' ? '#2FAE7B' : '#FF6B5B',
              }}
            >
              {introMsg.text}
            </div>
          )}
        </>
      )}
    </main>
  );
}
