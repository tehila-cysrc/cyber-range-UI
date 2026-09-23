import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';

interface CloudEnvironment {
  id: number;
  provider: string;
  name: string;
  externalAccountId: string;
  externalScope: string | null;
  tenantId: string | null;
  clientId: string | null;
  hasSecret: boolean;
  discoveryMode: string;
  createdAt: string;
  createdByUsername: string | null;
}

interface ConnectivityResult {
  ok: boolean;
  latencyMs: number;
  resourceGroupId?: string;
  reason?: string;
  message?: string;
}

interface DiscoveryRun {
  id: number;
  environmentId: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  resourceCounts: Record<string, number> | null;
  errors: { message: string }[] | null;
}

interface LinkedCyberRange {
  cyberRangeId: number;
  name: string;
}

interface Day {
  id: number;
  key: string;
  label: string;
}

const inputStyle = {
  background: 'transparent',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
};

function runBadge(run: DiscoveryRun | undefined) {
  if (!run) return null;
  if (run.status === 'running' || run.status === 'queued') return <TelemetryBadge tone="secondary">Discovery: {run.status}…</TelemetryBadge>;
  if (run.status === 'succeeded') {
    const total = Object.values(run.resourceCounts ?? {}).reduce((a, b) => a + b, 0);
    return <TelemetryBadge tone="primary">Discovered {total} resources</TelemetryBadge>;
  }
  if (run.status === 'partial_failure') {
    const total = Object.values(run.resourceCounts ?? {}).reduce((a, b) => a + b, 0);
    return (
      <TelemetryBadge tone="secondary">
        Discovered {total} resources · {run.errors?.length ?? 0} warning(s)
      </TelemetryBadge>
    );
  }
  return <TelemetryBadge tone="alert">Discovery failed: {run.errors?.[0]?.message ?? 'unknown error'}</TelemetryBadge>;
}

function EditEnvironmentForm({ env, onCancel, onSaved }: { env: CloudEnvironment; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(env.name);
  const [externalAccountId, setExternalAccountId] = useState(env.externalAccountId);
  const [externalScope, setExternalScope] = useState(env.externalScope ?? '');
  const [tenantId, setTenantId] = useState(env.tenantId ?? '');
  const [clientId, setClientId] = useState(env.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/environments/${env.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          externalAccountId,
          externalScope: externalScope || null,
          tenantId,
          clientId,
          ...(clientSecret ? { clientSecret } : {}),
        }),
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save environment'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !externalAccountId.trim() || !tenantId.trim() || !clientId.trim()) {
      setError('Name, subscription/account id, tenant id and client id are all required');
      return;
    }
    save.mutate();
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={inputStyle} />
      <input
        value={externalAccountId}
        onChange={(e) => setExternalAccountId(e.target.value)}
        placeholder="Subscription ID"
        style={inputStyle}
      />
      <input value={externalScope} onChange={(e) => setExternalScope(e.target.value)} placeholder="Resource group" style={inputStyle} />
      <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Tenant ID" style={inputStyle} />
      <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID (Service Principal)" style={inputStyle} />
      <input
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        placeholder="Client secret (leave blank to keep unchanged)"
        type="password"
        style={inputStyle}
      />
      {error && <div style={{ color: 'var(--signal-alert)', fontSize: 14 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="submit" variant="ghost" disabled={save.isPending}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EnvironmentCard({
  env,
  checkResult,
  onCheckConnectivity,
  isChecking,
  onDelete,
}: {
  env: CloudEnvironment;
  checkResult?: ConnectivityResult;
  onCheckConnectivity: () => void;
  isChecking: boolean;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  const { data: runsData } = useQuery({
    queryKey: ['discovery-runs', env.id],
    queryFn: () => apiFetch<{ runs: DiscoveryRun[] }>(`/admin/environments/${env.id}/discovery-runs`),
    refetchInterval: (query) => (query.state.data?.runs[0]?.status === 'running' || query.state.data?.runs[0]?.status === 'queued' ? 1500 : false),
  });
  const latestRun = runsData?.runs[0];

  const { data: linkedData } = useQuery({
    queryKey: ['linked-cyber-ranges', env.id],
    queryFn: () => apiFetch<{ cyberRanges: LinkedCyberRange[] }>(`/admin/environments/${env.id}/linked-cyber-ranges`),
  });

  const discover = useMutation({
    mutationFn: () => apiFetch(`/admin/environments/${env.id}/discover`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discovery-runs', env.id] }),
  });

  const unlinkRange = useMutation({
    mutationFn: (cyberRangeId: number) => apiFetch(`/admin/cyber-ranges/${cyberRangeId}/environments/${env.id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['linked-cyber-ranges', env.id] }),
  });

  if (isEditing) {
    return (
      <div
        style={{
          padding: 'var(--space-md)',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-container)',
          background: 'var(--surface-1)',
        }}
      >
        <div style={{ marginBottom: 8, color: 'var(--text-muted)', fontSize: 13 }}>Editing {env.name}</div>
        <EditEnvironmentForm
          env={env}
          onCancel={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false);
            queryClient.invalidateQueries({ queryKey: ['admin-environments'] });
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 'var(--space-md)',
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-container)',
        background: 'var(--surface-1)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: 16 }}>{env.name}</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" disabled={isChecking} onClick={onCheckConnectivity}>
            Check connectivity
          </Button>
          <Button variant="ghost" disabled={discover.isPending || latestRun?.status === 'running'} onClick={() => discover.mutate()}>
            Discover now
          </Button>
          <Button variant="ghost" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
          <Button variant="destructive" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>
          {env.provider} · subscription <span className="tabular">{env.externalAccountId}</span>
        </span>
        {env.externalScope && <span>resource group: {env.externalScope}</span>}
      </div>

      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {checkResult &&
          (checkResult.ok ? (
            <TelemetryBadge tone="primary">Connected · {checkResult.latencyMs}ms</TelemetryBadge>
          ) : (
            <TelemetryBadge tone="alert">
              {checkResult.reason} · {checkResult.message}
            </TelemetryBadge>
          ))}
        {runBadge(latestRun)}
      </div>

      <div style={{ marginTop: 12, borderTop: '1px solid var(--surface-border)', paddingTop: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--text-telemetry)', marginBottom: 4 }}>Linked cyber ranges</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {linkedData?.cyberRanges.map((r) => (
            <span
              key={r.cyberRangeId}
              style={{
                fontSize: 13,
                color: 'var(--text-primary)',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-control)',
                padding: '2px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {r.name}
              <button
                onClick={() => unlinkRange.mutate(r.cyberRangeId)}
                style={{ background: 'none', border: 'none', color: 'var(--signal-alert)', cursor: 'pointer', fontSize: 12 }}
              >
                ×
              </button>
            </span>
          ))}
          {linkedData?.cyberRanges.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>none yet</span>}
        </div>
      </div>
    </div>
  );
}

// Registering a live cloud environment (Azure resource group today, other providers later) also
// creates and auto-links the Cyber Range whose topology it populates in the same step — the seeded
// catalog is just a starting point, not a fixed list to pick from. Also lets an instructor check
// connectivity and trigger Azure Resource Graph discovery — Phases 1-2 of the live-environment plan.
export function EnvironmentsAdminPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [dayId, setDayId] = useState<number | ''>('');
  const [difficulty, setDifficulty] = useState<'intermediate' | 'advanced' | ''>('');
  const [expectedDurationMinutes, setExpectedDurationMinutes] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [externalScope, setExternalScope] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Record<number, ConnectivityResult>>({});

  const { data } = useQuery({
    queryKey: ['admin-environments'],
    queryFn: () => apiFetch<{ environments: CloudEnvironment[] }>('/admin/environments'),
  });

  const { data: daysData } = useQuery({
    queryKey: ['days'],
    queryFn: () => apiFetch<{ days: Day[] }>('/admin/days'),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-environments'] });
  }

  // Registering an environment now also creates its Cyber Range in one step — the seeded catalog is
  // just a starting point, not a fixed list; an instructor names a new Cyber Range every time they
  // register an environment for it, then this links the two automatically (no separate "pick an
  // existing range and link it" step).
  const createEnvironment = useMutation({
    mutationFn: async () => {
      const { cyberRange } = await apiFetch<{ cyberRange: { id: number } }>('/admin/cyber-ranges', {
        method: 'POST',
        body: JSON.stringify({
          dayId,
          name,
          difficulty,
          expectedDurationMinutes: expectedDurationMinutes ? Number(expectedDurationMinutes) : undefined,
        }),
      });

      const { environment } = await apiFetch<{ environment: { id: number } }>('/admin/environments', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'azure',
          name,
          externalAccountId,
          externalScope: externalScope || undefined,
          tenantId,
          clientId,
          clientSecret,
        }),
      });

      await apiFetch(`/admin/cyber-ranges/${cyberRange.id}/environments`, {
        method: 'POST',
        body: JSON.stringify({ environmentId: environment.id }),
      });
    },
    onSuccess: () => {
      setName('');
      setDayId('');
      setDifficulty('');
      setExpectedDurationMinutes('');
      setExternalAccountId('');
      setExternalScope('');
      setTenantId('');
      setClientId('');
      setClientSecret('');
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to register environment'),
  });

  const deleteEnvironment = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/environments/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const checkConnectivity = useMutation({
    mutationFn: (id: number) => apiFetch<ConnectivityResult>(`/admin/environments/${id}/connectivity-check`, { method: 'POST' }),
    onSuccess: (result, id) => setCheckResults((prev) => ({ ...prev, [id]: result })),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (
      !name.trim() ||
      !dayId ||
      !difficulty ||
      !externalAccountId.trim() ||
      !tenantId.trim() ||
      !clientId.trim() ||
      !clientSecret.trim()
    ) {
      setError('Name, type, difficulty, subscription/account id, tenant id, client id and client secret are all required');
      return;
    }
    createEnvironment.mutate();
  }

  return (
    <div style={{ padding: 'var(--space-xl)', display: 'grid', gridTemplateColumns: '60% 40%', gap: 'var(--space-xl)' }}>
      <div>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>Cloud Environments</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {data?.environments.map((env) => (
            <EnvironmentCard
              key={env.id}
              env={env}
              checkResult={checkResults[env.id]}
              isChecking={checkConnectivity.isPending}
              onCheckConnectivity={() => checkConnectivity.mutate(env.id)}
              onDelete={() => {
                // Deleting an environment removes every topology node it discovered for its linked
                // cyber ranges — mid-exercise that blanks the students' topology view.
                if (
                  window.confirm(
                    `Delete environment "${env.name}"?\n\nIts stored credential is deleted and every topology node it discovered is removed from the linked cyber range(s). Students on those ranges lose those hosts from their Topology view. This cannot be undone.`,
                  )
                ) {
                  deleteEnvironment.mutate(env.id);
                }
              }}
            />
          ))}
          {data?.environments.length === 0 && (
            <div style={{ fontSize: 14, color: 'var(--text-telemetry)' }}>No cloud environments registered yet.</div>
          )}
        </div>
      </div>

      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>Register Azure environment</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cyber Range name (e.g. Contoso Breach)" style={inputStyle} />
        <select
          value={dayId}
          onChange={(e) => setDayId(e.target.value ? Number(e.target.value) : '')}
          style={{ ...inputStyle, background: 'var(--surface-1)' }}
        >
          <option value="">Type…</option>
          {daysData?.days.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as 'intermediate' | 'advanced' | '')}
          style={{ ...inputStyle, background: 'var(--surface-1)' }}
        >
          <option value="">Difficulty…</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
        <input
          value={expectedDurationMinutes}
          onChange={(e) => setExpectedDurationMinutes(e.target.value)}
          placeholder="Expected duration (minutes, optional)"
          type="number"
          min="1"
          style={inputStyle}
        />
        <input value={externalAccountId} onChange={(e) => setExternalAccountId(e.target.value)} placeholder="Subscription ID" style={inputStyle} />
        <input value={externalScope} onChange={(e) => setExternalScope(e.target.value)} placeholder="Resource group" style={inputStyle} />
        <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Tenant ID" style={inputStyle} />
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID (Service Principal)" style={inputStyle} />
        <input
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="Client secret"
          type="password"
          style={inputStyle}
        />
        {error && <div style={{ color: 'var(--signal-alert)', fontSize: 14 }}>{error}</div>}
        <Button type="submit" variant="ghost" disabled={createEnvironment.isPending}>
          Register environment
        </Button>
      </form>
    </div>
  );
}
