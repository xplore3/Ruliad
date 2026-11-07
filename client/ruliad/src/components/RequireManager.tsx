import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { getStoredUser } from '../api';
import { isManagerRole } from '../lib/roles';

/** 管理者路由守卫：仅管理者角色可访问，否则回首页 */
export default function RequireManager({ children }: { children: ReactNode }) {
  const user = getStoredUser();
  if (!user || !isManagerRole(user.role)) {
    return <Navigate to="/home" replace />;
  }
  return <>{children}</>;
}
