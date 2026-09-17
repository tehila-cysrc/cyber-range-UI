import { Button } from '../../../components/Button';
import { CANVAS_NODE_SPEC_BY_TYPE } from './canvasNodeSpec';
import type { CanvasNodeDataDTO } from './InvestigationCanvas';

interface CanvasNodeInspectorProps {
  node: CanvasNodeDataDTO;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

// A small floating panel on single-click-select, not a full side panel — duplicate/delete/type live
// here rather than as always-visible on-canvas buttons, keeping the canvas itself uncluttered. No
// confirm dialog on delete (unlike Topology admin's destructive-action convention): Canvas nodes are
// cheap, frequent narrative scratch objects, not infrastructure state, so a confirm would be friction.
export function CanvasNodeInspector({ node, onDuplicate, onDelete, onClose }: CanvasNodeInspectorProps) {
  const spec = CANVAS_NODE_SPEC_BY_TYPE[node.nodeType];
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        width: 220,
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
