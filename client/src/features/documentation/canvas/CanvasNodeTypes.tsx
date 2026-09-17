import { useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { FlagIcon } from '../../../components/icons';
import { CANVAS_NODE_SPEC_BY_TYPE, type CanvasNodeTypeKey } from './canvasNodeSpec';

export interface CanvasNodeFlowData {
  label: string;
  nodeType: CanvasNodeTypeKey;
  editable: boolean;
  onLabelChange: (flowNodeId: string, nextLabel: string) => void;
}

const SHAPE_SIZE = {
  rect: { width: 150, height: 56 },
  circle: { width: 84, height: 84 },
  diamond: { width: 100, height: 100 },
} as const;

const handleStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  background: 'var(--text-telemetry)',
  border: '1px solid var(--surface-floor)',
};

// The one shared component behind all seven `nodeTypes` entries — shape/color/fill come from
// canvasNodeSpec.ts, keyed by `data.nodeType`, so adding an eighth palette entry later needs no new
// component. Double-click swaps the label for an inline textarea (blur/Enter commits, Escape
// cancels) rather than routing every edit through a side panel — this is the first custom `nodeTypes`
// usage in the codebase (Topology's uniform card style didn't need shape variety or inline editing).
function ShapeNode({ id, data, selected }: NodeProps<CanvasNodeFlowData>) {
  const spec = CANVAS_NODE_SPEC_BY_TYPE[data.nodeType];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);

  useEffect(() => {
    if (!editing) setDraft(data.label);
  }, [data.label, editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== data.label) {
      data.onLabelChange(id, trimmed);
    } else {
      setDraft(data.label);
    }
  }

  const size = SHAPE_SIZE[spec.shape];
  const isDiamond = spec.shape === 'diamond';
  const isCircle = spec.shape === 'circle';

  const shapeStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    border: `1.5px solid ${spec.colorVar}`,
    background: spec.filled ? spec.colorVar : 'var(--surface-1)',
    borderRadius: isCircle ? '50%' : isDiamond ? 0 : 'var(--radius-control)',
    transform: isDiamond ? 'rotate(45deg)' : undefined,
    boxShadow: selected ? `0 0 0 2px ${spec.colorVar}` : undefined,
  };

  return (
    <div
      onDoubleClick={() => data.editable && setEditing(true)}
      style={{ position: 'relative', width: size.width, height: size.height, cursor: data.editable ? 'grab' : 'default' }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div style={shapeStyle} />
      <div
        style={{
          position: 'absolute',
          inset: isDiamond ? '20%' : '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          textAlign: 'center',
          color: spec.filled ? 'var(--surface-floor)' : 'var(--text-primary)',
          fontSize: 12,
          fontFamily: 'var(--font-sans)',
          lineHeight: 1.25,
          overflow: 'hidden',
        }}
      >
        {spec.filled && !editing && <FlagIcon width={11} height={11} style={{ flexShrink: 0 }} />}
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(data.label);
                setEditing(false);
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
              }
            }}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              color: 'inherit',
              font: 'inherit',
              textAlign: 'center',
              width: '100%',
              height: '100%',
            }}
          />
        ) : (
          <span style={{ wordBreak: 'break-word' }}>{data.label}</span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
}

export const canvasNodeTypes: Record<CanvasNodeTypeKey, typeof ShapeNode> = {
  entry: ShapeNode,
  system: ShapeNode,
  evidence: ShapeNode,
  finding: ShapeNode,
  decision: ShapeNode,
  action: ShapeNode,
  impact: ShapeNode,
};
