import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../../lib/apiClient';
import { Button } from '../../../components/Button';
import {
  TopologyGraph,
  formatMetadataValue,
  parseMetadata,
  type TopologyEdgeData,
  type TopologyNodeData,
  type TopologyZoneData,
} from '../TopologyGraph';
import { RunScriptDrawer } from './RunScriptDrawer';

interface CyberRange {
  id: number;
  name: string;
  dayLabel: string;
}

interface TopologyResponse {
  zones: TopologyZoneData[];
  nodes: TopologyNodeData[];
  edges: TopologyEdgeData[];
}

interface AccessTarget {
  protocol: 'rdp' | 'ssh';
  host: string;
  port: number;
  username: string | null;
  hasCredential: boolean;
}

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'No role (generic)' },
  { value: 'domain_controller', label: 'Domain Controller' },
  { value: 'kali_attacker', label: 'Attacker (Kali)' },
  { value: 'siem', label: 'SIEM' },
  { value: 'web_server', label: 'Web Server' },
  { value: 'mail_server', label: 'Mail Server' },
  { value: 'database_server', label: 'Database' },
  { value: 'workstation', label: 'Workstation' },
  { value: 'linux_server', label: 'Linux Server' },
  { value: 'generic_server', label: 'Server' },
  { value: 'firewall', label: 'Firewall' },
  { value: 'internet_gateway', label: 'Internet' },
];

const STATUS_OPTIONS = ['', 'running', 'starting', 'stopping', 'stopped', 'error'];

const fieldStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
};

type Selection = { type: 'node'; id: number } | { type: 'zone'; id: number } | null;

export function TopologyAdminPage() {
  const queryClient = useQueryClient();
  const [cyberRangeId, setCyberRangeId] = useState<number | ''>('');
  const [showInfrastructure, setShowInfrastructure] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  // Bumped after Auto-arrange so the graph remounts and re-runs fitView on the new positions.
  const [layoutVersion, setLayoutVersion] = useState(0);

  const [newNodeLabel, setNewNodeLabel] = useState('');
  const [newNodeRole, setNewNodeRole] = useState('');
  const [newNodeZoneId, setNewNodeZoneId] = useState<number | ''>('');
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneCidr, setNewZoneCidr] = useState('');

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

  const allNodes = topologyData?.nodes ?? [];
  const allZones = topologyData?.zones ?? [];
  // Default instructor canvas = the same clean logical view students see. "Show infrastructure
  // resources" is an explicit, off-by-default diagnostic overlay — never the default experience.
  const visibleNodes = showInfrastructure ? allNodes : allNodes.filter((n) => !!n.isVisibleToStudents);

  const selectedNode = selection?.type === 'node' ? (allNodes.find((n) => n.id === selection.id) ?? null) : null;
  const selectedZone = selection?.type === 'zone' ? (allZones.find((z) => z.id === selection.id) ?? null) : null;

  const addNode = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/nodes`, {
        method: 'POST',
        body: JSON.stringify({
          label: newNodeLabel,
          nodeType: 'host',
          role: newNodeRole || null,
          zoneId: newNodeZoneId === '' ? null : newNodeZoneId,
        }),
      }),
    onSuccess: () => {
      setNewNodeLabel('');
      setNewNodeRole('');
      setNewNodeZoneId('');
      invalidate();
    },
  });

  const addZone = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/zones`, {
        method: 'POST',
        body: JSON.stringify({ name: newZoneName, cidr: newZoneCidr || null }),
      }),
    onSuccess: () => {
      setNewZoneName('');
      setNewZoneCidr('');
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

  const patchNode = useMutation({
    mutationFn: (patch: { nodeId: number; label?: string; role?: string; zoneId?: number; status?: string; isVisibleToStudents?: boolean }) =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/nodes/${patch.nodeId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: invalidate,
  });

  const deleteNode = useMutation({
    mutationFn: (nodeId: number) => apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/nodes/${nodeId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSelection(null);
      invalidate();
    },
    onError: (err) => window.alert(err instanceof Error ? err.message : 'Could not delete this node'),
  });

  const patchZone = useMutation({
    mutationFn: (patch: { zoneId: number; name?: string; cidr?: string }) =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/zones/${patch.zoneId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: invalidate,
  });

  const deleteZone = useMutation({
    mutationFn: (zoneId: number) => apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/zones/${zoneId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSelection(null);
      invalidate();
    },
  });

  const autoLayout = useMutation({
    mutationFn: () => apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/auto-layout`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['topology', cyberRangeId] });
      setLayoutVersion((v) => v + 1);
    },
    onError: (err) => window.alert(err instanceof Error ? err.message : 'Could not auto-arrange this topology'),
  });

  const connectMutation = useMutation({
    mutationFn: (params: { fromNodeId?: number; toNodeId?: number; fromZoneId?: number; toZoneId?: number }) =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/edges`, { method: 'POST', body: JSON.stringify(params) }),
    onSuccess: invalidate,
  });

  function handleAddNode(e: FormEvent) {
    e.preventDefault();
    if (!cyberRangeId || !newNodeLabel.trim()) return;
    addNode.mutate();
  }

  function handleAddZone(e: FormEvent) {
    e.preventDefault();
    if (!cyberRangeId || !newZoneName.trim()) return;
    addZone.mutate();
  }

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>Topology Admin</h1>

      <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
        <select value={cyberRangeId} onChange={(e) => { setCyberRangeId(e.target.value ? Number(e.target.value) : ''); setSelection(null); }} style={fieldStyle}>
          <option value="">Select a Cyber Range…</option>
          {rangesData?.cyberRanges.map((cr) => (
            <option key={cr.id} value={cr.id}>
              {cr.dayLabel} — {cr.name}
            </option>
          ))}
        </select>

        {cyberRangeId !== '' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={showInfrastructure} onChange={(e) => setShowInfrastructure(e.target.checked)} />
            Show infrastructure resources (diagnostics only)
          </label>
        )}

        {cyberRangeId !== '' && allNodes.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            style={{ marginLeft: 'auto', fontSize: 13, padding: '6px 12px' }}
            disabled={autoLayout.isPending}
            onClick={() => {
              if (window.confirm('Auto-arrange every node into a clean grid by zone? Manually dragged positions will be replaced.')) {
                autoLayout.mutate();
              }
            }}
          >
            {autoLayout.isPending ? 'Arranging…' : 'Auto-arrange'}
          </Button>
        )}
      </div>

      {cyberRangeId !== '' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: selection ? '1fr 300px' : '1fr', gap: 'var(--space-xl)' }}>
            <TopologyGraph
              key={`${cyberRangeId}:${layoutVersion}`}
              zones={allZones}
              nodes={visibleNodes}
              edges={topologyData?.edges ?? []}
              editable
              onNodeDragStop={(nodeId, x, y) => moveNode.mutate({ nodeId, posX: x, posY: y })}
              onNodeClick={(n) => setSelection({ type: 'node', id: n.id })}
              onZoneClick={(z) => setSelection({ type: 'zone', id: z.id })}
              onPaneClick={() => setSelection(null)}
              onConnect={(from, to) =>
                connectMutation.mutate({
                  fromNodeId: from.type === 'node' ? from.id : undefined,
                  fromZoneId: from.type === 'zone' ? from.id : undefined,
                  toNodeId: to.type === 'node' ? to.id : undefined,
                  toZoneId: to.type === 'zone' ? to.id : undefined,
                })
              }
            />

            {selectedNode && (
              <NodePanel
                key={selectedNode.id}
                node={selectedNode}
                zones={allZones}
                onClose={() => setSelection(null)}
                onSave={(patch) => patchNode.mutate({ nodeId: selectedNode.id, ...patch })}
                onDelete={() => {
                  if (window.confirm(`Delete "${selectedNode.label}"?`)) deleteNode.mutate(selectedNode.id);
                }}
                onAccessTargetChanged={invalidate}
              />
            )}

            {selectedZone && (
              <ZonePanel
                key={selectedZone.id}
                zone={selectedZone}
                memberCount={allNodes.filter((n) => n.zoneId === selectedZone.id).length}
                onClose={() => setSelection(null)}
                onSave={(patch) => patchZone.mutate({ zoneId: selectedZone.id, ...patch })}
                onDelete={() => {
                  if (window.confirm(`Delete zone "${selectedZone.name}"? Nodes inside it will be un-assigned, not deleted.`)) {
                    deleteZone.mutate(selectedZone.id);
                  }
                }}
              />
            )}
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-xl)', marginTop: 'var(--space-lg)' }}>
            <form onSubmit={handleAddNode} style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
              <input value={newNodeLabel} onChange={(e) => setNewNodeLabel(e.target.value)} placeholder="Label (e.g. DC01)" style={fieldStyle} />
              <select value={newNodeRole} onChange={(e) => setNewNodeRole(e.target.value)} style={fieldStyle}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select value={newNodeZoneId} onChange={(e) => setNewNodeZoneId(e.target.value ? Number(e.target.value) : '')} style={fieldStyle}>
                <option value="">No zone</option>
                {allZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="ghost">
                Add node
              </Button>
            </form>

            <form onSubmit={handleAddZone} style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
              <input value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} placeholder="Zone name (e.g. DMZ)" style={fieldStyle} />
              <input value={newZoneCidr} onChange={(e) => setNewZoneCidr(e.target.value)} placeholder="CIDR (optional)" style={fieldStyle} />
              <Button type="submit" variant="ghost">
                Add zone
              </Button>
            </form>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-telemetry)', marginTop: 6 }}>
            Drag between two cards (or a card and a zone) on the canvas to connect them — e.g. Internet → Firewall → Zone.
          </p>
        </>
      )}
    </div>
  );
}

function NodePanel({
  node,
  zones,
  onClose,
  onSave,
  onDelete,
  onAccessTargetChanged,
}: {
  node: TopologyNodeData;
  zones: TopologyZoneData[];
  onClose: () => void;
  onSave: (patch: { label?: string; role?: string; zoneId?: number; status?: string; isVisibleToStudents?: boolean }) => void;
  onDelete: () => void;
  onAccessTargetChanged: () => void;
}) {
  const [label, setLabel] = useState(node.label);
  const metadata = parseMetadata(node.metadataJson);
  const osType = metadata?.osType === 'Windows' || metadata?.osType === 'Linux' ? metadata.osType : null;

  const queryClient = useQueryClient();
  const [accessUsername, setAccessUsername] = useState('');
  const [accessPassword, setAccessPassword] = useState('');
  const [showRunScript, setShowRunScript] = useState(false);
  const [connectSession, setConnectSession] = useState<{ accessSessionId: number; shareableLinkUrl: string; expiresAt: string } | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const { data: accessTargetData } = useQuery({
    queryKey: ['access-target', node.id],
    queryFn: () => apiFetch<{ accessTarget: AccessTarget | null }>(`/admin/topology/nodes/${node.id}/access-target`),
  });

  // Protocol/host/port are no longer instructor-entered — Bastion auto-detects RDP vs SSH per VM, and
  // the server derives host from the node's own discovered IP (see admin/topology.routes.ts's PUT).
  const saveAccessTarget = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/topology/nodes/${node.id}/access-target`, {
        method: 'PUT',
        body: JSON.stringify({ username: accessUsername, password: accessPassword }),
      }),
    onSuccess: () => {
      setAccessPassword('');
      queryClient.invalidateQueries({ queryKey: ['access-target', node.id] });
      onAccessTargetChanged();
    },
  });

  const removeAccessTarget = useMutation({
    mutationFn: () => apiFetch(`/admin/topology/nodes/${node.id}/access-target`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-target', node.id] });
      onAccessTargetChanged();
    },
  });

  const connect = useMutation({
    mutationFn: () =>
      apiFetch<{ accessSessionId: number; shareableLinkUrl: string; expiresAt: string }>(`/admin/topology/nodes/${node.id}/connect`, { method: 'POST' }),
    onMutate: () => setConnectError(null),
    onSuccess: setConnectSession,
    onError: (err) => setConnectError(err instanceof ApiError ? err.message : 'Failed to start a session'),
  });

  const disconnect = useMutation({
    mutationFn: (accessSessionId: number) => apiFetch(`/admin/access-sessions/${accessSessionId}/force-close`, { method: 'POST' }),
    onSuccess: () => setConnectSession(null),
  });

  return (
    <div style={panelStyle}>
      <PanelHeader onClose={onClose} />

      <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== node.label && onSave({ label })} style={{ ...fieldStyle, width: '100%', fontSize: 15, fontWeight: 500, marginBottom: 10 }} />

      <Field label="Role">
        <select value={node.role ?? ''} onChange={(e) => onSave({ role: e.target.value })} style={{ ...fieldStyle, width: '100%' }}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Zone">
        <select value={node.zoneId ?? ''} onChange={(e) => e.target.value && onSave({ zoneId: Number(e.target.value) })} style={{ ...fieldStyle, width: '100%' }}>
          <option value="">No zone</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Status">
        <select value={node.status ?? ''} onChange={(e) => onSave({ status: e.target.value })} style={{ ...fieldStyle, width: '100%' }}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s || 'Unknown'}
            </option>
          ))}
        </select>
      </Field>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', margin: '10px 0' }}>
        <input type="checkbox" checked={!!node.isVisibleToStudents} onChange={(e) => onSave({ isVisibleToStudents: e.target.checked })} />
        Visible to students
      </label>

      {/* Admin-only diagnostics — the raw discovered metadata, never shown on the canvas itself. */}
      {metadata && (
        <details style={{ marginBottom: 10 }}>
          <summary style={{ fontSize: 12, color: 'var(--text-telemetry)', cursor: 'pointer' }}>Diagnostics</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
            {Object.entries(metadata).map(([key, value]) => (
              <div key={key} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--text-telemetry)' }}>{key}:</span> {formatMetadataValue(value)}
              </div>
            ))}
          </div>
        </details>
      )}

      <div style={{ borderTop: '1px solid var(--surface-border)', margin: '10px 0', paddingTop: 10 }}>
        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 6px' }}>Student browser access (Azure Bastion)</h3>
        {!node.environmentId && (
          <div style={{ fontSize: 12, color: 'var(--signal-tertiary)', marginBottom: 6 }}>
            This node isn't Azure-discovered — browser access needs a real VM behind Azure Bastion, so it can't be configured here.
          </div>
        )}
        {accessTargetData?.accessTarget && (
          <div style={{ fontSize: 12, color: 'var(--text-telemetry)', marginBottom: 6 }}>
            Currently: {accessTargetData.accessTarget.protocol.toUpperCase()} to {accessTargetData.accessTarget.host}, user{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{accessTargetData.accessTarget.username}</span> — protocol/host are auto-detected from
            the VM; leave username/password blank to keep the current credential (re-entering rotates it in Key Vault).
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={accessUsername} onChange={(e) => setAccessUsername(e.target.value)} placeholder="Login username" style={fieldStyle} />
          <input value={accessPassword} onChange={(e) => setAccessPassword(e.target.value)} placeholder="Login password" type="password" style={fieldStyle} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="ghost"
              disabled={saveAccessTarget.isPending || !node.environmentId || !accessUsername.trim() || !accessPassword.trim()}
              onClick={() => saveAccessTarget.mutate()}
            >
              Save
            </Button>
            {accessTargetData?.accessTarget && (
              <Button variant="destructive" onClick={() => removeAccessTarget.mutate()}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--surface-border)', margin: '10px 0', paddingTop: 10 }}>
        {connectSession ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            <a href={connectSession.shareableLinkUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <Button variant="primary" style={{ width: '100%' }}>
                Open connection
              </Button>
            </a>
            <div style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>Expires {new Date(connectSession.expiresAt).toLocaleTimeString()}</div>
            <Button variant="destructive" disabled={disconnect.isPending} onClick={() => disconnect.mutate(connectSession.accessSessionId)} style={{ width: '100%' }}>
              Disconnect
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            disabled={connect.isPending || !node.environmentId || !accessTargetData?.accessTarget}
            title={node.environmentId ? undefined : 'Connect needs an Azure-discovered VM'}
            onClick={() => connect.mutate()}
            style={{ width: '100%', marginBottom: 8 }}
          >
            {connect.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        )}
        {connectError && <div style={{ fontSize: 12, color: 'var(--signal-alert)', marginBottom: 8 }}>{connectError}</div>}

        <Button
          variant="ghost"
          disabled={!node.environmentId}
          title={node.environmentId ? undefined : 'Run Script needs an Azure-discovered VM'}
          onClick={() => setShowRunScript(true)}
          style={{ width: '100%', marginBottom: 8 }}
        >
          Run Script
        </Button>
        <Button variant="destructive" onClick={onDelete} style={{ width: '100%' }}>
          Delete node
        </Button>
      </div>

      {showRunScript && <RunScriptDrawer nodeId={node.id} nodeLabel={node.label} osType={osType} onClose={() => setShowRunScript(false)} />}
    </div>
  );
}

function ZonePanel({
  zone,
  memberCount,
  onClose,
  onSave,
  onDelete,
}: {
  zone: TopologyZoneData;
  memberCount: number;
  onClose: () => void;
  onSave: (patch: { name?: string; cidr?: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(zone.name);
  const [cidr, setCidr] = useState(zone.cidr ?? '');

  return (
    <div style={panelStyle}>
      <PanelHeader onClose={onClose} />
      <Field label="Zone name">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== zone.name && onSave({ name: name.trim() })} style={{ ...fieldStyle, width: '100%' }} />
      </Field>
      <Field label="CIDR">
        <input value={cidr} onChange={(e) => setCidr(e.target.value)} onBlur={() => cidr !== (zone.cidr ?? '') && onSave({ cidr })} style={{ ...fieldStyle, width: '100%' }} />
      </Field>
      <p style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>
        {memberCount} node{memberCount === 1 ? '' : 's'} in this zone.
        {zone.externalKey && ' Auto-created from an Azure subnet — the name is safe to change.'}
      </p>
      <Button variant="destructive" onClick={onDelete} style={{ width: '100%', marginTop: 8 }}>
        Delete zone
      </Button>
    </div>
  );
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>
        ×
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-telemetry)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-container)',
  padding: 'var(--space-md)',
  height: 'fit-content',
  maxHeight: 600,
  overflowY: 'auto',
};
