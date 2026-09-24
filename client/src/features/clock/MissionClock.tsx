import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { useClockStore } from '../../stores/clockStore';
import { useToastStore } from '../../stores/toastStore';
import { useSocketEvent } from '../../hooks/useSocketEvent';

export interface ActiveCyberRange {
  progressId: number;
  cyberRangeId: number;
  name: string;
  difficulty: 'intermediate' | 'advanced';
  day: { key: string; label: string };
  expectedDurationMinutes: number | null;
  studentBriefing: string | null;
  status: string;
  remainingSeconds: number | null;
}

export function useActiveCyberRange(enabled = true) {
  return useQuery({
    queryKey: ['active-cyber-range'],
    queryFn: () => apiFetch<{ active: ActiveCyberRange | null }>('/teams/me/active-cyber-range'),
    enabled,
  });
}

export function formatRemaining(seconds: number) {
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

const stageColors: Record<string, string> = {
  amber: 'var(--signal-tertiary)',
  crimson: 'var(--signal-alert)',
  red: 'var(--signal-alert)',
};

// Mounted once in AppShell for students. The clock socket events used to be subscribed only on Home,
// so the countdown and pressure stages froze the moment a student entered the workspace — where they
// actually spend the exercise. The header badge below now shows it on every page.
export function useMissionClockSync(enabled: boolean) {
  const setTick = useClockStore((s) => s.setTick);
  const setStage = useClockStore((s) => s.setStage);
  const setTimeUp = useClockStore((s) => s.setTimeUp);
  const push = useToastStore((s) => s.push);

  useSocketEvent<{ remainingSeconds: number }>('clock:tick', ({ remainingSeconds }) => {
    if (enabled) setTick(remainingSeconds);
  });
  useSocketEvent<{ stageLabel: string; visualStyle: string }>('clock:pressure_stage', ({ stageLabel, visualStyle }) => {
    if (!enabled) return;
    setStage(stageLabel, visualStyle);
    push(`⚠ ${stageLabel}`, 'info');
  });
  useSocketEvent('clock:time_up', () => {
    if (!enabled) return;
    setTimeUp();
    push("Time's up for this scenario. You can still add entries — they'll be marked as after the time limit.", 'error');
  });
}

export function MissionClockBadge() {
  const { data } = useActiveCyberRange();
  const liveRemaining = useClockStore((s) => s.remainingSeconds);
  const timeUp = useClockStore((s) => s.timeUp);
  const stageLabel = useClockStore((s) => s.stageLabel);
  const stageVisualStyle = useClockStore((s) => s.stageVisualStyle);

  const active = data?.active;
  const remaining = liveRemaining ?? active?.remainingSeconds ?? null;
  if (!active || remaining == null) return null;

  const expired = timeUp || remaining <= 0;
  const color = expired
    ? 'var(--signal-alert)'
    : stageVisualStyle
      ? (stageColors[stageVisualStyle] ?? 'var(--signal-tertiary)')
      : 'var(--text-primary)';

  return (
    <span
      className="tabular"
      role="timer"
      aria-live="off"
      title={`${active.name} — ${expired ? 'time is up' : 'time remaining'}${stageLabel && !expired ? ` · ${stageLabel}` : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 14,
        color,
        padding: '2px 8px',
        border: `1px solid ${expired || stageVisualStyle ? color : 'var(--surface-border)'}`,
        borderRadius: 'var(--radius-control)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-telemetry)' }}>
        Time
      </span>
      {expired ? "Time's up" : formatRemaining(remaining)}
    </span>
  );
}
