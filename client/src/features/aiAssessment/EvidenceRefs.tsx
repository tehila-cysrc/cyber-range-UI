import { useState } from 'react';
import { formatEntryTime } from '../documentation/InvestigationPage';
import type { Evidence, EvidenceIndex, EvidenceRef } from './useAiAssessments';

// Evidence the AI cited, as chips. Record ids mean nothing to an instructor, so a chip shows the
// author and time (timeline) or the label (canvas); clicking it shows the excerpt the AI was given.
// Only ids the server validated against this team's own records ever reach this component.

const TYPE_LABEL: Record<Evidence['type'], string> = { timeline_entry: 'Entry', canvas_node: 'Canvas', canvas_edge: 'Link' };

function chipText(e: Evidence, ref: EvidenceRef | undefined) {
  if (!ref) return `${TYPE_LABEL[e.type]} #${e.id}`;
  if (e.type === 'timeline_entry') {
    return [ref.author, ref.createdAt ? formatEntryTime(ref.createdAt) : null].filter(Boolean).join(' · ') || `Entry #${e.id}`;
  }
  const label = ref.excerpt.split('\n')[0];
  return label.length > 32 ? `${label.slice(0, 32)}…` : label || `${TYPE_LABEL[e.type]} #${e.id}`;
}

export function EvidenceRefs({ evidence, index }: { evidence: Evidence[]; index: EvidenceIndex }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (evidence.length === 0) return null;
  const open = evidence.find((e) => `${e.type}:${e.id}` === openKey);
  const openRef = open ? index[open.type][String(open.id)] : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {evidence.map((e) => {
          const key = `${e.type}:${e.id}`;
          const ref = index[e.type][String(e.id)];
          return (
            <button
              key={key}
              type="button"
              aria-expanded={openKey === key}
              title={ref?.excerpt}
              onClick={() => setOpenKey(openKey === key ? null : key)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                padding: '1px 8px',
                borderRadius: 999,
                cursor: 'pointer',
                border: `1px solid ${openKey === key ? 'var(--signal-secondary)' : 'var(--surface-border)'}`,
                background: 'var(--surface-floor)',
                color: 'var(--signal-secondary)',
              }}
            >
              {TYPE_LABEL[e.type].toUpperCase()} · {chipText(e, ref)}
            </button>
          );
        })}
      </div>
      {open && (
        <div style={{ borderLeft: '2px solid var(--signal-secondary)', padding: '4px 10px', fontSize: 13, color: 'var(--text-muted)', background: 'var(--surface-floor)', borderRadius: 'var(--radius-control)' }}>
          {open.quote && <div style={{ color: 'var(--text-primary)', fontStyle: 'italic', marginBottom: 2 }}>“{open.quote}”</div>}
          <div className="prose-pre">{openRef?.excerpt ?? 'This record is no longer available.'}</div>
        </div>
      )}
    </div>
  );
}
