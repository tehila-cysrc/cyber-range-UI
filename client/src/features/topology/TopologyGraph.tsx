import { useMemo } from 'react';
import ReactFlow, { Background, Controls, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';

export interface TopologyNodeData {
  id: number;
  externalKey: string;
  label: string;
  nodeType: string;
  posX: number;
  posY: number;
}

export interface TopologyEdgeData {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  label: string | null;
}

interface TopologyGraphProps {
  nodes: TopologyNodeData[];
  edges: TopologyEdgeData[];
  editable?: boolean;
  onNodeDragStop?: (nodeId: number, x: number, y: number) => void;
}

export function TopologyGraph({ nodes, edges, editable = false, onNodeDragStop }: TopologyGraphProps) {
  const flowNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.externalKey,
        position: { x: n.posX, y: n.posY },
        data: { label: n.label },
        style: {
          background: 'var(--surface-2)',
          border: '1px solid var(--signal-secondary)',
          borderRadius: 6,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          padding: 8,
        },
      })),
    [nodes],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const fromNode = nodes.find((n) => n.id === e.fromNodeId);
        const toNode = nodes.find((n) => n.id === e.toNodeId);
        return {
          id: `edge-${e.id}`,
          source: fromNode?.externalKey ?? String(e.fromNodeId),
          target: toNode?.externalKey ?? String(e.toNodeId),
          label: e.label ?? undefined,
          style: { stroke: 'var(--text-telemetry)' },
        };
      }),
    [edges, nodes],
  );

  return (
    <div style={{ height: 480, background: 'var(--surface-floor)', borderRadius: 'var(--radius-container)' }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodesDraggable={editable}
        nodesConnectable={false}
        elementsSelectable={editable}
        onNodeDragStop={(_, node) => {
          const original = nodes.find((n) => n.externalKey === node.id);
          if (original && onNodeDragStop) {
            onNodeDragStop(original.id, node.position.x, node.position.y);
          }
        }}
        fitView
      >
        <Background color="var(--surface-border)" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
