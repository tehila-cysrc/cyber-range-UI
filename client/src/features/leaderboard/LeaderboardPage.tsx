import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { useSocketEvent } from '../../hooks/useSocketEvent';

interface LeaderboardEntry {
  teamId: number;
  teamName: string;
  totalPoints: number;
}

interface LeaderboardResponse {
  enabled: boolean;
  teams: LeaderboardEntry[];
}

export function LeaderboardPage() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => apiFetch<LeaderboardResponse>('/leaderboard'),
  });

  useSocketEvent<{ teams: LeaderboardEntry[] }>('leaderboard:update', ({ teams }) => {
    queryClient.setQueryData<LeaderboardResponse>(['leaderboard'], { enabled: true, teams });
  });

  if (data && !data.enabled) {
    return (
      <div style={{ padding: 'var(--space-xl)' }}>
        <EmptyState message="The leaderboard isn't enabled for this event yet." />
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <h1 style={{ fontSize: 20, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
        Leaderboard
      </h1>
      <div
        style={{
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-container)',
          background: 'var(--surface-1)',
          overflow: 'hidden',
        }}
      >
        {data?.teams.map((team, i) => (
          <div
            key={team.teamId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 16px',
              borderBottom: '1px solid rgba(51, 65, 85, 0.3)',
              fontSize: 13,
            }}
          >
            <span style={{ color: 'var(--text-primary)' }}>
              <span className="tabular" style={{ color: 'var(--text-telemetry)', marginRight: 8 }}>
                #{i + 1}
              </span>
              {team.teamName}
            </span>
            <span className="tabular" style={{ color: 'var(--signal-primary)' }}>
              {team.totalPoints}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
