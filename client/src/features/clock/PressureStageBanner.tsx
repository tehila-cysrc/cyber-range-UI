const styleColors: Record<string, string> = {
  amber: 'var(--signal-tertiary)',
  crimson: 'var(--signal-alert)',
  red: 'var(--signal-alert)',
};

export function PressureStageBanner({ label, visualStyle }: { label: string; visualStyle: string }) {
  const color = styleColors[visualStyle] ?? 'var(--signal-tertiary)';
  return (
    <div
      style={{
        padding: '8px 12px',
        border: `1px solid ${color}`,
        borderRadius: 'var(--radius-control)',
        color,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      ⚠ {label}
    </div>
  );
}
