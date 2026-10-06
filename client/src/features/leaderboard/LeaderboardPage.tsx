import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { apiFetch } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { Avatar } from '../../components/Avatar';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { useSocketEvent } from '../../hooks/useSocketEvent';

interface LeaderboardEntry {
  teamId: number;
  teamName: string;
  totalPoints: number;
}

interface TeamOrganization {
  id: number;
  organizationId: number | null;
  organizationName: string | null;
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

  useSocketEvent<{ teams: LeaderboardEntry[]; enabled?: boolean }>('leaderboard:update', ({ teams, enabled }) => {
    queryClient.setQueryData<LeaderboardResponse>(['leaderboard'], { enabled: enabled ?? true, teams });
  });

  // Instructor-only organization filter (e.g. one organization's ranking on the classroom screen).
  // Team -> organization comes from the instructor-only /admin/teams, so /leaderboard and the student
  // view stay organization-free. Kept in the URL (?org=<id>|none).
  const isInstructor = useAuthStore((s) => s.user?.role === 'instructor');
  const { data: rosterData } = useQuery({
    queryKey: ['admin-teams'],
    queryFn: () => apiFetch<{ teams: TeamOrganization[] }>('/admin/teams'),
    enabled: isInstructor,
  });
  const [params, setParams] = useSearchParams();
  const orgOf = new Map((rosterData?.teams ?? []).map((t) => [t.id, t]));
  const organizations = [
    ...new Map(
      (rosterData?.teams ?? []).filter((t) => t.organizationId !== null).map((t) => [t.organizationId!, t.organizationName ?? '']),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const hasUnassigned = (rosterData?.teams ?? []).some((t) => t.organizationId === null);
  const rawOrg = params.get('org');
  // A stale value (organization gone or emptied) falls back to every team.
  const orgFilter =
    isInstructor && rawOrg && (rawOrg === 'none' ? hasUnassigned : organizations.some(([id]) => String(id) === rawOrg)) ? rawOrg : null;
  const orgFilterLabel = orgFilter === 'none' ? 'No organization' : organizations.find(([id]) => String(id) === orgFilter)?.[1];

  if (data && !data.enabled) {
    return (
      <div style={{ padding: 'var(--space-xl)' }}>
        <EmptyState message="The leaderboard isn't enabled for this event yet." />
      </div>
    );
  }

  // Ranks are recomputed within the filter: #1 is the organization's best team.
  const teams = (data?.teams ?? []).filter((t) => {
    if (!orgFilter) return true;
    const orgId = orgOf.get(t.teamId)?.organizationId ?? null;
    return orgFilter === 'none' ? orgId === null : String(orgId) === orgFilter;
  });
  const [leader, runnerUp, ...rest] = teams;
  const lead = leader && runnerUp ? leader.totalPoints - runnerUp.totalPoints : 0;
  const spotlightTotal = leader && runnerUp ? leader.totalPoints + runnerUp.totalPoints : 0;
  const leaderShare = spotlightTotal > 0 ? (leader!.totalPoints / spotlightTotal) * 100 : 50;

  return (
    <div className="page" style={{ padding: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)' }}>
      <div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-telemetry)',
            marginBottom: 4,
          }}
        >
          Telemetry Stream
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
          <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: 0 }}>
            Leaderboard
            {orgFilterLabel && (
              <span style={{ fontSize: 20, fontWeight: 400, color: 'var(--text-muted)' }}>
                {' '}· <bdi>{orgFilterLabel}</bdi>
              </span>
            )}
          </h1>
          {isInstructor && organizations.length > 0 && (
            <select
              aria-label="Filter by organization"
              value={orgFilter ?? ''}
              onChange={(e) => setParams(e.target.value ? { org: e.target.value } : {}, { replace: true })}
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-control)',
                padding: '6px 8px',
                color: 'var(--text-primary)',
                fontSize: 14,
              }}
            >
              <option value="">All organizations</option>
              {organizations.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
              {hasUnassigned && <option value="none">No organization</option>}
            </select>
          )}
        </div>
      </div>

      {leader && runnerUp && (
        <div
          style={{
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            background: 'var(--surface-1)',
            padding: 'var(--space-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-lg)',
          }}
        >
          {lead > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <TelemetryBadge tone="primary">+{lead} pts lead</TelemetryBadge>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'stretch', gap: 'var(--space-md)' }}>
            <SpotlightCard entry={leader} rank={1} tone="primary" />
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  color: 'var(--text-telemetry)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 999,
                  padding: '4px 10px',
                  background: 'var(--surface-2)',
                }}
              >
                VS
              </span>
            </div>
            <SpotlightCard entry={runnerUp} rank={2} tone="secondary" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--text-telemetry)',
              }}
            >
              <span>{leader.teamName}</span>
              <span>{runnerUp.teamName}</span>
            </div>
            <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--surface-2)' }}>
              <div style={{ width: `${leaderShare}%`, background: 'var(--signal-primary)' }} />
              <div style={{ width: `${100 - leaderShare}%`, background: 'var(--signal-secondary)' }} />
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-container)',
          background: 'var(--surface-1)',
          overflow: 'hidden',
        }}
      >
        {teams.length === 0 && (
          <div style={{ padding: 'var(--space-lg)' }}>
            <EmptyState message={orgFilter ? 'No teams in this organization.' : 'No teams have scored yet.'} />
          </div>
        )}
        {(leader && runnerUp ? rest : teams).map((team) => {
          const rank = teams.indexOf(team) + 1;
          return (
            <div
              key={team.teamId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-md)',
                justifyContent: 'space-between',
                padding: '10px 16px',
                borderBottom: '1px solid rgba(51, 65, 85, 0.3)',
                fontSize: 15,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                <span className="tabular" style={{ color: 'var(--text-telemetry)', minWidth: 24 }}>
                  #{rank}
                </span>
                <Avatar name={team.teamName} size={26} />
                <span style={{ color: 'var(--text-primary)' }}>{team.teamName}</span>
              </div>
              <span className="tabular" style={{ color: 'var(--signal-primary)' }}>
                {team.totalPoints}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SpotlightCard({
  entry,
  rank,
  tone,
}: {
  entry: LeaderboardEntry;
  rank: 1 | 2;
  tone: 'primary' | 'secondary';
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-md)',
        padding: 'var(--space-lg)',
        borderRadius: 'var(--radius-container)',
        background: 'var(--surface-2)',
        border: rank === 1 ? '1px solid var(--signal-primary)' : '1px solid var(--surface-border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <TelemetryBadge tone={tone}>Rank {String(rank).padStart(2, '0')}</TelemetryBadge>
        <Avatar name={entry.teamName} size={32} />
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text-primary)', margin: 0 }}>
        {entry.teamName}
      </h2>
      <div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-telemetry)',
          }}
        >
          Total Score
        </div>
        <div
          className="tabular"
          style={{
            fontSize: 32,
            fontWeight: 600,
            color: rank === 1 ? 'var(--signal-primary)' : 'var(--text-primary)',
          }}
        >
          {entry.totalPoints} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-telemetry)' }}>pts</span>
        </div>
      </div>
    </div>
  );
}
