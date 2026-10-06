import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ScenarioSideNav, useSelectedScenario } from '../../scenarios/ScenarioSideNav';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../../lib/apiClient';
import { Button } from '../../../components/Button';
import { confirmAction } from '../../../components/ConfirmDialog';
import { useToastStore } from '../../../stores/toastStore';
import {
  TopologyGraph,
  formatMetadataValue,
  parseMetadata,
  type TopologyEdgeData,
  type TopologyNodeData,
  type TopologyZoneData,
} from '../TopologyGraph';
import { RunScriptDrawer } from './RunScriptDrawer';
import { PublicationBar } from './PublicationBar';

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

// The scenario list can be hidden to give the canvas the full width; remembered per browser.
const LIST_HIDDEN_KEY = 'topology-admin:list-hidden';
function readListHidden() {
  try {
    return localStorage.getItem(LIST_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function TopologyAdminPage() {
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const [listHidden, setListHidden] = useState(readListHidden);
  function toggleList() {
    setListHidden((hidden) => {
      try {
        localStorage.setItem(LIST_HIDDEN_KEY, hidden ? '0' : '1');
      } catch {
        // private window / blocked storage — the toggle still works for this visit
      }
      return !hidden;
    });
  }
  const [showInfrastructure, setShowInfrastructure] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  // Bumped after Auto-arrange and after adding a node/zone so the graph remounts and re-runs fitView
  // on the new positions — a newly added card used to land off-screen or clipped.
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
  const [cyberRangeId, setCyberRangeId] = useSelectedScenario(rangesData?.cyberRanges);

  const { data: topologyData, dataUpdatedAt: topologyVersion } = useQuery({
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
    onSuccess: async () => {
      setNewNodeLabel('');
      setNewNodeRole('');
      setNewNodeZoneId('');
      await queryClient.invalidateQueries({ queryKey: ['topology', cyberRangeId] });
      setLayoutVersion((v) => v + 1);
    },
  });

  const addZone = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/topology/zones`, {
        method: 'POST',
        body: JSON.stringify({ name: newZoneName, cidr: newZoneCidr || null }),
      }),
    onSuccess: async () => {
      setNewZoneName('');
      setNewZoneCidr('');
      await queryClient.invalidateQueries({ queryKey: ['topology', cyberRangeId] });
      setLayoutVersion((v) => v + 1);
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
    onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not delete this node'),
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
    onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not auto-arrange this topology'),
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

  const selectedRange = rangesData?.cyberRanges.find((cr) => cr.id === cyberRangeId);

  return (
    <div className={`side-layout${listHidden ? ' side-layout--collapsed' : ''}`} style={{ padding: 'var(--space-xl)' }}>
      <aside>
        <ScenarioSideNav
          ranges={rangesData?.cyberRanges ?? []}
          activeId={cyberRangeId}
          onSelect={(id) => {
            setCyberRangeId(id);
            setSelection(null);
          }}
        />
      </aside>
      <main style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-md)', flexWrap: 'wrap', margin: '0 0 var(--space-md)' }}>
        <button
          type="button"
          onClick={toggleList}
          aria-pressed={!listHidden}
          title={listHidden ? 'Show the scenario list' : 'Hide the scenario list (wider canvas)'}
          style={{ background: 'none', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-control)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: '4px 10px' }}
        >
          {listHidden ? '☰ Scenarios' : '⟨ Hide list'}
        </button>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>Topology Admin</h1>
        {selectedRange && (
          <span style={{ fontSize: 15, color: 'var(--text-muted)' }}>
            · <bdi>{selectedRange.dayLabel} — {selectedRange.name}</bdi>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
        {rangesData && rangesData.cyberRanges.length === 0 && (
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            No scenarios yet — create one on the <Link to="/admin/scenarios" style={{ color: 'var(--signal-secondary)' }}>Scenarios</Link> page.
          </span>
        )}

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
            onClick={async () => {
              const ok = await confirmAction({
                title: 'Auto-arrange every node?',
                message: 'Nodes are laid out in a clean grid by zone. Positions you dragged by hand are replaced.',
                confirmLabel: 'Auto-arrange',
              });
              if (ok) autoLayout.mutate();
            }}
          >
            {autoLayout.isPending ? 'Arranging…' : 'Auto-arrange'}
          </Button>
        )}
      </div>

      {cyberRangeId !== '' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm) var(--space-xl)' }}>
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
          <p style={{ fontSize: 12, color: 'var(--text-telemetry)', margin: '6px 0 var(--space-md)' }}>
            Drag between two cards (or a card and a zone) on the canvas to connect them — e.g. Internet → Firewall → Zone.
          </p>
          {topologyData && allNodes.length === 0 && allZones.length === 0 && (
            <div
              role="status"
              style={{
                marginBottom: 'var(--space-md)',
                padding: 'var(--space-md)',
                border: '1px dashed var(--surface-border-strong)',
                borderRadius: 'var(--radius-container)',
                color: 'var(--text-muted)',
                fontSize: 14,
              }}
            >
              This Cyber Range has no machines yet. If it's linked to an Azure environment, run{' '}
              <strong>Discover now</strong> on the{' '}
              <Link to="/admin/environments" style={{ color: 'var(--signal-secondary)' }}>
                Environments
              </Link>{' '}
              page; otherwise add zones and nodes by hand above.
            </div>
          )}
          <PublicationBar
            cyberRangeId={cyberRangeId}
            draftVersion={topologyVersion}
            visibleNodeCount={allNodes.filter((n) => !!n.isVisibleToStudents).length}
          />
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
                onDelete={async () => {
                  const ok = await confirmAction({
                    title: `Delete "${selectedNode.label}"?`,
                    message: 'It disappears from this topology for students too.',
                    confirmLabel: 'Delete node',
                    danger: true,
                  });
                  if (ok) deleteNode.mutate(selectedNode.id);
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
                onDelete={async () => {
                  const ok = await confirmAction({
                    title: `Delete zone "${selectedZone.name}"?`,
                    message: 'Nodes inside it are un-assigned, not deleted.',
                    confirmLabel: 'Delete zone',
                    danger: true,
                  });
                  if (ok) deleteZone.mutate(selectedZone.id);
                }}
              />
            )}
          </div>

        </>
      )}
      </main>
    </div>
  );
}

function VmPowerControls({ nodeId, label, enabled }: { nodeId: number; label: string; enabled: boolean }) {
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const seenStatus = useRef<string | undefined>(undefined);

  const { data } = useQuery({
    enabled,
    queryKey: ['node-power', nodeId],
    queryFn: () =>
      apiFetch<{ operation: { action: 'start' | 'stop'; status: 'running' | 'succeeded' | 'failed'; message: string | null } | null }>(
        `/admin/topology/nodes/${nodeId}/power`,
      ),
    refetchInterval: (query) => (query.state.data?.operation?.status === 'running' ? 2000 : false),
  });
  const operation = data?.operation ?? null;

  useEffect(() => {
    const status = operation?.status;
    if (seenStatus.current === 'running' && status && status !== 'running') {
      queryClient.invalidateQueries({ queryKey: ['topology'] });
      if (status === 'succeeded') {
        pushToast(operation.action === 'start' ? `${label} is running.` : `${label} is stopped.`, 'success');
      } else {
        pushToast(operation.message ?? `Could not change power for ${label}.`, 'error');
      }
    }
    seenStatus.current = status;
  }, [operation, label, pushToast, queryClient]);

  const power = useMutation({
    mutationFn: (action: 'start' | 'stop') =>
      apiFetch(`/admin/topology/nodes/${nodeId}/power`, { method: 'POST', body: JSON.stringify({ action }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-power', nodeId] });
      queryClient.invalidateQueries({ queryKey: ['topology'] });
    },
    onError: (err) => pushToast(err instanceof ApiError ? err.message : `Could not change power for ${label}`),
  });

  async function handlePower(action: 'start' | 'stop') {
    const starting = action === 'start';
    const ok = await confirmAction({
      title: starting ? `Start ${label}?` : `Stop ${label}?`,
      message: starting ? 'This virtual machine will be started.' : 'This virtual machine will be stopped and deallocated. Compute shuts down.',
      confirmLabel: starting ? 'Start' : 'Stop',
      danger: !starting,
    });
    if (ok) power.mutate(action);
  }

  const busy = power.isPending || operation?.status === 'running';

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="primary"
          disabled={!enabled || busy}
          title={enabled ? undefined : 'Start needs an Azure-discovered virtual machine'}
          onClick={() => handlePower('start')}
          style={{ flex: 1 }}
        >
          {busy && operation?.action === 'start' ? 'Starting…' : 'Start'}
        </Button>
        <Button
          variant="destructive"
          disabled={!enabled || busy}
          title={enabled ? undefined : 'Stop needs an Azure-discovered virtual machine'}
          onClick={() => handlePower('stop')}
          style={{ flex: 1 }}
        >
          {busy && operation?.action === 'stop' ? 'Stopping…' : 'Stop'}
        </Button>
      </div>
      {operation?.status === 'failed' && (
        <div style={{ fontSize: 12, color: 'var(--signal-alert)', marginTop: 6 }}>{operation.message ?? 'Start/stop failed'}</div>
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
  const privateIp = typeof metadata?.privateIpAddress === 'string' ? metadata.privateIpAddress : null;

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

      {/* Shown to students too (TopologyViewerPage) once published — the instructor needs it on hand, not buried in Diagnostics. */}
      {privateIp && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, fontSize: 13 }}>
          <span style={{ color: 'var(--text-telemetry)', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Internal IP
          </span>
          <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', userSelect: 'all' }}>{privateIp}</span>
        </div>
      )}

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

      {node.nodeType === 'vm' && <VmPowerControls nodeId={node.id} label={node.label} enabled={!!node.environmentId} />}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', margin: '10px 0' }}>
        <input type="checkbox" checked={!!node.isVisibleToStudents} onChange={(e) => onSave({ isVisibleToStudents: e.target.checked })} />
        Include for students when publishing
      </label>
      <div style={{ fontSize: 12, color: 'var(--text-telemetry)', marginBottom: 10 }}>
        Name, role, zone, status and visibility save as soon as you change them.
      </div>

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
        {!!node.environmentId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={accessUsername} onChange={(e) => setAccessUsername(e.target.value)} placeholder="Login username" style={fieldStyle} />
          <input value={accessPassword} onChange={(e) => setAccessPassword(e.target.value)} placeholder="Login password" type="password" style={fieldStyle} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="ghost"
              disabled={saveAccessTarget.isPending || !node.environmentId || !accessUsername.trim() || !accessPassword.trim()}
              onClick={() => saveAccessTarget.mutate()}
            >
              Save credential
            </Button>
            {accessTargetData?.accessTarget && (
              <Button variant="destructive" onClick={() => removeAccessTarget.mutate()}>
                Remove
              </Button>
            )}
          </div>
        </div>
        )}
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
