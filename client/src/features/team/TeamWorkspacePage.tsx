import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Avatar } from '../../components/Avatar';

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
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-lg)',
          marginBottom: 'var(--space-xl)',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-telemetry)',
              marginBottom: 6,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--signal-primary)',
              }}
            />
            Team Workspace
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 600, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            {data?.team.name}
          </h1>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-lg)',
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            padding: '10px 20px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--text-telemetry)',
              }}
            >
              Team Members
            </span>
            <span className="tabular" style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--text-primary)' }}>
              {data?.members.length ?? 0}
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-container)',
          background: 'var(--surface-1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '10px 20px',
            background: 'var(--surface-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-telemetry)',
          }}
        >
          Member
        </div>
        {data?.members.map((member) => (
          <div
            key={member.id}
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid rgba(51, 65, 85, 0.3)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 15,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={member.displayName} size={36} />
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{member.displayName}</span>
            </span>
            <span className="tabular" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-telemetry)' }}>
              @{member.username}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
