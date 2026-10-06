import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { useLockedTeam } from '../team/LockedTeamContext';
import { TeamSelect, type TeamOption } from '../../components/TeamSelect';

// Debrief pages are team-scoped. A student implicitly gets their own team; an instructor has no team,
// so they pick one (kept in `?teamId=` so links between the Debrief pages and a browser refresh keep
// it). The server already accepts `?teamId=` from instructors on every /history route.
export function useDebriefTeam() {
  const isInstructor = useAuthStore((s) => s.user?.role === 'instructor');
  const locked = useLockedTeam();
  const [params, setParams] = useSearchParams();
  const teamId = isInstructor ? locked ?? (Number(params.get('teamId')) || null) : null;

  const { data: teamsData } = useQuery({
    queryKey: ['admin-teams-list'],
    queryFn: () => apiFetch<{ teams: TeamOption[] }>('/admin/teams'),
    enabled: isInstructor,
  });

  const query = teamId ? `?teamId=${teamId}` : '';
  // Instructor without a team picked yet: callers must not fetch (the API would 400).
  const ready = !isInstructor || teamId != null;

  // Inside the Team Workspace the team is fixed — no picker.
  const picker = isInstructor && !locked ? (
    <TeamSelect
      teams={teamsData?.teams}
      value={teamId}
      onChange={(id) => setParams(id ? { teamId: String(id) } : {})}
    />
  ) : null;

  // Links between the Debrief pages. Inside the Team Workspace they stay in its Debrief tab
  // (?tab=debrief&range=…) instead of leaving for the standalone /debrief routes.
  const links = locked
    ? {
        home: '?tab=debrief',
        summary: (cyberRangeId: number) => `?tab=debrief&range=${cyberRangeId}`,
        event: '?tab=debrief&range=event',
      }
    : {
        home: `/debrief${query}`,
        summary: (cyberRangeId: number) => `/debrief/${cyberRangeId}${query}`,
        event: `/debrief/event-summary${query}`,
      };

  return { isInstructor, teamId, query, ready, picker, locked: locked != null, links };
}
