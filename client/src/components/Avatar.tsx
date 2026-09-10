const ACCENT_COUNT = 8;

// Deterministic — the same person always gets the same color, across every screen that renders
// them, without a stored preference. Plain char-code sum is enough entropy for a handful of
// teammates; this is a visual identity cue, not a security-sensitive hash.
function accentIndex(seed: string): number {
  let sum = 0;
  for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
  return sum % ACCENT_COUNT;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const color = `var(--user-accent-${accentIndex(name) + 1})`;
  return (
    <span
      title={name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '50%',
        border: `1px solid ${color}`,
        background: 'rgba(15, 23, 42, 0.8)',
        color,
        fontFamily: 'var(--font-mono)',
        fontSize: Math.round(size * 0.38),
        fontWeight: 500,
        letterSpacing: '0.02em',
      }}
    >
      {initials(name)}
    </span>
  );
}
