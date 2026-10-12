import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { isStaff } from '../lib/permissions';

interface ProtectedRouteProps {
  children: ReactNode;
  requireStaff?: boolean;
}

// UX only — the server enforces every permission on its own.
export function ProtectedRoute({ children, requireStaff }: ProtectedRouteProps) {
  const { token, user } = useAuthStore();

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  if (requireStaff && !isStaff(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
