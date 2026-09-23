import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';

interface Team {
  id: number;
  name: string;
}

// Debrief pages are team-scoped. A student implicitly gets their own team; an instructor has no team,
// so they pick one (kept in `?teamId=` so links between the Debrief pages and a browser refresh keep
// it). The server already accepts `?teamId=` from instructors on every /history route.
export function useDebriefTeam() {
  const isInstructor = useAuthStore((s) => s.user?.role === 'instructor');
  const [params, setParams] = useSearchParams();
  const teamId = isInstructor ? Number(params.get('teamId')) || null : null;

  const { data: teamsData } = useQuery({
    queryKey: ['admin-teams-list'],
    queryFn: () => apiFetch<{ teams: Team[] }>('/admin/teams'),
    enabled: isInstructor,
  });

  const query = teamId ? `?teamId=${teamId}` : '';
  // Instructor without a team picked yet: callers must not fetch (the API would 400).
  const ready = !isInstructor || teamId != null;

  const picker = isInstructor ? (
    <select
      aria-label="Team"
      value={teamId ?? ''}
      onChange={(e) => setParams(e.target.value ? { teamId: e.target.value } : {})}
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-control)',
        padding: 8,
        color: 'var(--text-primary)',
      }}
    >
      <option value="">Select a team…</option>
      {teamsData?.teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  ) : null;

  return { isInstructor, teamId, query, ready, picker };
}
