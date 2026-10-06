import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { useDebriefTeam } from './useDebriefTeam';

// Every scenario the team is no longer live on: completed, or paused by a switch to another one.
interface PastRange {
  cyberRangeId: number;
  name: string;
  difficulty: string;
  dayLabel: string;
  status: 'completed' | 'paused';
  startedAt: string | null;
  completedAt: string | null;
}

export function HistoryPage() {
  const { query, ready, picker, isInstructor, locked, links } = useDebriefTeam();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['history', query],
    queryFn: () => apiFetch<{ scenarios: PastRange[] }>(`/history${query}`),
    enabled: ready,
  });

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-md)' }}>
        <h1 style={{ fontSize: locked ? 17 : 22, color: 'var(--text-primary)', margin: 0 }}>
          {locked ? 'Past scenarios' : 'Debrief — past scenarios'}
        </h1>
        <span style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
          {picker}
          {ready && (
            <Link to={links.event} style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
              Event summary →
            </Link>
          )}
        </span>
      </div>

      {!ready && <EmptyState message="Pick a team above to review its completed scenarios." />}
      {ready && isLoading && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}
      {isError && <EmptyState message="Couldn't load the debrief — try refreshing." />}
      {data && data.scenarios.length === 0 && (
        <EmptyState
          message={
            isInstructor
              ? 'This team has no past scenarios yet. A scenario appears here once it is marked completed or the team is switched to another one.'
              : 'No past scenarios yet — a scenario appears here once it is completed or your team moves on to another one.'
          }
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {data?.scenarios.map((cr) => (
          <Link
            key={cr.cyberRangeId}
            to={links.summary(cr.cyberRangeId)}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-sm)',
              justifyContent: 'space-between',
              padding: 'var(--space-sm) var(--space-md)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-control)',
              background: 'var(--surface-1)',
              textDecoration: 'none',
              fontSize: 15,
            }}
          >
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <TelemetryBadge tone="secondary">{cr.dayLabel}</TelemetryBadge>
              <TelemetryBadge tone={cr.difficulty === 'advanced' ? 'alert' : 'tertiary'}>
                {cr.difficulty}
              </TelemetryBadge>
              <span style={{ color: 'var(--text-primary)' }}>{cr.name}</span>
              {cr.status === 'paused' && <TelemetryBadge tone="tertiary">Paused</TelemetryBadge>}
            </span>
            <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>
              {cr.completedAt
                ? `Completed ${new Date(cr.completedAt).toLocaleString()}`
                : cr.startedAt
                  ? `Started ${new Date(cr.startedAt).toLocaleString()}`
                  : null}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
