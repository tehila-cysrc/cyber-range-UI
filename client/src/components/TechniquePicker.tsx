import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { searchTechniques, tacticNames, techniqueDisplayName, useMitreCatalog, type IndexedCatalog } from '../lib/mitre';

// A MITRE ATT&CK technique: "T1087.001 · Account Discovery: Local Account". credited = this team was
// awarded points for it (live feedback) — anything else stays neutral, never "wrong": an uncredited
// tag may just be a technique this scenario doesn't score.
export function TtpChip({
  techniqueId,
  catalog,
  credited,
  onRemove,
}: {
  techniqueId: string;
  catalog: IndexedCatalog | undefined;
  credited?: boolean;
  onRemove?: () => void;
}) {
  const color = credited ? 'var(--signal-primary)' : 'var(--signal-secondary)';
  return (
    <span
      title={credited ? 'Credited ATT&CK detection' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: '100%',
        fontSize: 13,
        padding: '2px 6px',
        borderRadius: 'var(--radius-control)',
        border: `1px solid ${credited ? color : 'var(--surface-border-strong)'}`,
        background: 'rgba(15, 23, 42, 0.8)',
        color: 'var(--text-primary)',
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', color, letterSpacing: '0.04em', flexShrink: 0 }}>
        {credited ? '✓ ' : ''}
        {techniqueId}
      </span>
      <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {techniqueDisplayName(catalog, techniqueId)}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${techniqueId}`}
          style={{ background: 'none', border: 'none', color: 'var(--text-telemetry)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
        >
          ×
        </button>
      )}
    </span>
  );
}

// Search-as-you-type picker over the FULL public ATT&CK catalog (by id or name) — students choose
// from evidence, never from a list of the scenario's answers. Selected techniques render as removable
// chips; `max` caps how many (1 = single-select, e.g. the instructor's add row).
export function TechniquePicker({
  value,
  onChange,
  max = 3,
  disabled,
  placeholder = 'Search ATT&CK by ID or name (e.g. T1087, credential dumping)',
  label = 'MITRE ATT&CK technique',
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
}) {
  const { data: catalog, isLoading } = useMitreCatalog();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();

  const results = useMemo(
    () => (catalog ? searchTechniques(catalog, query).filter((t) => !value.includes(t.id)) : []),
    [catalog, query, value],
  );
  const full = value.length >= max;

  function pick(id: string) {
    onChange(max === 1 ? [id] : [...value, id].slice(0, max));
    setQuery('');
    setHighlight(0);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      // With a search typed, Enter belongs to the picker — never to the surrounding form. Letting it
      // through submitted the whole timeline entry without the technique and threw the search away.
      if (!query.trim()) return;
      e.preventDefault();
      const match = results[highlight] ?? results[0];
      if (match) pick(match.id);
      else setOpen(true);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {value.map((id) => (
            <TtpChip
              key={id}
              techniqueId={id}
              catalog={catalog}
              onRemove={disabled ? undefined : () => onChange(value.filter((v) => v !== id))}
            />
          ))}
        </div>
      )}
      {!full && (
        <div style={{ position: 'relative' }}>
          <input
            role="combobox"
            aria-label={label}
            aria-expanded={open && results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            value={query}
            disabled={disabled || isLoading}
            placeholder={isLoading ? 'Loading ATT&CK catalog…' : placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            // Delay so a click on an option lands before the list unmounts.
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-control)',
              padding: 8,
              color: 'var(--text-primary)',
            }}
          />
          {open && results.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              style={{
                position: 'absolute',
                zIndex: 20,
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                maxHeight: 280,
                overflowY: 'auto',
                margin: 0,
                padding: 4,
                listStyle: 'none',
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border-strong)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              {results.map((t, i) => (
                <li
                  key={t.id}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(t.id);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    padding: '6px 8px',
                    paddingLeft: t.parentId ? 20 : 8,
                    borderRadius: 'var(--radius-control)',
                    cursor: 'pointer',
                    background: i === highlight ? 'var(--surface-2)' : 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--signal-secondary)', marginRight: 8 }}>{t.id}</span>
                    {techniqueDisplayName(catalog, t.id)}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-telemetry)',
                    }}
                  >
                    {tacticNames(catalog, t)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
