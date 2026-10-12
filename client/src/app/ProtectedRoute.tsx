import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { hasPermission, isStaff, type Permission } from '../lib/permissions';

interface ProtectedRouteProps {
  children: ReactNode;
  // Staff page: the signed-in user must be staff and (once the server sent the list) hold this.
  permission?: Permission;
}

// UX only — the server enforces every permission and scope on its own.
export function ProtectedRoute({ children, permission }: ProtectedRouteProps) {
  const { token, user, permissions } = useAuthStore();

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  if (permission && (!isStaff(user.role) || (permissions !== null && !hasPermission(permissions, user.role, permission)))) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
