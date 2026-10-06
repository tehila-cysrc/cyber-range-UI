import { useState } from 'react';
import { Avatar } from './Avatar';
import { AVATAR_KEYS, avatarUrl } from '../lib/avatars';

interface AvatarPickerProps {
  name: string; // drives the initials preview of the "None" choice
  value: string | null;
  onChange: (avatar: string | null) => void;
  // Creation forms start collapsed ("Choose a character — optional"); the profile dialog starts open.
  collapsible?: boolean;
}

const tile = (selected: boolean): React.CSSProperties => ({
  padding: 2,
  border: 'none',
  borderRadius: '50%',
  background: 'transparent',
  boxShadow: selected ? '0 0 0 2px var(--signal-primary)' : 'none',
  cursor: 'pointer',
  lineHeight: 0,
});

// Optional character for a user. "None" keeps the default initials circle.
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

  return (
    <div role="radiogroup" aria-label="Avatar" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 360 }}>
      <button type="button" role="radio" aria-checked={value === null} title="Initials (default)" onClick={() => onChange(null)} style={tile(value === null)}>
        <Avatar name={name || '?'} size={36} />
      </button>
      {AVATAR_KEYS.map((key) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} title={key} onClick={() => onChange(key)} style={tile(value === key)}>
          <img src={avatarUrl(key)!} alt="" width={36} height={36} style={{ display: 'block', borderRadius: '50%' }} />
        </button>
      ))}
    </div>
  );
}
