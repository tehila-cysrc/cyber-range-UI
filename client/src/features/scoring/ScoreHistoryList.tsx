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
  documentationExcerpt: string | null;
  cyberRangeName: string | null;
  source?: 'manual' | 'ttp';
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
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
        Progress
      </h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
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
          <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>
            No points awarded yet. The instructor scores your timeline entries — clear, evidence-backed
            findings are what earn points.
          </div>
        )}
        {data?.entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 'var(--space-md)',
              padding: 'var(--space-sm) var(--space-md)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-control)',
              background: 'var(--surface-1)',
              fontSize: 15,
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {entry.studentName && <Avatar name={entry.studentName} size={20} />}
                {entry.studentName ?? 'Whole team'}
                {entry.isGamified ? <TelemetryBadge tone="tertiary">Gamified</TelemetryBadge> : null}
                {entry.source === 'ttp' ? <TelemetryBadge tone="secondary">ATT&amp;CK</TelemetryBadge> : null}
                <span className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
                  {new Date(entry.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {entry.cyberRangeName ? ` · ${entry.cyberRangeName}` : ''}
                </span>
              </span>
              {entry.note && <span className="prose-pre" style={{ fontSize: 14, color: 'var(--text-muted)' }}>{entry.note}</span>}
              {entry.documentationExcerpt && (
                <span className="prose-pre" style={{ fontSize: 13, color: 'var(--text-telemetry)', borderLeft: '2px solid var(--surface-border-strong)', paddingLeft: 8 }}>
                  For entry: “{entry.documentationExcerpt}”
                </span>
              )}
            </span>
            <span className="tabular" style={{ color: entry.points < 0 ? 'var(--signal-alert)' : 'var(--signal-primary)', flexShrink: 0 }}>
              {entry.points > 0 ? `+${entry.points}` : entry.points}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
