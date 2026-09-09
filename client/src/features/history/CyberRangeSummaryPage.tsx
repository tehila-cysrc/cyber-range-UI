import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';

interface DocEntry {
  id: number;
  body: string;
  isImportantFinding: number;
  createdAt: string;
  authorName: string;
  categoryLabel: string | null;
}

interface SummaryResponse {
  cyberRange: { id: number; name: string; difficulty: string; dayLabel: string };
  documentation: DocEntry[];
  scoreTotal: number;
}

export function CyberRangeSummaryPage() {
  const { cyberRangeId } = useParams();

  const { data } = useQuery({
    queryKey: ['history', cyberRangeId],
    queryFn: () => apiFetch<SummaryResponse>(`/history/${cyberRangeId}`),
  });

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <Link to="/debrief" style={{ fontSize: 12, color: 'var(--signal-secondary)' }}>
        ← Back to history
      </Link>

      {data && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 'var(--space-md)' }}>
            <TelemetryBadge tone="secondary">{data.cyberRange.dayLabel}</TelemetryBadge>
            <TelemetryBadge tone={data.cyberRange.difficulty === 'advanced' ? 'alert' : 'tertiary'}>
              {data.cyberRange.difficulty}
            </TelemetryBadge>
          </div>
          <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '8px 0' }}>
            {data.cyberRange.name}
          </h1>
          <div className="tabular" style={{ fontSize: 14, color: 'var(--signal-primary)', marginBottom: 'var(--space-lg)' }}>
            Team score: {data.scoreTotal}
          </div>

          <h2 style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 var(--space-sm)' }}>
            Documentation
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {data.documentation.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No documentation was recorded.</div>
            )}
            {data.documentation.map((entry) => (
              <div
                key={entry.id}
                style={{
                  padding: 'var(--space-sm) var(--space-md)',
                  border: '1px solid var(--surface-border)',
                  borderLeft: entry.isImportantFinding
                    ? '3px solid var(--signal-primary)'
                    : '1px solid var(--surface-border)',
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--surface-1)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-telemetry)', fontFamily: 'var(--font-mono)' }}>
                  {entry.authorName} · {new Date(entry.createdAt).toLocaleString()}
                  {entry.categoryLabel ? ` · ${entry.categoryLabel}` : ''}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{entry.body}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
