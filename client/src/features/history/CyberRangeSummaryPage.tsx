import { lazy, Suspense, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Avatar } from '../../components/Avatar';
import { FlagIcon } from '../../components/icons';
import { useDebriefTeam } from './useDebriefTeam';
import { TtpDebriefSection } from './TtpDebriefSection';
import { useAuthStore } from '../../stores/authStore';
import { EntryFeedbackList, type EntryFeedbackItem } from '../documentation/EntryFeedback';

// Same code-split as the Investigation page — React Flow only loads when a debrief is opened.
const InvestigationCanvasContainer = lazy(() =>
  import('../documentation/canvas/InvestigationCanvasContainer').then((m) => ({ default: m.InvestigationCanvasContainer })),
);

interface DocEntry {
  id: number;
  body: string;
  imageDataUrl: string | null;
  isImportantFinding: number;
  afterTimeLimit?: number;
  createdAt: string;
  authorName: string;
  authorAvatar?: string | null;
  categoryLabel: string | null;
  feedback?: EntryFeedbackItem[];
}

interface ScoreRow {
  id: number;
  points: number;
  note: string | null;
  source: 'manual' | 'ttp';
  createdAt: string;
  studentName: string | null;
  studentAvatar?: string | null;
}

interface HelpRow {
  id: number;
  status: 'open' | 'resolved';
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
  autoClosed: number;
  requestedByName: string;
  requestedByAvatar?: string | null;
}

interface SummaryResponse {
  cyberRange: { id: number; name: string; difficulty: string; dayLabel: string };
  progress: { status: 'not_started' | 'active' | 'paused' | 'completed'; startedAt: string | null; completedAt: string | null };
  documentation: DocEntry[];
  scoreTotal: number;
  scores: ScoreRow[];
  helpRequests: HelpRow[];
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', margin: 'var(--space-xl) 0 var(--space-md)' }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--signal-primary)',
        }}
      >
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--surface-border)' }} />
    </div>
  );
}

const rowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-sm)',
  padding: 'var(--space-sm) var(--space-md)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  background: 'var(--surface-1)',
  fontSize: 14,
} as const;

// `cyberRangeIdOverride`: the Team Workspace's Debrief tab renders this page without a route param.
export function CyberRangeSummaryPage({ cyberRangeIdOverride }: { cyberRangeIdOverride?: number } = {}) {
  const params = useParams();
  const cyberRangeId = cyberRangeIdOverride ?? params.cyberRangeId;

  const { query, ready, links, isInstructor, teamId } = useDebriefTeam();
  const ownTeamId = useAuthStore((s) => s.user?.teamId);
  const { data, isError } = useQuery({
    queryKey: ['history', cyberRangeId, query],
    queryFn: () => apiFetch<SummaryResponse>(`/history/${cyberRangeId}${query}`),
    enabled: ready,
  });

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <Link to={links.home} style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
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
          {data.progress.status !== 'completed' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 'var(--space-md)', fontSize: 14, color: 'var(--text-muted)' }}>
              <TelemetryBadge tone="tertiary">{data.progress.status === 'paused' ? 'Paused' : 'In progress'}</TelemetryBadge>
              {data.progress.status === 'paused'
                ? 'Not completed — the team was switched to another scenario. Everything recorded so far is below.'
                : 'This scenario is still running.'}
            </div>
          )}

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
                      <Avatar name={entry.authorName} avatar={entry.authorAvatar} size={20} />
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
                  <EntryFeedbackList feedback={entry.feedback ?? []} />
                </div>
              ))}
            </div>
          )}

          <SectionHeader>Investigation Canvas</SectionHeader>
          <Suspense fallback={<div style={{ color: 'var(--text-muted)' }}>Loading canvas…</div>}>
            <InvestigationCanvasContainer
              cyberRangeId={data.cyberRange.id}
              teamId={(isInstructor ? teamId : ownTeamId) ?? 0}
              teamIdParam={isInstructor ? teamId : null}
              editable={false}
              embedded
            />
          </Suspense>

          <SectionHeader>Scores awarded</SectionHeader>
          {data.scores.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>No points were awarded in this scenario.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              {data.scores.map((s) => (
                <div key={s.id} style={rowStyle}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span className="tabular" style={{ fontWeight: 600, color: s.points < 0 ? 'var(--signal-alert)' : 'var(--signal-primary)' }}>
                      {s.points > 0 ? `+${s.points}` : s.points}
                    </span>
                    {s.source === 'ttp' && <TelemetryBadge tone="secondary">ATT&amp;CK</TelemetryBadge>}
                    {s.studentName ? (
                      <>
                        <Avatar name={s.studentName} avatar={s.studentAvatar} size={18} />
                        <span style={{ color: 'var(--text-primary)' }}>{s.studentName}</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Team</span>
                    )}
                    {s.note && <span style={{ color: 'var(--text-muted)' }}>— {s.note}</span>}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-telemetry)' }}>
                    {new Date(s.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          <SectionHeader>Help requests</SectionHeader>
          {data.helpRequests.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>The team didn't ask for help in this scenario.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              {data.helpRequests.map((h) => (
                <div key={h.id} style={rowStyle}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <Avatar name={h.requestedByName} avatar={h.requestedByAvatar} size={18} />
                    <span style={{ color: 'var(--text-primary)' }}>{h.requestedByName}</span>
                    {h.message && <span style={{ color: 'var(--text-muted)' }}>— {h.message}</span>}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-telemetry)' }}>
                    {new Date(h.createdAt).toLocaleString()}
                    <TelemetryBadge tone={h.status === 'open' ? 'alert' : 'tertiary'}>
                      {h.status === 'open' ? 'Open' : h.autoClosed ? 'Closed (scenario ended)' : 'Resolved'}
                    </TelemetryBadge>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
