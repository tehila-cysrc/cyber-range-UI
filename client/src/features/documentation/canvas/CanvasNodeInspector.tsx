import { useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { CANVAS_NODE_SPEC_BY_TYPE } from './canvasNodeSpec';
import type { CanvasNodeDataDTO } from './InvestigationCanvas';

interface CanvasNodeInspectorProps {
  node: CanvasNodeDataDTO;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  onBodyChange: (body: string) => void;
}

// A small floating panel that opens the moment a shape is placed or clicked — duplicate/delete/type
// and a free-text notes field all live here rather than as always-visible on-canvas affordances,
// keeping the canvas itself uncluttered. No confirm dialog on delete (unlike Topology admin's
// destructive-action convention): Canvas nodes are cheap, frequent narrative scratch objects, not
// infrastructure state, so a confirm would be friction.
export function CanvasNodeInspector({ node, onDuplicate, onDelete, onClose, onBodyChange }: CanvasNodeInspectorProps) {
  const spec = CANVAS_NODE_SPEC_BY_TYPE[node.nodeType];
  const [bodyDraft, setBodyDraft] = useState(node.body ?? '');

  // Re-sync the draft when a different node is selected (or a teammate's realtime edit lands),
  // but never while this panel's own textarea is mid-edit — same "don't clobber what you're
  // typing" rule as the in-node label editor.
  useEffect(() => {
    setBodyDraft(node.body ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  function commitBody() {
    if (bodyDraft !== (node.body ?? '')) onBodyChange(bodyDraft);
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        width: 260,
        background: 'var(--surface-1)',
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-container)',
        padding: 'var(--space-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: spec.colorVar,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {spec.label}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>
          ×
        </button>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{node.label}</div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text-telemetry)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Notes / documentation
        </span>
        <textarea
          value={bodyDraft}
          onChange={(e) => setBodyDraft(e.target.value)}
          onBlur={commitBody}
          rows={4}
          placeholder="Write what you know about this…"
          style={{
            background: 'var(--surface-floor)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
            padding: 8,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            resize: 'vertical',
          }}
        />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="ghost" onClick={onDuplicate} style={{ flex: 1 }}>
          Duplicate
        </Button>
        <Button variant="destructive" onClick={onDelete} style={{ flex: 1 }}>
          Delete
        </Button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-telemetry)' }}>Select + Backspace/Delete also removes it.</div>
    </div>
  );
}
