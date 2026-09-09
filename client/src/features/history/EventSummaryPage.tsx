import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';

interface DaySummary {
  dayKey: string;
  dayLabel: string;
  completedCount: number;
  totalPoints: number;
}

export function EventSummaryPage() {
  const { data } = useQuery({
    queryKey: ['event-summary'],
    queryFn: () => apiFetch<{ days: DaySummary[] }>('/history/event-summary'),
  });

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <Link to="/debrief" style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
        ← Back to history
      </Link>

      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 'var(--space-md) 0' }}>
        Event Summary
      </h1>

      {data && data.days.length === 0 && (
        <EmptyState message="No activity recorded yet across the AI/Azure/AWS days." />
      )}

      <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
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
