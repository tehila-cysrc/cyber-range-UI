import { useState } from 'react';
import { Avatar } from './Avatar';
import { AVATAR_STYLES, avatarUrl } from '../lib/avatars';

interface AvatarPickerProps {
  name: string; // drives the initials preview of the "Initials" choice
  value: string | null;
  onChange: (avatar: string | null) => void;
  // Creation forms start collapsed ("Choose a character — optional"); the profile dialog starts open.
  collapsible?: boolean;
}

const TILE = 36;

const tile = (selected: boolean): React.CSSProperties => ({
  padding: 2,
  border: 'none',
  borderRadius: '50%',
  background: 'transparent',
  boxShadow: selected ? '0 0 0 2px var(--signal-primary)' : 'none',
  cursor: 'pointer',
  lineHeight: 0,
});

const groupLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-telemetry)',
  margin: '0 0 4px 2px',
};

// Optional character for a user, grouped by art style. "Initials" keeps the default circle.
export function AvatarPicker({ name, value, onChange, collapsible = false }: AvatarPickerProps) {
  const [open, setOpen] = useState(!collapsible || value !== null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: 0,
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <Avatar name={name || '?'} size={24} />
        <span style={{ textDecoration: 'underline' }}>Choose a character</span>
        <span style={{ color: 'var(--text-telemetry)' }}>(optional)</span>
      </button>
    );
  }

  // CC BY 4.0 styles require attribution; listing every style's artist covers it.
  const credits = AVATAR_STYLES.map((s) => `${s.title} by ${s.creator} (${s.license})`).join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        role="radiogroup"
        aria-label="Avatar"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxHeight: 280,
          overflowY: 'auto',
          scrollbarColor: 'var(--surface-border-strong) transparent',
          padding: 8,
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-container)',
          background: 'var(--surface-floor)',
        }}
      >
        <div>
          <div style={groupLabel}>Default</div>
          <button type="button" role="radio" aria-checked={value === null} title="Initials" onClick={() => onChange(null)} style={tile(value === null)}>
            <Avatar name={name || '?'} size={TILE} />
          </button>
        </div>
        {AVATAR_STYLES.map((style) => (
          <div key={style.id}>
            <div style={groupLabel}>{style.label}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {style.keys.map((key, i) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={value === key}
                  title={`${style.label} ${i + 1}`}
                  onClick={() => onChange(key)}
                  style={tile(value === key)}
                >
                  <img src={avatarUrl(key)!} alt="" width={TILE} height={TILE} loading="lazy" style={{ display: 'block', borderRadius: '50%' }} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div title={credits} style={{ fontSize: 11, color: 'var(--text-telemetry)', lineHeight: 1.4 }}>
        Characters via <a href="https://www.dicebear.com" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>DiceBear</a>
        {' — '}
        <details style={{ display: 'inline' }}>
          <summary style={{ display: 'inline', cursor: 'pointer', textDecoration: 'underline' }}>credits</summary>
          <span style={{ display: 'block', marginTop: 4 }}>
            {AVATAR_STYLES.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ' · '}
                {s.title} by {s.creator} (
                {s.licenseUrl ? (
                  <a href={s.licenseUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{s.license}</a>
                ) : (
                  s.license
                )}
                )
              </span>
            ))}
          </span>
        </details>
      </div>
    </div>
  );
}
