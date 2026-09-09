import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';

interface TeamWorkspace {
  team: { id: number; name: string };
  members: { id: number; username: string; displayName: string }[];
}

export function TeamWorkspacePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['team-workspace'],
    queryFn: () => apiFetch<TeamWorkspace>('/teams/me'),
  });

  if (isLoading) {
    return <div style={{ padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <h1 style={{ fontSize: 24, color: 'var(--text-primary)', margin: '0 0 4px' }}>
        {data?.team.name}
      </h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--space-lg)' }}>
        Your team environment — members and shared context for this Cyber Range.
      </p>

      <div
        style={{
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-container)',
          background: 'var(--surface-1)',
          overflow: 'hidden',
        }}
      >
        {data?.members.map((member) => (
          <div
            key={member.id}
            style={{
              padding: '10px 16px',
              borderBottom: '1px solid rgba(51, 65, 85, 0.3)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 15,
            }}
          >
            <span style={{ color: 'var(--text-primary)' }}>{member.displayName}</span>
            <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>
              @{member.username}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
