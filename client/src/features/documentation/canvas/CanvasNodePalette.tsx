import { CANVAS_NODE_SPECS } from './canvasNodeSpec';

// Drag source for the standard React Flow v11 palette recipe: a chip sets a custom MIME type on
// dataTransfer, InvestigationCanvas.tsx's onDrop reads it back and converts the drop point to flow
// coordinates via screenToFlowPosition(). Native HTML5 drag events — no dnd library needed.
export const CANVAS_DRAG_MIME = 'application/investigation-canvas-node';

function PaletteChip({ type, label, colorVar, shape, filled, description }: (typeof CANVAS_NODE_SPECS)[number]) {
  return (
    <div
      draggable
      title={description}
      onDragStart={(e) => {
        e.dataTransfer.setData(CANVAS_DRAG_MIME, type);
        e.dataTransfer.effectAllowed = 'move';
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: `1px solid ${colorVar}`,
        borderRadius: 'var(--radius-control)',
        padding: '6px 10px',
        cursor: 'grab',
        color: 'var(--text-primary)',
        fontSize: 13,
        background: 'var(--surface-1)',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          flexShrink: 0,
          background: filled ? colorVar : 'transparent',
          border: `1.5px solid ${colorVar}`,
          borderRadius: shape === 'circle' ? '50%' : shape === 'diamond' ? 0 : 3,
          transform: shape === 'diamond' ? 'rotate(45deg)' : undefined,
        }}
      />
      {label}
    </div>
  );
}

export function CanvasNodePalette() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 'var(--space-sm)',
        borderRight: '1px solid var(--surface-border)',
        minWidth: 168,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-telemetry)',
          marginBottom: 2,
        }}
      >
        Drag onto canvas
      </div>
      {CANVAS_NODE_SPECS.map((spec) => (
        <PaletteChip key={spec.type} {...spec} />
      ))}
    </div>
  );
}
