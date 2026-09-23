import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { useDebriefTeam } from './useDebriefTeam';

interface CompletedRange {
  cyberRangeId: number;
  name: string;
  difficulty: string;
  dayLabel: string;
  completedAt: string;
}

export function HistoryPage() {
  const { query, ready, picker, isInstructor } = useDebriefTeam();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['history', query],
    queryFn: () => apiFetch<{ completed: CompletedRange[] }>(`/history${query}`),
    enabled: ready,
  });

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-md)' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>
          Debrief — completed scenarios
        </h1>
        <span style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
          {picker}
          {ready && (
            <Link to={`/debrief/event-summary${query}`} style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
              Event summary →
            </Link>
          )}
        </span>
      </div>

      {!ready && <EmptyState message="Pick a team above to review its completed scenarios." />}
      {ready && isLoading && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}
      {isError && <EmptyState message="Couldn't load the debrief — try refreshing." />}
      {data && data.completed.length === 0 && (
        <EmptyState
          message={
            isInstructor
              ? 'This team has no completed scenarios yet. Use "Mark scenario completed" on the Instructor dashboard when a team finishes.'
              : 'No scenarios completed yet — a scenario appears here once the instructor marks it complete.'
          }
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {data?.completed.map((cr) => (
          <Link
            key={cr.cyberRangeId}
            to={`/debrief/${cr.cyberRangeId}${query}`}
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
            </span>
            <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>
              {new Date(cr.completedAt).toLocaleString()}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
