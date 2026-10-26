/** 组织与权限模型 */

export type UserRole = 'trainee' | 'supervisor' | 'admin' | 'executive' | 'platform';

/** 数据三层所有权 */
export type DataLayer = 'platform' | 'industry' | 'tenant';

export interface Organization {
  id: string;
  tenantId: string;
  name: string;
  parentId?: string;
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
}

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
