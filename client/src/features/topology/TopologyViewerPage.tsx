import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { TopologyGraph, type TopologyEdgeData, type TopologyNodeData } from './TopologyGraph';

interface ActiveCyberRange {
  cyberRangeId: number;
  name: string;
}

interface TopologyResponse {
  nodes: TopologyNodeData[];
  edges: TopologyEdgeData[];
}

export function TopologyViewerPage() {
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
        <h1 style={{ fontSize: 20, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
          Topology — {active.name}
        </h1>
        <Link to="/investigation" style={{ fontSize: 12, color: 'var(--signal-secondary)' }}>
          ← Back to investigation
        </Link>
      </div>

      {topologyData && topologyData.nodes.length === 0 ? (
        <EmptyState message="No topology has been configured for this Cyber Range yet." />
      ) : (
        <TopologyGraph nodes={topologyData?.nodes ?? []} edges={topologyData?.edges ?? []} />
      )}
    </div>
  );
}
