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

interface AccessTarget {
  protocol: 'rdp' | 'ssh';
  host: string;
  port: number;
  hasCredential: boolean;
}

const selectStyle = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
};

export function TopologyAdminPage() {
  const queryClient = useQueryClient();
  const [cyberRangeId, setCyberRangeId] = useState<number | ''>('');
  const [label, setLabel] = useState('');
  const [nodeType, setNodeType] = useState('host');
  const [fromNodeId, setFromNodeId] = useState<number | ''>('');
  const [toNodeId, setToNodeId] = useState<number | ''>('');

  const [accessNodeId, setAccessNodeId] = useState<number | ''>('');
  const [accessProtocol, setAccessProtocol] = useState<'rdp' | 'ssh'>('rdp');
  const [accessHost, setAccessHost] = useState('');
  const [accessPort, setAccessPort] = useState('3389');
  const [accessUsername, setAccessUsername] = useState('');
  const [accessPassword, setAccessPassword] = useState('');

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

  const { data: accessTargetData } = useQuery({
    enabled: accessNodeId !== '',
    queryKey: ['access-target', accessNodeId],
    queryFn: () => apiFetch<{ accessTarget: AccessTarget | null }>(`/admin/topology/nodes/${accessNodeId}/access-target`),
  });

  function invalidateAccessTarget() {
    queryClient.invalidateQueries({ queryKey: ['access-target', accessNodeId] });
    invalidate(); // topology response's hasAccessTarget flag also needs refreshing
  }

  const saveAccessTarget = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/topology/nodes/${accessNodeId}/access-target`, {
        method: 'PUT',
        body: JSON.stringify({ protocol: accessProtocol, host: accessHost, port: Number(accessPort), username: accessUsername, password: accessPassword }),
      }),
    onSuccess: () => {
      setAccessPassword('');
      invalidateAccessTarget();
    },
  });

  const removeAccessTarget = useMutation({
    mutationFn: () => apiFetch(`/admin/topology/nodes/${accessNodeId}/access-target`, { method: 'DELETE' }),
    onSuccess: invalidateAccessTarget,
  });

  function handleSaveAccessTarget(e: FormEvent) {
    e.preventDefault();
    if (!accessNodeId || !accessHost.trim() || !accessUsername.trim() || !accessPassword.trim()) return;
    saveAccessTarget.mutate();
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
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
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
              <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>Add node</h2>
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
              <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>Add connection</h2>
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

            <form onSubmit={handleSaveAccessTarget} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>Student browser access</h2>
              <select value={accessNodeId} onChange={(e) => setAccessNodeId(e.target.value ? Number(e.target.value) : '')} style={selectStyle}>
                <option value="">Select a node…</option>
                {topologyData?.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} {n.hasAccessTarget ? '(connectable)' : ''}
                  </option>
                ))}
              </select>
              {accessNodeId !== '' && (
                <>
                  {accessTargetData?.accessTarget && (
                    <div style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>
                      Currently: {accessTargetData.accessTarget.protocol} to {accessTargetData.accessTarget.host}:{accessTargetData.accessTarget.port} — leave
                      username/password blank to keep the same credential (re-entering rotates it).
                    </div>
                  )}
                  <select value={accessProtocol} onChange={(e) => setAccessProtocol(e.target.value as 'rdp' | 'ssh')} style={selectStyle}>
                    <option value="rdp">RDP</option>
                    <option value="ssh">SSH</option>
                  </select>
                  <input value={accessHost} onChange={(e) => setAccessHost(e.target.value)} placeholder="Host / private IP" style={{ ...selectStyle, background: 'transparent' }} />
                  <input value={accessPort} onChange={(e) => setAccessPort(e.target.value)} placeholder="Port" style={{ ...selectStyle, background: 'transparent' }} />
                  <input value={accessUsername} onChange={(e) => setAccessUsername(e.target.value)} placeholder="Login username" style={{ ...selectStyle, background: 'transparent' }} />
                  <input
                    value={accessPassword}
                    onChange={(e) => setAccessPassword(e.target.value)}
                    placeholder="Login password"
                    type="password"
                    style={{ ...selectStyle, background: 'transparent' }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button type="submit" variant="ghost" disabled={saveAccessTarget.isPending}>
                      Save access target
                    </Button>
                    {accessTargetData?.accessTarget && (
                      <Button type="button" variant="destructive" onClick={() => removeAccessTarget.mutate()}>
                        Remove
                      </Button>
                    )}
                  </div>
                </>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
