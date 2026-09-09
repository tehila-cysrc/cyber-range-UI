import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { TopologyGraph, type TopologyEdgeData, type TopologyNodeData } from './TopologyGraph';
import { AccessSessionPanel, type ActiveAccessSession } from '../accessSession/AccessSessionPanel';

interface ActiveCyberRange {
  cyberRangeId: number;
  name: string;
}

interface TopologyResponse {
  nodes: TopologyNodeData[];
  edges: TopologyEdgeData[];
}

interface AccessSessionResponse {
  accessSessionId: number;
  wsUrl: string | null;
  expiresAt: string;
}

export function TopologyViewerPage() {
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

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
          Topology — {active.name}
        </h1>
        <Link to="/investigation" style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
          ← Back to investigation
        </Link>
      </div>

      {topologyData && topologyData.nodes.length === 0 ? (
        <EmptyState message="No topology has been configured for this Cyber Range yet." />
      ) : (
        <TopologyGraph
          nodes={topologyData?.nodes ?? []}
          edges={topologyData?.edges ?? []}
          onConnectClick={(node) => connect.mutate(node)}
          connectingNodeId={connectingNodeId}
        />
      )}

      {connectError && <div style={{ marginTop: 8, color: 'var(--signal-alert)', fontSize: 14 }}>{connectError}</div>}
      {session && <AccessSessionPanel session={session} onDisconnect={() => disconnect.mutate(session.accessSessionId)} disconnecting={disconnect.isPending} />}
    </div>
  );
}
