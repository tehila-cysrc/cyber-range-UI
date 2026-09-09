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

const inputStyle = {
  background: 'transparent',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
};

// Registers a live cloud environment (Azure resource group today, other providers later) so an
// instructor can verify connectivity to it — Phase 1 of the live-environment integration plan.
// Discovery/topology/access-broker phases build on top of this registration, not part of this page.
export function EnvironmentsAdminPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
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

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-environments'] });
  }

  const createEnvironment = useMutation({
    mutationFn: () =>
      apiFetch('/admin/environments', {
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
      }),
    onSuccess: () => {
      setName('');
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
    if (!name.trim() || !externalAccountId.trim() || !tenantId.trim() || !clientId.trim() || !clientSecret.trim()) {
      setError('Name, subscription/account id, tenant id, client id and client secret are all required');
      return;
    }
    createEnvironment.mutate();
  }

  return (
    <div style={{ padding: 'var(--space-xl)', display: 'grid', gridTemplateColumns: '60% 40%', gap: 'var(--space-xl)' }}>
      <div>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>Cloud Environments</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {data?.environments.map((env) => {
            const result = checkResults[env.id];
            return (
              <div
                key={env.id}
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
                    <Button variant="ghost" disabled={checkConnectivity.isPending} onClick={() => checkConnectivity.mutate(env.id)}>
                      Check connectivity
                    </Button>
                    <Button variant="destructive" onClick={() => deleteEnvironment.mutate(env.id)}>
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
                {result && (
                  <div style={{ marginTop: 8 }}>
                    {result.ok ? (
                      <TelemetryBadge tone="primary">Connected · {result.latencyMs}ms</TelemetryBadge>
                    ) : (
                      <TelemetryBadge tone="alert">
                        {result.reason} · {result.message}
                      </TelemetryBadge>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {data?.environments.length === 0 && (
            <div style={{ fontSize: 14, color: 'var(--text-telemetry)' }}>No cloud environments registered yet.</div>
          )}
        </div>
      </div>

      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>Register Azure environment</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. AI Day)" style={inputStyle} />
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
