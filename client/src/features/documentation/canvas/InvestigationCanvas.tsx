import { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { canvasNodeTypes, type CanvasNodeFlowData } from './CanvasNodeTypes';
import { CanvasNodePalette, CANVAS_DRAG_MIME } from './CanvasNodePalette';
import { CanvasNodeInspector } from './CanvasNodeInspector';
import type { CanvasNodeTypeKey } from './canvasNodeSpec';

export interface CanvasNodeDataDTO {
  id: number;
  nodeType: CanvasNodeTypeKey;
  label: string;
  body: string | null;
  posX: number;
  posY: number;
}

export interface CanvasEdgeDataDTO {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  label?: string | null;
}

interface InvestigationCanvasProps {
  nodes: CanvasNodeDataDTO[];
  edges: CanvasEdgeDataDTO[];
  editable?: boolean;
  // Controlled selection (owned by the container, not this presentational component) so the
  // container can auto-open the inspector on a node *it* just created/duplicated — without also
  // stealing focus locally when a teammate creates one via realtime.
  selectedNodeId: number | null;
  onSelectionChange: (nodeId: number | null) => void;
  onNodeCreate?: (type: CanvasNodeTypeKey, x: number, y: number) => void;
  onNodeDragStop?: (nodeId: number, x: number, y: number) => void;
  onLabelChange?: (nodeId: number, label: string) => void;
  onBodyChange?: (nodeId: number, body: string) => void;
  onNodeDelete?: (nodeId: number) => void;
  onNodeDuplicate?: (node: CanvasNodeDataDTO) => void;
  onConnect?: (fromNodeId: number, toNodeId: number) => void;
  onEdgeDelete?: (edgeId: number) => void;
}

const FLOW_NODE_PREFIX = 'canvas-node:';
const FLOW_EDGE_PREFIX = 'canvas-edge:';
const flowNodeId = (id: number) => `${FLOW_NODE_PREFIX}${id}`;
const parseFlowNodeId = (flowId: string) => Number(flowId.slice(FLOW_NODE_PREFIX.length));

function CanvasInner({
  nodes,
  edges,
  editable = false,
  selectedNodeId,
  onSelectionChange,
  onNodeCreate,
  onNodeDragStop,
  onLabelChange,
  onBodyChange,
  onNodeDelete,
  onNodeDuplicate,
  onConnect,
  onEdgeDelete,
}: InvestigationCanvasProps) {
  const reactFlowInstance = useReactFlow();

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selectedNodeId != null ? (nodesById.get(selectedNodeId) ?? null) : null;

  const handleLabelChange = useCallback(
    (flowId: string, nextLabel: string) => onLabelChange?.(parseFlowNodeId(flowId), nextLabel),
    [onLabelChange],
  );

  const flowNodes: Node<CanvasNodeFlowData>[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: flowNodeId(n.id),
        type: n.nodeType,
        position: { x: n.posX, y: n.posY },
        data: { label: n.label, nodeType: n.nodeType, editable, onLabelChange: handleLabelChange },
      })),
    [nodes, editable, handleLabelChange],
  );

  const flowEdges: Edge[] = useMemo(() => {
    const ids = new Set(flowNodes.map((n) => n.id));
    return edges
      .filter((e) => ids.has(flowNodeId(e.fromNodeId)) && ids.has(flowNodeId(e.toNodeId)))
      .map((e) => ({
        id: `${FLOW_EDGE_PREFIX}${e.id}`,
        source: flowNodeId(e.fromNodeId),
        target: flowNodeId(e.toNodeId),
        label: e.label ?? undefined,
        style: { stroke: 'var(--text-telemetry)' },
        // Directional arrows, deliberately unlike Topology's undirected-looking lines — showing
        // direction is the whole point of a narrative diagram (Machine -> Process -> Evidence).
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--text-telemetry)' },
      }));
  }, [edges, flowNodes]);

  // React Flow only moves/selects nodes it holds in state: with controlled `nodes` and no
  // onNodesChange, a dragged node didn't follow the cursor, nothing could be selected, and
  // Delete/Backspace had nothing to delete (so edges were undeletable). Server data stays the source
  // of truth — it re-syncs these local copies whenever it changes, keeping local selection flags.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<CanvasNodeFlowData>(flowNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(flowEdges);
  useEffect(() => {
    setRfNodes((prev) => {
      // Keep React Flow's measured size too: it reads width/height off the node object, and a node
      // without them is treated as unmeasured (hidden, edges not drawn) until a resize that never comes.
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return flowNodes.map((n) => {
        const p = prevById.get(n.id);
        return { ...n, selected: !!p?.selected, width: p?.width, height: p?.height };
      });
    });
  }, [flowNodes, setRfNodes]);
  useEffect(() => {
    setRfEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return flowEdges.map((e) => ({ ...e, selected: selected.has(e.id) }));
    });
  }, [flowEdges, setRfEdges]);

  // Keyboard delete, replacing React Flow's built-in deleteKeyCode: that removed *whatever* was
  // selected — including a node still selected from an earlier click when the user meant to delete
  // an edge — and wiped the node, its edges and a teammate's notes with no prompt. Edges (cheap to
  // redraw) go immediately; a node needs confirmation.
  useEffect(() => {
    if (!editable) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const edgesToDelete = rfEdges.filter((edge) => edge.selected);
      if (edgesToDelete.length > 0) {
        e.preventDefault();
        edgesToDelete.forEach((edge) => onEdgeDelete?.(Number(edge.id.slice(FLOW_EDGE_PREFIX.length))));
        return;
      }
      const node = rfNodes.find((n) => n.selected);
      if (!node) return;
      e.preventDefault();
      if (window.confirm(`Delete "${node.data.label}" and its connections for the whole team?`)) {
        onSelectionChange(null);
        onNodeDelete?.(parseFlowNodeId(node.id));
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editable, rfEdges, rfNodes, onEdgeDelete, onNodeDelete, onSelectionChange]);

  function handleDragOver(e: React.DragEvent) {
    if (!editable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: React.DragEvent) {
    if (!editable) return;
    e.preventDefault();
    const type = e.dataTransfer.getData(CANVAS_DRAG_MIME) as CanvasNodeTypeKey | '';
    if (!type) return;
    const position = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onNodeCreate?.(type, position.x, position.y);
  }

  const handleNodeClick: NodeMouseHandler = (_, node) => onSelectionChange(parseFlowNodeId(node.id));
  const handlePaneClick = () => onSelectionChange(null);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {editable && <CanvasNodePalette />}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{ position: 'relative', flex: 1, background: 'var(--surface-floor)', borderRadius: 'var(--radius-container)' }}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={canvasNodeTypes}
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable
          selectNodesOnDrag={false}
          deleteKeyCode={null}
          onNodeDragStop={(_, node) => onNodeDragStop?.(parseFlowNodeId(node.id), node.position.x, node.position.y)}
          onConnect={(params) => {
            if (!params.source || !params.target) return;
            onConnect?.(parseFlowNodeId(params.source), parseFlowNodeId(params.target));
          }}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          fitView
          // Without a cap, a board with 1–3 nodes zooms in to 2x and the cards fill the screen.
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--surface-border)" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>

        {nodes.length === 0 && editable && (
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              right: 16,
              pointerEvents: 'none',
              color: 'var(--text-muted)',
              fontSize: 13,
              border: '1px dashed var(--surface-border)',
              borderRadius: 'var(--radius-container)',
              padding: 'var(--space-md)',
            }}
          >
            Drag a node from the left to begin mapping this investigation.
          </div>
        )}
        {nodes.length === 0 && !editable && (
          <div style={{ position: 'absolute', top: 16, left: 16, color: 'var(--text-muted)', fontSize: 13 }}>
            No investigation canvas entries yet.
          </div>
        )}

        {editable && selectedNode && (
          <CanvasNodeInspector
            node={selectedNode}
            onClose={() => onSelectionChange(null)}
            onDuplicate={() => onNodeDuplicate?.(selectedNode)}
            onBodyChange={(body) => onBodyChange?.(selectedNode.id, body)}
            onDelete={() => {
              if (!window.confirm(`Delete "${selectedNode.label}" and its connections for the whole team?`)) return;
              onSelectionChange(null);
              onNodeDelete?.(selectedNode.id);
            }}
          />
        )}
      </div>
    </div>
  );
}

// Wrapped in its own ReactFlowProvider so a consumer doesn't need to know this component uses
// useReactFlow() internally (needed for screenToFlowPosition on palette drop).
export function InvestigationCanvas(props: InvestigationCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
