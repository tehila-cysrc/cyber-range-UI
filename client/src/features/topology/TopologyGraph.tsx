import { useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';

export interface TopologyNodeData {
  id: number;
  externalKey: string;
  label: string;
  nodeType: string;
  posX: number;
  posY: number;
  metadataJson?: string | null;
  environmentId?: number | null;
  hasAccessTarget?: number | boolean;
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
  // Student-facing "Connect" action (Phase 4 access broker) — only rendered when both this callback
  // is supplied AND the node has `hasAccessTarget` set. The instructor admin view doesn't pass this,
  // so it never shows there.
  onConnectClick?: (node: TopologyNodeData) => void;
  connectingNodeId?: number | null;
}

// Border color + short type label per node_type — covers both instructor hand-drawn types
// (host/service/network) and Azure-discovery types (vm/nic/vnet/subnet/nsg/public_ip/
// load_balancer/storage_account/key_vault). Unknown types fall back to the original neutral style
// so this never breaks on a type it doesn't recognize.
const NODE_TYPE_STYLE: Record<string, { border: string; typeLabel: string }> = {
  vm: { border: 'var(--signal-primary)', typeLabel: 'VM' },
  nic: { border: 'var(--text-telemetry)', typeLabel: 'NIC' },
  vnet: { border: 'var(--signal-secondary)', typeLabel: 'VNet' },
  subnet: { border: 'var(--signal-secondary)', typeLabel: 'Subnet' },
  nsg: { border: 'var(--signal-alert)', typeLabel: 'NSG' },
  public_ip: { border: 'var(--signal-tertiary)', typeLabel: 'Public IP' },
  load_balancer: { border: 'var(--signal-tertiary)', typeLabel: 'Load Balancer' },
  storage_account: { border: 'var(--signal-secondary)', typeLabel: 'Storage' },
  key_vault: { border: 'var(--signal-alert)', typeLabel: 'Key Vault' },
  host: { border: 'var(--signal-primary)', typeLabel: 'Host' },
  service: { border: 'var(--signal-secondary)', typeLabel: 'Service' },
  network: { border: 'var(--text-telemetry)', typeLabel: 'Network' },
};

function styleForNodeType(nodeType: string) {
  return NODE_TYPE_STYLE[nodeType] ?? { border: 'var(--signal-secondary)', typeLabel: nodeType };
}

function parseMetadata(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function TopologyGraph({
  nodes,
  edges,
  editable = false,
  onNodeDragStop,
  onConnectClick,
  connectingNodeId,
}: TopologyGraphProps) {
  const [selectedExternalKey, setSelectedExternalKey] = useState<string | null>(null);
  const selectedNode = nodes.find((n) => n.externalKey === selectedExternalKey) ?? null;

  const flowNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => {
        const { border, typeLabel } = styleForNodeType(n.nodeType);
        const discovered = n.environmentId != null;
        return {
          id: n.externalKey,
          position: { x: n.posX, y: n.posY },
          data: {
            label: (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {discovered && (
                    <span
                      title="Discovered from a live cloud environment"
                      style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--signal-primary)', flexShrink: 0 }}
                    />
                  )}
                  <span>{n.label}</span>
                  {!!n.hasAccessTarget && (
                    <span title="Connectable" style={{ fontSize: 10, color: 'var(--signal-primary)' }}>
                      ⏻
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-telemetry)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {typeLabel}
                </div>
              </div>
            ),
          },
          style: {
            background: 'var(--surface-2)',
            border: `1px solid ${border}`,
            borderRadius: 6,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            padding: 8,
          },
        };
      }),
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

  const selectedMetadata = parseMetadata(selectedNode?.metadataJson);

  return (
    <div style={{ position: 'relative', height: 480, background: 'var(--surface-floor)', borderRadius: 'var(--radius-container)' }}>
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
        onNodeClick={(_, node) => setSelectedExternalKey(node.id)}
        onPaneClick={() => setSelectedExternalKey(null)}
        fitView
      >
        <Background color="var(--surface-border)" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {selectedNode && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 260,
            maxHeight: 440,
            overflowY: 'auto',
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            padding: 'var(--space-md)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: 15 }}>{selectedNode.label}</strong>
            <button
              onClick={() => setSelectedExternalKey(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-telemetry)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {styleForNodeType(selectedNode.nodeType).typeLabel}
            {selectedNode.environmentId != null && ' · discovered'}
          </div>
          {selectedMetadata ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(selectedMetadata).map(([key, value]) => (
                <div key={key} style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--text-telemetry)' }}>{key}:</span> {formatMetadataValue(value)}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>No additional metadata.</div>
          )}
          {onConnectClick && !!selectedNode.hasAccessTarget && (
            <button
              onClick={() => onConnectClick(selectedNode)}
              disabled={connectingNodeId === selectedNode.id}
              style={{
                marginTop: 10,
                width: '100%',
                background: 'var(--signal-primary)',
                color: 'var(--surface-floor)',
                border: 'none',
                borderRadius: 'var(--radius-control)',
                padding: '6px 0',
                cursor: connectingNodeId === selectedNode.id ? 'default' : 'pointer',
                fontFamily: 'inherit',
                fontWeight: 500,
              }}
            >
              {connectingNodeId === selectedNode.id ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatMetadataValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
