import { useEffect, useRef, useState } from 'react';

export interface MoreMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

// Small "⋯" dropdown for rare or destructive actions, so they're never one stray click away.
export function MoreMenu({ items, label }: { items: MoreMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          background: 'none',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-control)',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 18,
          lineHeight: 1,
          padding: '2px 8px',
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            insetInlineEnd: 0,
            top: '100%',
            zIndex: 20,
            minWidth: 190,
            marginTop: 4,
            padding: 4,
            background: 'var(--surface-2)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'start',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-control)',
                padding: '8px 10px',
                fontSize: 14,
                cursor: 'pointer',
                color: item.danger ? 'var(--signal-alert)' : 'var(--text-primary)',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
