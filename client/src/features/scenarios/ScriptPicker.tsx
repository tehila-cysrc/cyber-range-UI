import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';

export interface PickableScript {
  id: number;
  name: string;
  category?: string | null;
  scriptType?: string | null;
}

// Search-as-you-type trigger-script picker. A plain <select> of the whole library (60+ entries, no
// search, no grouping) was the slowest step of configuring a scenario (UX audit UX-19).
export function ScriptPicker({
  scripts,
  value,
  onChange,
  noneLabel,
  style,
}: {
  scripts: PickableScript[];
  value: number | null;
  onChange: (scriptId: number | null) => void;
  noneLabel: string;
  style?: CSSProperties;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const selected = scripts.find((s) => s.id === value) ?? null;

  // Flat list in display order (grouped by category), with the "none" choice first.
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = scripts
      .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.category ?? '~').localeCompare(b.category ?? '~') || a.name.localeCompare(b.name));
    return [{ id: null as number | null, name: noneLabel, category: null as string | null }, ...matches.map((s) => ({ id: s.id as number | null, name: s.name, category: s.category ?? null }))];
  }, [scripts, query, noneLabel]);

  function pick(id: number | null) {
    onChange(id);
    setQuery('');
    setOpen(false);
    setHighlight(0);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const option = options[highlight];
      if (option) pick(option.id);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        role="combobox"
        aria-label="Trigger script"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={open ? query : selected ? `Trigger: ${selected.name}` : ''}
        placeholder={open ? 'Search scripts by name or category…' : noneLabel}
        onFocus={() => {
          setOpen(true);
          setHighlight(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-control)',
          padding: 8,
          color: 'var(--text-primary)',
          fontSize: 13,
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 20,
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: 300,
            overflowY: 'auto',
            margin: 0,
            padding: 4,
            listStyle: 'none',
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border-strong)',
            borderRadius: 'var(--radius-control)',
          }}
        >
          {options.map((o, i) => {
            const showGroup = o.id != null && (i === 1 || options[i - 1].category !== o.category);
            return (
              <li key={o.id ?? 'none'} role="presentation">
                {showGroup && (
                  <div
                    style={{
                      padding: '6px 8px 2px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-telemetry)',
                    }}
                  >
                    {o.category ?? 'Uncategorized'}
                  </div>
                )}
                <div
                  role="option"
                  aria-selected={i === highlight}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o.id);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    padding: '5px 8px',
                    borderRadius: 'var(--radius-control)',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: o.id == null ? 'var(--text-muted)' : 'var(--text-primary)',
                    background: i === highlight ? 'var(--surface-2)' : o.id === value ? 'rgba(15, 23, 42, 0.8)' : 'transparent',
                  }}
                >
                  {o.name}
                  {o.id === value && ' ✓'}
                </div>
              </li>
            );
          })}
          {options.length === 1 && query && (
            <li role="presentation" style={{ padding: '6px 8px', fontSize: 13, color: 'var(--text-telemetry)' }}>
              No script matches “{query}”.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
