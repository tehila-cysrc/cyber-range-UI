import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Avatar } from '../../components/Avatar';
import { useSocketEvent } from '../../hooks/useSocketEvent';

interface ScoreEntry {
  id: number;
  points: number;
  isGamified: number;
  note: string | null;
  createdAt: string;
  studentUserId: number | null;
  studentName: string | null;
}

interface ScoresResponse {
  entries: ScoreEntry[];
  teamTotal: number;
  perStudent: { studentUserId: number; studentName: string; total: number }[];
}

// US-007: student-facing progress view — individual + team scoring, no milestones entity.
export function ScoreHistoryList() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['team-scores'],
    queryFn: () => apiFetch<ScoresResponse>('/teams/me/scores'),
  });

  useSocketEvent('score:awarded', () => {
    queryClient.invalidateQueries({ queryKey: ['team-scores'] });
  });

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
        Progress
      </h1>

      <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <div
          style={{
            padding: 'var(--space-md)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            background: 'var(--surface-1)',
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>Team total</div>
          <div className="tabular" style={{ fontSize: 24, color: 'var(--signal-primary)' }}>
            {data?.teamTotal ?? 0}
          </div>
        </div>
        {data?.perStudent.map((s) => (
          <div
            key={s.studentUserId}
            style={{
              padding: 'var(--space-md)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-container)',
              background: 'var(--surface-1)',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-telemetry)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Avatar name={s.studentName} size={18} />
              {s.studentName}
            </div>
            <div className="tabular" style={{ fontSize: 20, color: 'var(--text-primary)' }}>
              {s.total}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {data?.entries.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>No scoring yet.</div>
        )}
        {data?.entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: 'var(--space-sm) var(--space-md)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-control)',
              background: 'var(--surface-1)',
              fontSize: 15,
            }}
          >
            <span style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {entry.studentName && <Avatar name={entry.studentName} size={20} />}
              {entry.studentName ?? 'Team'} {entry.isGamified ? <TelemetryBadge tone="tertiary">Gamified</TelemetryBadge> : null}
            </span>
            <span className="tabular" style={{ color: 'var(--signal-primary)' }}>
              +{entry.points}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
