import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import {
  TopologyGraph,
  formatMetadataValue,
  parseMetadata,
  type TopologyEdgeData,
  type TopologyNodeData,
  type TopologyZoneData,
} from './TopologyGraph';
import { AccessSessionPanel, type ActiveAccessSession } from '../accessSession/AccessSessionPanel';

interface ActiveCyberRange {
  cyberRangeId: number;
  name: string;
}

interface TopologyResponse {
  zones: TopologyZoneData[];
  nodes: TopologyNodeData[];
  edges: TopologyEdgeData[];
}

interface AccessSessionResponse {
  accessSessionId: number;
  wsUrl: string | null;
  expiresAt: string;
}

const STATUS_TONE: Record<string, 'primary' | 'tertiary' | 'alert' | 'muted'> = {
  running: 'primary',
  starting: 'tertiary',
  stopping: 'tertiary',
  stopped: 'muted',
  error: 'alert',
};

const ROLE_LABEL: Record<string, string> = {
  domain_controller: 'Domain Controller',
  kali_attacker: 'Attacker',
  siem: 'SIEM',
  web_server: 'Web Server',
  mail_server: 'Mail Server',
  database_server: 'Database',
  workstation: 'Workstation',
  linux_server: 'Linux Server',
  generic_server: 'Server',
  firewall: 'Firewall',
  internet_gateway: 'Internet',
};

export function TopologyViewerPage() {
  const [selectedNode, setSelectedNode] = useState<TopologyNodeData | null>(null);
  const [session, setSession] = useState<ActiveAccessSession | null>(null);
  const [connectingNodeId, setConnectingNodeId] = useState<number | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const { data: activeData } = useQuery({
    queryKey: ['active-cyber-range'],
    queryFn: () => apiFetch<{ active: ActiveCyberRange | null }>('/teams/me/active-cyber-range'),
  });
  const active = activeData?.active;

  const { data: topologyData, isLoading } = useQuery({
    enabled: !!active,
    queryKey: ['topology', active?.cyberRangeId],
    queryFn: () => apiFetch<TopologyResponse>(`/cyber-ranges/${active!.cyberRangeId}/topology`),
  });

  const connect = useMutation({
    mutationFn: (node: TopologyNodeData) =>
      apiFetch<AccessSessionResponse>('/teams/me/access-sessions', {
        method: 'POST',
        body: JSON.stringify({ topologyNodeId: node.id }),
      }).then((res) => ({ res, node })),
    onMutate: (node) => {
      setConnectingNodeId(node.id);
      setConnectError(null);
    },
    onSuccess: ({ res, node }) => {
      setSession({ accessSessionId: res.accessSessionId, wsUrl: res.wsUrl, expiresAt: res.expiresAt, nodeLabel: node.label });
    },
    onError: (err) => setConnectError(err instanceof ApiError ? err.message : 'Failed to start a session'),
    onSettled: () => setConnectingNodeId(null),
  });

  const disconnect = useMutation({
    mutationFn: (accessSessionId: number) => apiFetch(`/teams/me/access-sessions/${accessSessionId}/end`, { method: 'POST' }),
    onSuccess: () => setSession(null),
  });

  if (!active) {
    return (
      <div style={{ padding: 'var(--space-xl)' }}>
        <EmptyState message="No active Cyber Range — topology opens once your team's investigation starts." />
      </div>
    );
  }

  if (isLoading) {
    return <div style={{ padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>Loading…</div>;
  }

  const metadata = parseMetadata(selectedNode?.metadataJson);
  const ip = metadata && typeof metadata.privateIpAddress === 'string' ? metadata.privateIpAddress : null;
  const os = metadata && typeof metadata.osType === 'string' ? metadata.osType : null;

  const nodes = topologyData?.nodes ?? [];
  const statusCounts = nodes.reduce<Record<string, number>>((acc, n) => {
    const key = n.status ?? 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-sm)' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-telemetry)' }}>
            Network Topology
          </div>
          <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '2px 0 0' }}>{active.name}</h1>
        </div>
        <Link to="/investigation" style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
          ← Back to investigation
        </Link>
      </div>

      {nodes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--space-lg)' }}>
          <TelemetryBadge tone="muted">{nodes.length} nodes detected</TelemetryBadge>
          {Object.entries(statusCounts).map(([status, count]) => (
            <TelemetryBadge key={status} tone={STATUS_TONE[status] ?? 'muted'}>
              {status} ({count})
            </TelemetryBadge>
          ))}
        </div>
      )}

      {topologyData && topologyData.nodes.length === 0 ? (
        <EmptyState message="No topology has been configured for this Cyber Range yet." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selectedNode ? '1fr 280px' : '1fr', gap: 'var(--space-lg)' }}>
          <TopologyGraph
            zones={topologyData?.zones ?? []}
            nodes={topologyData?.nodes ?? []}
            edges={topologyData?.edges ?? []}
            onNodeClick={setSelectedNode}
            onPaneClick={() => setSelectedNode(null)}
          />

          {selectedNode && (
            <div
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-container)',
                padding: 'var(--space-md)',
                height: 'fit-content',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <strong style={{ color: 'var(--text-primary)', fontSize: 15 }}>{selectedNode.label}</strong>
                <button
                  onClick={() => setSelectedNode(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}
                >
                  ×
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-telemetry)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {selectedNode.role ? ROLE_LABEL[selectedNode.role] ?? selectedNode.role : selectedNode.nodeType}
                </span>
                <TelemetryBadge tone={STATUS_TONE[selectedNode.status ?? ''] ?? 'muted'}>{selectedNode.status ?? 'unknown'}</TelemetryBadge>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                {ip && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-telemetry)', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      IP Route
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{ip}</span>
                  </div>
                )}
                {os && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-telemetry)', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Operating Sys
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatMetadataValue(os)}</span>
                  </div>
                )}
              </div>

              {!!selectedNode.hasAccessTarget && (
                <button
                  onClick={() => connect.mutate(selectedNode)}
                  disabled={connectingNodeId === selectedNode.id}
                  style={{
                    marginTop: 14,
                    width: '100%',
                    background: 'var(--signal-primary)',
                    color: 'var(--surface-floor)',
                    border: 'none',
                    borderRadius: 'var(--radius-control)',
                    padding: '8px 0',
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
      )}

      {connectError && <div style={{ marginTop: 8, color: 'var(--signal-alert)', fontSize: 14 }}>{connectError}</div>}
      {session && <AccessSessionPanel session={session} onDisconnect={() => disconnect.mutate(session.accessSessionId)} disconnecting={disconnect.isPending} />}
    </div>
  );
}
