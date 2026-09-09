import { useAuthStore } from '../../stores/authStore';
import { InstructorScoringPanel } from './InstructorScoringPanel';
import { ScoreHistoryList } from './ScoreHistoryList';

export function ProgressPage() {
  const role = useAuthStore((s) => s.user?.role);
  return role === 'instructor' ? <InstructorScoringPanel /> : <ScoreHistoryList />;
}
