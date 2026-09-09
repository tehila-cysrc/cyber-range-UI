import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { HelpRequestButton } from '../helpRequests/HelpRequestButton';
import { useAuthStore } from '../../stores/authStore';
import { useClockStore } from '../../stores/clockStore';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { PressureStageBanner } from '../clock/PressureStageBanner';

interface ActiveCyberRange {
  progressId: number;
  cyberRangeId: number;
  name: string;
  difficulty: 'intermediate' | 'advanced';
  day: { key: string; label: string };
  expectedDurationMinutes: number | null;
  status: string;
  remainingSeconds: number | null;
}

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
export function ActiveCyberRangePage() {
  const role = useAuthStore((s) => s.user?.role);
  const { data, isLoading } = useQuery({
    queryKey: ['active-cyber-range'],
    queryFn: () => apiFetch<{ active: ActiveCyberRange | null }>('/teams/me/active-cyber-range'),
  });

  const liveRemaining = useClockStore((s) => s.remainingSeconds);
  const stageLabel = useClockStore((s) => s.stageLabel);
  const stageVisualStyle = useClockStore((s) => s.stageVisualStyle);
  const timeUp = useClockStore((s) => s.timeUp);
  const setTick = useClockStore((s) => s.setTick);
  const setStage = useClockStore((s) => s.setStage);
  const setTimeUp = useClockStore((s) => s.setTimeUp);

  // Server-authoritative countdown: the REST fetch above is only the initial snapshot; once
  // connected, clock:tick (emitted once/second by clock.service.ts) is the source of truth.
  useSocketEvent<{ remainingSeconds: number }>('clock:tick', ({ remainingSeconds }) => {
    setTick(remainingSeconds);
  });
  useSocketEvent<{ stageLabel: string; visualStyle: string }>('clock:pressure_stage', (payload) => {
    setStage(payload.stageLabel, payload.visualStyle);
  });
  useSocketEvent('clock:time_up', () => {
    setTimeUp();
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
          fontSize: 11,
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
          No Cyber Range is active for your team right now.
        </div>
      ) : (
        <div
          style={{
            marginTop: 'var(--space-md)',
            padding: 'var(--space-lg)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            background: 'var(--surface-1)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-sm)',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
            <TelemetryBadge tone="secondary">{active.day.label}</TelemetryBadge>
            <TelemetryBadge tone={active.difficulty === 'advanced' ? 'alert' : 'tertiary'}>
              {active.difficulty}
            </TelemetryBadge>
          </div>
          <h1 style={{ fontSize: 26, margin: 0, color: 'var(--text-primary)' }}>{active.name}</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Expected time: {formatMinutes(active.expectedDurationMinutes)}
          </div>
          {remainingSeconds != null && (
            <div
              className="tabular"
              style={{ fontSize: 20, color: timeUp ? 'var(--signal-alert)' : 'var(--signal-primary)' }}
            >
              {timeUp
                ? "Time's up"
                : `${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s remaining`}
            </div>
          )}
          {stageLabel && stageVisualStyle && !timeUp && (
            <PressureStageBanner label={stageLabel} visualStyle={stageVisualStyle} />
          )}
          {role === 'student' && (
            <div style={{ marginTop: 'var(--space-sm)' }}>
              <HelpRequestButton />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
