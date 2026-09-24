import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Avatar } from '../../components/Avatar';
import { FlagIcon } from '../../components/icons';
import { useDebriefTeam } from './useDebriefTeam';
import { TtpDebriefSection } from './TtpDebriefSection';

interface DocEntry {
  id: number;
  body: string;
  imageDataUrl: string | null;
  isImportantFinding: number;
  afterTimeLimit?: number;
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

  const { query, ready } = useDebriefTeam();
  const { data, isError } = useQuery({
    queryKey: ['history', cyberRangeId, query],
    queryFn: () => apiFetch<SummaryResponse>(`/history/${cyberRangeId}${query}`),
    enabled: ready,
  });

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <Link to={`/debrief${query}`} style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
        ← Back to debrief
      </Link>
      {isError && <div style={{ marginTop: 'var(--space-md)', color: 'var(--text-muted)' }}>Couldn't load this debrief — try refreshing.</div>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 'var(--space-md)' }}>
            <TelemetryBadge tone="secondary">{data.cyberRange.dayLabel}</TelemetryBadge>
            <TelemetryBadge tone={data.cyberRange.difficulty === 'advanced' ? 'alert' : 'tertiary'}>
              {data.cyberRange.difficulty}
            </TelemetryBadge>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--text-primary)', margin: '8px 0' }}>
            {data.cyberRange.name}
          </h1>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-md)',
              padding: 'var(--space-sm) var(--space-md)',
              borderRadius: 'var(--radius-container)',
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              marginBottom: 'var(--space-xl)',
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Mission Debrief
            </span>
            <span className="tabular" style={{ fontSize: 16, fontWeight: 600, color: 'var(--signal-primary)' }}>
              Team score: {data.scoreTotal}
            </span>
          </div>

          <TtpDebriefSection cyberRangeId={data.cyberRange.id} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--signal-primary)',
              }}
            >
              Documentation Timeline
            </span>
            <span style={{ flex: 1, height: 1, background: 'var(--surface-border)' }} />
          </div>

          {data.documentation.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>No documentation was recorded.</div>
          )}

          {data.documentation.length > 0 && (
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', paddingLeft: 'var(--space-lg)' }}>
              <span
                style={{
                  position: 'absolute',
                  left: 5,
                  top: 6,
                  bottom: 6,
                  width: 1,
                  background: 'var(--surface-border)',
                }}
              />
              {data.documentation.map((entry) => (
                <div key={entry.id} style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: -20,
                      top: 4,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'var(--surface-floor)',
                      border: `2px solid ${entry.isImportantFinding ? 'var(--signal-primary)' : 'var(--surface-border-strong)'}`,
                    }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Avatar name={entry.authorName} size={20} />
                      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{entry.authorName}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-telemetry)' }}>
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {entry.afterTimeLimit ? (
            <span title="Added after the scenario's time limit ran out">
              <TelemetryBadge tone="tertiary">After time</TelemetryBadge>
            </span>
          ) : null}
          {entry.isImportantFinding ? (
                        <TelemetryBadge tone="primary">
                          <FlagIcon style={{ marginRight: 3, verticalAlign: '-2px' }} />
                          Finding
                        </TelemetryBadge>
                      ) : null}
                      {entry.categoryLabel ? <TelemetryBadge>{entry.categoryLabel}</TelemetryBadge> : null}
                    </div>
                  </div>
                  <div className="prose-pre" style={{ fontSize: 15, color: 'var(--text-primary)', marginTop: 'var(--space-xs)' }}>{entry.body}</div>
                  {entry.imageDataUrl && (
                    <img
                      src={entry.imageDataUrl}
                      alt="Attached evidence"
                      style={{
                        marginTop: 'var(--space-sm)',
                        maxWidth: '100%',
                        maxHeight: 320,
                        borderRadius: 'var(--radius-control)',
                        border: '1px solid var(--surface-border)',
                        display: 'block',
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
