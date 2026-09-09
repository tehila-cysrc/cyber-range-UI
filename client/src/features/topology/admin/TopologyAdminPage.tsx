import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/apiClient';
import { Button } from '../../../components/Button';
import { TopologyGraph, type TopologyEdgeData, type TopologyNodeData } from '../TopologyGraph';

interface CyberRange {
  id: number;
  name: string;
  dayLabel: string;
}

interface TopologyResponse {
  nodes: TopologyNodeData[];
  edges: TopologyEdgeData[];
}

export function TopologyAdminPage() {
  const queryClient = useQueryClient();
  const [cyberRangeId, setCyberRangeId] = useState<number | ''>('');
  const [label, setLabel] = useState('');
  const [nodeType, setNodeType] = useState('host');
  const [fromNodeId, setFromNodeId] = useState<number | ''>('');
  const [toNodeId, setToNodeId] = useState<number | ''>('');

  const { data: rangesData } = useQuery({
    queryKey: ['cyber-ranges'],
    queryFn: () => apiFetch<{ cyberRanges: CyberRange[] }>('/cyber-ranges'),
  });

  const { data: topologyData } = useQuery({
    enabled: cyberRangeId !== '',
    queryKey: ['topology', cyberRangeId],
    queryFn: () => apiFetch<TopologyResponse>(`/cyber-ranges/${cyberRangeId}/topology`),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['topology', cyberRangeId] });
  }

  const addNode = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/nodes`, {
        method: 'POST',
        body: JSON.stringify({ label, nodeType, posX: Math.random() * 400, posY: Math.random() * 300 }),
      }),
    onSuccess: () => {
      setLabel('');
      invalidate();
    },
  });

  const addEdge = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/edges`, {
        method: 'POST',
        body: JSON.stringify({ fromNodeId, toNodeId }),
      }),
    onSuccess: () => {
      setFromNodeId('');
      setToNodeId('');
      invalidate();
    },
  });

  const moveNode = useMutation({
    mutationFn: ({ nodeId, posX, posY }: { nodeId: number; posX: number; posY: number }) =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ posX, posY }),
      }),
    onSuccess: invalidate,
  });

  function handleAddNode(e: FormEvent) {
    e.preventDefault();
    if (!cyberRangeId || !label.trim()) return;
    addNode.mutate();
  }

  function handleAddEdge(e: FormEvent) {
    e.preventDefault();
    if (!cyberRangeId || !fromNodeId || !toNodeId) return;
    addEdge.mutate();
  }

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <h1 style={{ fontSize: 20, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
        Topology Admin
      </h1>

      <select
        value={cyberRangeId}
        onChange={(e) => setCyberRangeId(e.target.value ? Number(e.target.value) : '')}
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-control)',
          padding: 8,
          color: 'var(--text-primary)',
          marginBottom: 'var(--space-lg)',
        }}
      >
        <option value="">Select a Cyber Range…</option>
        {rangesData?.cyberRanges.map((cr) => (
          <option key={cr.id} value={cr.id}>
            {cr.dayLabel} — {cr.name}
          </option>
        ))}
      </select>

      {cyberRangeId !== '' && (
        <div style={{ display: 'grid', gridTemplateColumns: '60% 40%', gap: 'var(--space-xl)' }}>
          <TopologyGraph
            nodes={topologyData?.nodes ?? []}
            edges={topologyData?.edges ?? []}
            editable
            onNodeDragStop={(nodeId, x, y) => moveNode.mutate({ nodeId, posX: x, posY: y })}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            <form onSubmit={handleAddNode} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <h2 style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Add node</h2>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (e.g. DC01)"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 'var(--radius-control)',
                  padding: 8,
                  color: 'var(--text-primary)',
                }}
              />
              <select
                value={nodeType}
                onChange={(e) => setNodeType(e.target.value)}
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 'var(--radius-control)',
                  padding: 8,
                  color: 'var(--text-primary)',
                }}
              >
                <option value="host">Host</option>
                <option value="service">Service</option>
                <option value="network">Network</option>
              </select>
              <Button type="submit">Add node</Button>
            </form>

            <form onSubmit={handleAddEdge} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <h2 style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Add connection</h2>
              <select
                value={fromNodeId}
                onChange={(e) => setFromNodeId(e.target.value ? Number(e.target.value) : '')}
                style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-control)', padding: 8, color: 'var(--text-primary)' }}
              >
                <option value="">From…</option>
                {topologyData?.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
              <select
                value={toNodeId}
                onChange={(e) => setToNodeId(e.target.value ? Number(e.target.value) : '')}
                style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-control)', padding: 8, color: 'var(--text-primary)' }}
              >
                <option value="">To…</option>
                {topologyData?.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="ghost">
                Connect
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
