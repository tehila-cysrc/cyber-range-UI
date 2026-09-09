import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { TelemetryBadge } from '../../components/TelemetryBadge';

interface CompletedRange {
  cyberRangeId: number;
  name: string;
  difficulty: string;
  dayLabel: string;
  completedAt: string;
}

export function HistoryPage() {
  const { data } = useQuery({
    queryKey: ['history'],
    queryFn: () => apiFetch<{ completed: CompletedRange[] }>('/history'),
  });

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
          History
        </h1>
        <Link to="/debrief/event-summary" style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
          Event summary →
        </Link>
      </div>

      {data && data.completed.length === 0 && (
        <EmptyState message="No Cyber Ranges completed yet." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {data?.completed.map((cr) => (
          <Link
            key={cr.cyberRangeId}
            to={`/debrief/${cr.cyberRangeId}`}
            style={{
              display: 'flex',
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
