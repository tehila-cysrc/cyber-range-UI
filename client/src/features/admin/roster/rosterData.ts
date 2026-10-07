import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/apiClient';
import { useToastStore } from '../../../stores/toastStore';

export interface Member {
  id: number;
  username: string;
  displayName: string;
  avatar?: string | null;
}

export interface Team {
  id: number;
  name: string;
  organizationId: number | null;
  organizationName: string | null;
  members: Member[];
}

export interface Organization {
  id: number;
  name: string;
  teamCount: number;
  joinCode: string | null;
}

// What the main area shows: an organization, the unassigned teams, every student, or the instructor accounts.
export type Selection = { kind: 'org'; id: number } | { kind: 'none' } | { kind: 'students' } | { kind: 'instructors' };

export const inputStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
  minWidth: 0,
};

export const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 13,
  padding: 0,
};

// Join codes are 8 characters; shown as XXXX-XXXX so they're easy to read aloud. The server ignores
// dashes and spaces, so students can type it either way.
export function formatJoinCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function useRosterData() {
  const teams = useQuery({
    queryKey: ['admin-teams'],
    queryFn: () => apiFetch<{ teams: Team[] }>('/admin/teams'),
  });
  const organizations = useQuery({
    queryKey: ['admin-organizations'],
    queryFn: () => apiFetch<{ organizations: Organization[] }>('/admin/organizations'),
  });
  return {
    teams: teams.data?.teams ?? [],
    organizations: organizations.data?.organizations ?? [],
    loaded: !!teams.data && !!organizations.data,
  };
}

// Every roster write refreshes the same queries (teams + organizations + the dashboard's team list).
export function useRosterMutation<TVars>(mutationFn: (vars: TVars) => Promise<unknown>, fallbackError: string, onDone?: () => void) {
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
      queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin-instructors'] });
      queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
      onDone?.();
    },
    onError: (err) => pushToast(err instanceof Error ? err.message : fallbackError),
  });
}

export function postJson(path: string, body: unknown, method = 'POST') {
  return apiFetch(path, { method, body: JSON.stringify(body) });
}
