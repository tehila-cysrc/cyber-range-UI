import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ActiveCyberRangePage } from '../features/activeCyberRange/ActiveCyberRangePage';

// Instructors have no team, so the student-focused "active Cyber Range" home doesn't apply to them —
// send them straight to their dashboard instead of a query that would 400.
export function HomeRoute() {
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'instructor') {
    return <Navigate to="/instructor" replace />;
  }
  return <ActiveCyberRangePage />;
}
