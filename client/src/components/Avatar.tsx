import { avatarUrl } from '../lib/avatars';

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
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase();
  return ([...words[0]][0] + [...words[1]][0]).toUpperCase();
}

// A user's optional preset character (users.avatar, see lib/avatars.ts), or by default a tinted
// initials circle in their accent color.
export function Avatar({ name, avatar, size = 28 }: { name: string; avatar?: string | null; size?: number }) {
  const url = avatarUrl(avatar);
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    minWidth: size,
    borderRadius: '50%',
    overflow: 'hidden',
    flexShrink: 0,
  };

  if (url) {
    return (
      <span title={name} style={{ ...base, boxShadow: '0 0 0 1px var(--surface-border-strong)' }}>
        <img src={url} alt="" width={size} height={size} style={{ display: 'block', width: '100%', height: '100%' }} />
      </span>
    );
  }

  const color = `var(--user-accent-${accentIndex(name) + 1})`;
  return (
    <span
      title={name}
      style={{
        ...base,
        background: `linear-gradient(135deg, color-mix(in srgb, ${color} 38%, var(--surface-2)), color-mix(in srgb, ${color} 14%, var(--surface-1)))`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 55%, transparent)`,
        color: `color-mix(in srgb, ${color} 55%, #ffffff)`,
        fontFamily: 'var(--font-sans)',
        fontSize: Math.max(9, Math.round(size * 0.4)),
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: '0.01em',
      }}
    >
      {initials(name)}
    </span>
  );
}
