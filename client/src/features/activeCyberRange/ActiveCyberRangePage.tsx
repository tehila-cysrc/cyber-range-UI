import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Button } from '../../components/Button';
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

interface CatalogCyberRange {
  id: number;
  name: string;
  difficulty: 'intermediate' | 'advanced';
  expectedDurationMinutes: number | null;
  dayKey: string;
  dayLabel: string;
}

function formatMinutes(minutes: number | null) {
  if (minutes == null) return 'Not yet configured';
  if (minutes >= 60) {
    const hrs = minutes / 60;
    return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)}h`;
  }
  return `${minutes}m`;
}

export function ActiveCyberRangePage() {
  const role = useAuthStore((s) => s.user?.role);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['active-cyber-range'],
    queryFn: () => apiFetch<{ active: ActiveCyberRange | null }>('/teams/me/active-cyber-range'),
  });

  const { data: catalogData } = useQuery({
    queryKey: ['cyber-ranges-catalog'],
    queryFn: () => apiFetch<{ cyberRanges: CatalogCyberRange[] }>('/cyber-ranges'),
    enabled: role === 'student',
  });

  const startMutation = useMutation({
    mutationFn: (cyberRangeId: number) =>
      apiFetch(`/teams/me/cyber-ranges/${cyberRangeId}/start`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['active-cyber-range'] }),
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

      {role === 'student' && catalogData && (
        <div style={{ marginTop: 'var(--space-xl)' }}>
          <h2 style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 var(--space-sm)' }}>
            {active ? 'Switch scenario' : 'Choose your scenario'}
          </h2>
          {startMutation.isError && (
            <div style={{ color: 'var(--signal-alert)', fontSize: 12, marginBottom: 'var(--space-sm)' }}>
              {startMutation.error instanceof ApiError ? startMutation.error.message : 'Failed to start'}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {catalogData.cyberRanges.map((range) => {
              const isCurrent = active?.cyberRangeId === range.id;
              return (
                <div
                  key={range.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--space-sm) var(--space-md)',
                    border: `1px solid ${isCurrent ? 'var(--signal-primary)' : 'var(--surface-border)'}`,
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--surface-1)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                    <TelemetryBadge tone="secondary">{range.dayLabel}</TelemetryBadge>
                    <TelemetryBadge tone={range.difficulty === 'advanced' ? 'alert' : 'tertiary'}>
                      {range.difficulty}
                    </TelemetryBadge>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{range.name}</span>
                  </div>
                  {isCurrent ? (
                    <TelemetryBadge tone="primary">Current</TelemetryBadge>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={startMutation.isPending}
                      onClick={() => startMutation.mutate(range.id)}
                    >
                      {active ? 'Switch to this' : 'Start'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
