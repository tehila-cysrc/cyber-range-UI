import { useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';

export interface TopologyZoneData {
  id: number;
  externalKey: string | null;
  name: string;
  cidr: string | null;
  sortOrder: number;
}

export interface TopologyNodeData {
  id: number;
  externalKey: string;
  label: string;
  nodeType: string;
  role: string | null;
  zoneId: number | null;
  status?: string | null;
  posX: number;
  posY: number;
  metadataJson?: string | null;
  environmentId?: number | null;
  isVisibleToStudents?: number | boolean;
  hasAccessTarget?: number | boolean;
}

export interface TopologyEdgeData {
  id: number;
  fromNodeId: number | null;
  toNodeId: number | null;
  fromZoneId: number | null;
  toZoneId: number | null;
  label: string | null;
}

interface TopologyGraphProps {
  zones: TopologyZoneData[];
  nodes: TopologyNodeData[];
  edges: TopologyEdgeData[];
  editable?: boolean;
  onNodeDragStop?: (nodeId: number, x: number, y: number) => void;
  onNodeClick?: (node: TopologyNodeData) => void;
  onZoneClick?: (zone: TopologyZoneData) => void;
  onPaneClick?: () => void;
  // A dragged connection can start/end on either a host card or a zone container — e.g. an
  // instructor drawing Internet -> Firewall -> Zone. The caller maps the endpoint kind to the right
  // fromNodeId/fromZoneId + toNodeId/toZoneId shape for the edge-create API call.
  onConnect?: (from: { type: 'node' | 'zone'; id: number }, to: { type: 'node' | 'zone'; id: number }) => void;
}

function parseFlowId(flowId: string): { type: 'node' | 'zone'; id: number } | null {
  if (flowId.startsWith('node:')) return { type: 'node', id: Number(flowId.slice(5)) };
  if (flowId.startsWith('zone:')) return { type: 'zone', id: Number(flowId.slice(5)) };
  return null;
}

// The "cyber role" is the primary visual language (design doc §9.5) — nodeType (mostly an Azure
// implementation detail) is only a fallback for a node with no inferred/assigned role yet.
const ROLE_STYLE: Record<string, { border: string; label: string }> = {
  domain_controller: { border: 'var(--signal-secondary)', label: 'Domain Controller' },
  kali_attacker: { border: 'var(--signal-alert)', label: 'Attacker' },
  siem: { border: 'var(--signal-tertiary)', label: 'SIEM' },
  web_server: { border: 'var(--role-blue)', label: 'Web Server' },
  mail_server: { border: 'var(--role-violet)', label: 'Mail Server' },
  database_server: { border: 'var(--role-teal)', label: 'Database' },
  workstation: { border: 'var(--text-telemetry)', label: 'Workstation' },
  linux_server: { border: 'var(--role-orange)', label: 'Linux Server' },
  generic_server: { border: 'var(--role-lime)', label: 'Server' },
  firewall: { border: 'var(--role-pink)', label: 'Firewall' },
  internet_gateway: { border: 'var(--text-muted)', label: 'Internet' },
};

const NODE_TYPE_FALLBACK_STYLE: Record<string, { border: string; label: string }> = {
  vm: { border: 'var(--signal-primary)', label: 'Host' },
  host: { border: 'var(--signal-primary)', label: 'Host' },
  service: { border: 'var(--signal-secondary)', label: 'Service' },
  network: { border: 'var(--text-telemetry)', label: 'Network' },
  nic: { border: 'var(--text-telemetry)', label: 'NIC' },
  nsg: { border: 'var(--signal-alert)', label: 'NSG' },
  public_ip: { border: 'var(--signal-tertiary)', label: 'Public IP' },
  load_balancer: { border: 'var(--signal-tertiary)', label: 'Load Balancer' },
  storage_account: { border: 'var(--signal-secondary)', label: 'Storage' },
  key_vault: { border: 'var(--signal-alert)', label: 'Key Vault' },
};

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--signal-primary)',
  starting: 'var(--signal-tertiary)',
  stopping: 'var(--signal-tertiary)',
  stopped: 'var(--text-telemetry)',
  error: 'var(--signal-alert)',
};

function styleFor(node: TopologyNodeData) {
  if (node.role && ROLE_STYLE[node.role]) return ROLE_STYLE[node.role];
  return NODE_TYPE_FALLBACK_STYLE[node.nodeType] ?? { border: 'var(--signal-secondary)', label: node.nodeType };
}

function parseMetadata(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const NODE_FLOW_ID = (id: number) => `node:${id}`;
const ZONE_FLOW_ID = (id: number) => `zone:${id}`;
const CARD_WIDTH = 176;
const CARD_HEIGHT = 60;
const ZONE_PADDING = 36;
const ZONE_LABEL_HEIGHT = 30;

export function TopologyGraph({
  zones,
  nodes,
  edges,
  editable = false,
  onNodeDragStop,
  onNodeClick,
  onZoneClick,
  onPaneClick,
  onConnect,
}: TopologyGraphProps) {
  const [legendOpen, setLegendOpen] = useState(false);

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const zoneRects = useMemo(() => {
    const rects = new Map<number, { x: number; y: number; width: number; height: number }>();
    for (const zone of zones) {
      const members = nodes.filter((n) => n.zoneId === zone.id);
      if (members.length === 0) continue;
      const minX = Math.min(...members.map((n) => n.posX));
      const minY = Math.min(...members.map((n) => n.posY));
      const maxX = Math.max(...members.map((n) => n.posX + CARD_WIDTH));
      const maxY = Math.max(...members.map((n) => n.posY + CARD_HEIGHT));
      rects.set(zone.id, {
        x: minX - ZONE_PADDING,
        y: minY - ZONE_PADDING - ZONE_LABEL_HEIGHT,
        width: maxX - minX + ZONE_PADDING * 2,
        height: maxY - minY + ZONE_PADDING * 2 + ZONE_LABEL_HEIGHT,
      });
    }
    return rects;
  }, [zones, nodes]);

  const flowNodes: Node[] = useMemo(() => {
    const zoneNodes: Node[] = zones
      .filter((z) => zoneRects.has(z.id))
      .map((zone) => {
        const rect = zoneRects.get(zone.id)!;
        return {
          id: ZONE_FLOW_ID(zone.id),
          position: { x: rect.x, y: rect.y },
          draggable: false,
          selectable: true,
          zIndex: -1,
          data: {
            label: (
              <div style={{ width: '100%', height: '100%', textAlign: 'left' }}>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--text-muted)',
                    padding: '6px 10px',
                  }}
                >
                  {zone.name}
                  {zone.cidr ? <span style={{ color: 'var(--text-telemetry)' }}> · {zone.cidr}</span> : null}
                </div>
              </div>
            ),
          },
          style: {
            width: rect.width,
            height: rect.height,
            background: 'rgba(30, 41, 59, 0.25)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            padding: 0,
          },
        };
      });

    const hostNodes: Node[] = nodes.map((n) => {
      const { border, label: typeLabel } = styleFor(n);
      const statusColor = n.status ? (STATUS_COLOR[n.status] ?? 'var(--text-telemetry)') : 'var(--text-telemetry)';
      return {
        id: NODE_FLOW_ID(n.id),
        position: { x: n.posX, y: n.posY },
        data: {
          label: (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  title={n.status ?? 'status unknown'}
                  style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0, opacity: n.status ? 1 : 0.4 }}
                />
                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
                {!!n.hasAccessTarget && (
                  <span title="Connectable" style={{ fontSize: 10, color: 'var(--signal-primary)' }}>
                    ⏻
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-telemetry)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{typeLabel}</div>
            </div>
          ),
        },
        style: {
          width: CARD_WIDTH,
          background: 'var(--surface-2)',
          border: `1px solid ${border}`,
          borderRadius: 6,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          padding: 8,
        },
      };
    });

    return [...zoneNodes, ...hostNodes];
  }, [zones, nodes, zoneRects]);

  const renderedIds = useMemo(() => new Set(flowNodes.map((n) => n.id)), [flowNodes]);

  const flowEdges: Edge[] = useMemo(() => {
    const result: Edge[] = [];
    for (const e of edges) {
      const source = e.fromNodeId != null ? NODE_FLOW_ID(e.fromNodeId) : e.fromZoneId != null ? ZONE_FLOW_ID(e.fromZoneId) : null;
      const target = e.toNodeId != null ? NODE_FLOW_ID(e.toNodeId) : e.toZoneId != null ? ZONE_FLOW_ID(e.toZoneId) : null;
      if (!source || !target || !renderedIds.has(source) || !renderedIds.has(target)) continue;
      result.push({ id: `edge-${e.id}`, source, target, label: e.label ?? undefined, style: { stroke: 'var(--text-telemetry)' } });
    }
    return result;
  }, [edges, renderedIds]);

  return (
    <div
      style={{
        position: 'relative',
        height: 'clamp(520px, 68vh, 860px)',
        background: 'var(--surface-floor)',
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-container)',
        overflow: 'hidden',
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable
        onNodeDragStop={(_, node) => {
          if (!node.id.startsWith('node:') || !onNodeDragStop) return;
          const id = Number(node.id.slice('node:'.length));
          onNodeDragStop(id, node.position.x, node.position.y);
        }}
        onConnect={(params) => {
          if (!onConnect || !params.source || !params.target) return;
          const from = parseFlowId(params.source);
          const to = parseFlowId(params.target);
          if (from && to) onConnect(from, to);
        }}
        onNodeClick={(_, node) => {
          if (node.id.startsWith('node:')) {
            const n = nodesById.get(Number(node.id.slice('node:'.length)));
            if (n && onNodeClick) onNodeClick(n);
          } else if (node.id.startsWith('zone:')) {
            const zone = zones.find((z) => z.id === Number(node.id.slice('zone:'.length)));
            if (zone && onZoneClick) onZoneClick(zone);
          }
        }}
        onPaneClick={() => onPaneClick?.()}
        fitView
        // React Flow's default minZoom (0.5) stops fitView short on a spread-out layout, leaving
        // hosts clipped outside the viewport — allow zooming out far enough to show everything.
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--surface-border)" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* Bottom-right so it doesn't sit on top of React Flow's bottom-left zoom/fit controls. */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 5, display: 'flex', flexDirection: 'column-reverse', alignItems: 'flex-end' }}>
        <button
          onClick={() => setLegendOpen((v) => !v)}
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
            color: 'var(--text-muted)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            padding: '4px 8px',
            cursor: 'pointer',
          }}
        >
          {legendOpen ? 'Hide legend' : 'Legend'}
        </button>
        {legendOpen && (
          <div
            style={{
              marginBottom: 6,
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-container)',
              padding: 'var(--space-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {Object.entries(ROLE_STYLE).map(([key, { border, label }]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, border: `1px solid ${border}`, background: 'var(--surface-2)' }} />
                {label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function formatMetadataValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export { parseMetadata };
