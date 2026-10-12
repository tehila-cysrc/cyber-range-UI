import { useAuthStore } from '../../stores/authStore';
import { isStaff } from '../../lib/permissions';
import { InstructorScoringPanel } from './InstructorScoringPanel';
import { ScoreHistoryList } from './ScoreHistoryList';

export function ProgressPage() {
  const role = useAuthStore((s) => s.user?.role);
  return isStaff(role) ? <InstructorScoringPanel /> : <ScoreHistoryList />;
}
