import type { ManagerType, User } from '../types';

/** 管理者角色（练习者之外，均可进入团队能力管理） */
export const MANAGER_ROLES = ['supervisor', 'admin', 'executive', 'platform'];

/** 管理者类型中文名 */
export const MANAGER_TYPE_LABELS: Record<ManagerType, string> = {
  org_head: '机构负责人',
  sales_head: '销售负责人',
  training_head: '培训负责人',
};

/** 基础角色名 */
const ROLE_LABELS: Record<string, string> = {
  trainee: '销售练习者',
  supervisor: '管理者',
  admin: '管理者',
  executive: '管理者',
  platform: '平台管理员',
};

export function isManagerRole(role: string | null | undefined): boolean {
  return !!role && MANAGER_ROLES.includes(role);
}

/** 综合角色展示名：管理者附带负责人类型（如「管理者 · 机构负责人」） */
export function roleLabel(user: Pick<User, 'role' | 'managerType'> | null | undefined): string {
  if (!user) return '—';
  const base = ROLE_LABELS[user.role] ?? user.role;
  if (isManagerRole(user.role) && user.managerType) {
    return `${base} · ${MANAGER_TYPE_LABELS[user.managerType]}`;
  }
  return base;
}

/** 管理者类型名（无则空） */
export function managerTypeLabel(type: ManagerType | null | undefined): string {
  return type ? MANAGER_TYPE_LABELS[type] : '';
}
