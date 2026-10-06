import { useState, type ReactNode } from 'react';

export interface SideNavBadge {
  count: number;
  tone: 'alert' | 'warn';
  title: string;
}

export interface SideNavItem {
  key: string;
  label: string;
  meta?: string;
  metaTitle?: string;
  // Small green dot before the label (e.g. "join code open").
  dot?: { title: string };
  badges?: SideNavBadge[];
  muted?: boolean;
}

export interface SideNavGroup {
  // A labelled group gets a small header; an unlabelled one after the first is set off by a divider.
  label?: string;
  items: SideNavItem[];
}

interface Props {
  title: string;
  groups: SideNavGroup[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  // Optional "+" next to the title: either reveals an inline form (renderAdd) or runs onAdd.
  addLabel?: string;
  renderAdd?: (close: () => void) => ReactNode;
  onAdd?: () => void;
  // Shows a filter box over the list once there are more than this many items.
  filterThreshold?: number;
  emptyText?: string;
}

const BADGE_COLORS: Record<SideNavBadge['tone'], string> = {
  alert: 'var(--signal-alert)',
  warn: 'var(--signal-tertiary)',
};

// Left-hand navigation for pages whose main area shows one selected item out of many (Roster,
// Instructor dashboard, Scenarios, Topology Admin). Must sit inside a `.side-layout` container: below
// 900px the list collapses into a single <select> picker (index.css) — the title and "+" stay visible.
export function SideNav({ title, groups, activeKey, onSelect, addLabel, renderAdd, onAdd, filterThreshold, emptyText }: Props) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const allItems = groups.flatMap((g) => g.items);
  const showFilter = filterThreshold !== undefined && allItems.length > filterThreshold;
  const q = filter.trim().toLowerCase();
  const visibleGroups = groups
    .map((g) => ({ ...g, items: q ? g.items.filter((i) => i.label.toLowerCase().includes(q)) : g.items }))
    .filter((g) => g.items.length > 0);

  return (
    <nav aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-telemetry)' }}>{title}</span>
        {(renderAdd || onAdd) && (
          <button
            type="button"
            onClick={() => (onAdd ? onAdd() : setAdding((v) => !v))}
            aria-label={addLabel}
            title={addLabel}
            style={{ background: 'none', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-control)', color: 'var(--text-primary)', cursor: 'pointer', width: 26, height: 26, fontSize: 16, lineHeight: 1 }}
          >
            +
          </button>
        )}
      </div>
      {adding && renderAdd?.(() => setAdding(false))}

      <select
        className="side-picker"
        aria-label={title}
        value={activeKey ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        style={{
          width: '100%',
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-control)',
          padding: 8,
          color: 'var(--text-primary)',
        }}
      >
        {activeKey === null && <option value="">Select…</option>}
        {groups.map((g, i) =>
          g.label ? (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((item) => <PickerOption key={item.key} item={item} />)}
            </optgroup>
          ) : (
            g.items.map((item) => <PickerOption key={`${i}-${item.key}`} item={item} />)
          ),
        )}
      </select>

      <div className="side-list" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {showFilter && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            aria-label={`Filter ${title.toLowerCase()}`}
            style={{
              marginBottom: 6,
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-control)',
              padding: 6,
              color: 'var(--text-primary)',
            }}
          />
        )}
        {allItems.length === 0 && emptyText && (
          <div style={{ fontSize: 13, color: 'var(--text-telemetry)', padding: '2px 0 6px' }}>{emptyText}</div>
        )}
        {q && visibleGroups.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-telemetry)', padding: '2px 0 6px' }}>No match.</div>
        )}
        {visibleGroups.map((g, i) => (
          <div key={g.label ?? `group-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {g.label ? (
              <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-telemetry)', padding: i === 0 ? '0 10px 2px' : '10px 10px 2px' }}>
                {g.label}
              </div>
            ) : (
              i > 0 && <div style={{ borderTop: '1px solid var(--surface-border)', margin: '8px 0' }} />
            )}
            {g.items.map((item) => (
              <SideNavButton key={item.key} item={item} active={item.key === activeKey} onClick={() => onSelect(item.key)} />
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

function PickerOption({ item }: { item: SideNavItem }) {
  const extra = (item.badges ?? []).filter((b) => b.count > 0).map((b) => `${b.count} ${b.title}`);
  return (
    <option value={item.key}>
      {item.label}
      {item.meta ? ` (${item.meta})` : ''}
      {extra.length ? ` · ${extra.join(' · ')}` : ''}
    </option>
  );
}

function SideNavButton({ item, active, onClick }: { item: SideNavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'start',
        padding: '7px 10px',
        borderRadius: 'var(--radius-control)',
        border: 'none',
        borderInlineStart: `2px solid ${active ? 'var(--signal-primary)' : 'transparent'}`,
        background: active ? 'var(--surface-2)' : 'transparent',
        color: item.muted ? 'var(--text-muted)' : 'var(--text-primary)',
        fontStyle: item.muted ? 'italic' : 'normal',
        cursor: 'pointer',
        fontSize: 14,
      }}
    >
      <span
        aria-label={item.dot?.title}
        title={item.dot?.title}
        style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: item.dot ? 'var(--signal-primary)' : 'transparent' }}
      />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <bdi>{item.label}</bdi>
      </span>
      {(item.badges ?? [])
        .filter((b) => b.count > 0)
        .map((b) => (
          <span
            key={b.title}
            title={`${b.count} ${b.title}`}
            className="tabular"
            style={{ fontSize: 11, fontWeight: 600, lineHeight: '16px', minWidth: 16, padding: '0 5px', borderRadius: 8, textAlign: 'center', color: 'var(--surface-floor)', background: BADGE_COLORS[b.tone], flexShrink: 0 }}
          >
            {b.count}
          </span>
        ))}
      {item.meta && (
        <span className="tabular" title={item.metaTitle} style={{ fontSize: 12, color: 'var(--text-telemetry)', flexShrink: 0 }}>
          {item.meta}
        </span>
      )}
    </button>
  );
}
