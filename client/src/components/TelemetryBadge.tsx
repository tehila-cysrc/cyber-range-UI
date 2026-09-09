import type { ReactNode } from 'react';

type Tone = 'primary' | 'secondary' | 'tertiary' | 'alert' | 'muted';

const toneColor: Record<Tone, string> = {
  primary: 'var(--signal-primary)',
  secondary: 'var(--signal-secondary)',
  tertiary: 'var(--signal-tertiary)',
  alert: 'var(--signal-alert)',
  muted: 'var(--text-telemetry)',
};

export function TelemetryBadge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  const color = toneColor[tone];
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        padding: '2px 6px',
        borderRadius: 'var(--radius-control)',
        border: `1px solid ${color}`,
        color,
        background: 'rgba(15, 23, 42, 0.8)',
      }}
    >
      {children}
    </span>
  );
}
