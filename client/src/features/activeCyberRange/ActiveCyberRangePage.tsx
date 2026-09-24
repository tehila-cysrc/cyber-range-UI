import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Button } from '../../components/Button';
import { HelpRequestButton } from '../helpRequests/HelpRequestButton';
import { useAuthStore } from '../../stores/authStore';
import { useClockStore } from '../../stores/clockStore';
import { PressureStageBanner } from '../clock/PressureStageBanner';
import { formatRemaining, useActiveCyberRange } from '../clock/MissionClock';

function formatMinutes(minutes: number | null) {
  if (minutes == null) return 'Not yet configured';
  if (minutes >= 60) {
    const hrs = minutes / 60;
    return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)}h`;
  }
  return `${minutes}m`;
}

// Read-only for students by design: the instructor assigns/switches each team's current scenario
// (see InstructorDashboardPage) — a student only ever sees whatever was assigned to their team.
// The clock itself is kept in sync globally (useMissionClockSync in AppShell); this page only reads it.
export function ActiveCyberRangePage() {
  const role = useAuthStore((s) => s.user?.role);
  const { data, isLoading } = useActiveCyberRange();

  const liveRemaining = useClockStore((s) => s.remainingSeconds);
  const stageLabel = useClockStore((s) => s.stageLabel);
  const stageVisualStyle = useClockStore((s) => s.stageVisualStyle);
  const timeUp = useClockStore((s) => s.timeUp);

  // With nothing active, a finished scenario is the likely reason — point at its Debrief instead of
  // an unexplained "nothing is active".
  const { data: history } = useQuery({
    queryKey: ['history', ''],
    queryFn: () => apiFetch<{ completed: { cyberRangeId: number; name: string; completedAt: string }[] }>('/history'),
    enabled: !isLoading && !data?.active && role === 'student',
  });

  if (isLoading) {
    return <div style={{ padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>Loading…</div>;
  }

  const active = data?.active;
  const remainingSeconds = liveRemaining ?? active?.remainingSeconds ?? null;

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-telemetry)',
        }}
      >
        Active Cyber Range
      </div>

      {!active ? (
        <div
          style={{
            marginTop: 'var(--space-md)',
            padding: 'var(--space-lg)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            background: 'var(--surface-1)',
            color: 'var(--text-muted)',
          }}
        >
          {history && history.completed.length > 0 ? (
            <>
              <div style={{ color: 'var(--text-primary)', fontSize: 16, marginBottom: 6 }}>
                “{[...history.completed].sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0].name}” is complete.
              </div>
              Review your team's timeline and results in the{' '}
              <Link to="/debrief" style={{ color: 'var(--signal-secondary)' }}>
                Debrief
              </Link>
              . Your instructor will start the next scenario when it's time.
            </>
          ) : (
            <>No scenario is running for your team yet — your instructor will start one. This page updates automatically.</>
          )}
        </div>
      ) : (
        <div
          style={{
            marginTop: 'var(--space-lg)',
            padding: 'var(--space-xl)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            background: 'var(--surface-1)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-lg)',
            maxWidth: 720,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
              <TelemetryBadge tone="secondary">{active.day.label}</TelemetryBadge>
              <TelemetryBadge tone={active.difficulty === 'advanced' ? 'alert' : 'tertiary'}>
                {active.difficulty}
              </TelemetryBadge>
            </div>
            <h1
              style={{
                fontSize: 36,
                lineHeight: '42px',
                letterSpacing: '-0.02em',
                fontWeight: 600,
                margin: 0,
                color: 'var(--text-primary)',
              }}
            >
              {active.name}
            </h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>
              Expected time: {formatMinutes(active.expectedDurationMinutes)}
            </div>
          </div>

          {/* Instructor-written mission briefing (UX-08). */}
          {active.studentBriefing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-telemetry)' }}>
                Mission briefing
              </span>
              <div className="prose-pre" style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-primary)' }}>
                {active.studentBriefing}
              </div>
            </div>
          )}

          {remainingSeconds != null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-telemetry)',
                }}
              >
                Mission Window
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)' }}>
                <span
                  className="tabular"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 40,
                    lineHeight: '44px',
                    fontWeight: 500,
                    color: timeUp ? 'var(--signal-alert)' : 'var(--text-primary)',
                  }}
                >
                  {timeUp || remainingSeconds <= 0 ? "Time's up" : formatRemaining(remainingSeconds)}
                </span>
                {!timeUp && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--signal-secondary)',
                      fontWeight: 500,
                    }}
                  >
                    Remaining
                  </span>
                )}
              </div>
            </div>
          )}

          {remainingSeconds != null && (timeUp || remainingSeconds <= 0) && (
            <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              You can still add entries — they're marked as added after the time limit.
            </div>
          )}

          {stageLabel && stageVisualStyle && !timeUp && (
            <PressureStageBanner label={stageLabel} visualStyle={stageVisualStyle} />
          )}

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 'var(--space-lg)',
              marginTop: 'var(--space-xs)',
            }}
          >
            <Link to="/investigation" style={{ textDecoration: 'none' }}>
              <Button
                variant="primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)' }}
              >
                Enter Investigation Workspace
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Button>
            </Link>
            {role === 'student' && <HelpRequestButton />}
          </div>
        </div>
      )}
    </div>
  );
}
