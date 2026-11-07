/** 组织与权限模型 */

export type UserRole = 'trainee' | 'supervisor' | 'admin' | 'executive' | 'platform';

/** 管理者类型：机构负责人（管全机构）/ 销售负责人（管销售团队业绩）/ 培训负责人（管训练与能力成长） */
export type ManagerType = 'org_head' | 'sales_head' | 'training_head';

/** 数据三层所有权 */
export type DataLayer = 'platform' | 'industry' | 'tenant';

export interface Organization {
  id: string;
  tenantId: string;
  name: string;
  parentId?: string;
  /** 机构简介（系统管理员维护，展示给机构成员） */
  description?: string;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  supervisorId?: string;
}

export interface User {
  id: string;
  tenantId: string;
  orgId: string;
  teamId?: string;
  name: string;
  role: UserRole;
  /** 登录账号（同租户内唯一） */
  username: string;
  /** 密码哈希（scrypt，salt:hash）。仅存储，API 输出必须剔除 */
  passwordHash: string;
  /** 用户偏好设置（设置页持久化的键值 JSON，缺省 {}） */
  preferences?: Record<string, unknown>;
  /** 管理者类型：仅管理者角色（supervisor/admin/executive/platform）可设置 */
  managerType?: ManagerType;
}

/** 管理者中文名（用于 UI 展示） */
export const MANAGER_TYPE_LABELS: Record<ManagerType, string> = {
  org_head: '机构负责人',
  sales_head: '销售负责人',
  training_head: '培训负责人',
};

export interface MethodologyConfig {
  id: string;
  tenantId: string;
  name: string;
  /** skillPointId -> 权重 */
  skillWeights: Record<string, number>;
  /** 合规红线词表（一票否决） */
  redlinePhrases: string[];
  /** 口头禅/填充词清单 */
  fillerWords: string[];
  passScore: number;
}
