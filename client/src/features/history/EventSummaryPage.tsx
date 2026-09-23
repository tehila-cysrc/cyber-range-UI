import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { useDebriefTeam } from './useDebriefTeam';

interface DaySummary {
  dayKey: string;
  dayLabel: string;
  completedCount: number;
  totalPoints: number;
}

export function EventSummaryPage() {
  const { query, ready, picker } = useDebriefTeam();
  const { data, isError } = useQuery({
    queryKey: ['event-summary', query],
    queryFn: () => apiFetch<{ days: DaySummary[] }>(`/history/event-summary${query}`),
    enabled: ready,
  });

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link to={`/debrief${query}`} style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
          ← Back to debrief
        </Link>
        {picker}
      </div>

      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 'var(--space-md) 0' }}>
        Event Summary
      </h1>

      {!ready && <EmptyState message="Pick a team above to see its event summary." />}
      {isError && <EmptyState message="Couldn't load the event summary — try refreshing." />}
      {data && data.days.length === 0 && (
        <EmptyState message="No activity recorded yet across the AI/Azure/AWS days." />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
        {data?.days.map((day) => (
          <div
            key={day.dayKey}
            style={{
              padding: 'var(--space-lg)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-container)',
              background: 'var(--surface-1)',
              minWidth: 160,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-telemetry)', textTransform: 'uppercase' }}>
              {day.dayLabel}
            </div>
            <div className="tabular" style={{ fontSize: 24, color: 'var(--text-primary)', margin: '4px 0' }}>
              {day.completedCount}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Cyber Ranges completed</div>
            <div className="tabular" style={{ fontSize: 16, color: 'var(--signal-primary)', marginTop: 6 }}>
              {day.totalPoints} pts
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
