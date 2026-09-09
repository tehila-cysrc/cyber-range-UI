import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Button } from '../../components/Button';

interface AuditLogEntry {
  id: number;
  actorUsername: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

function toneForAction(action: string): 'primary' | 'alert' | 'secondary' {
  if (action.endsWith('.denied')) return 'alert';
  if (action.endsWith('.deleted') || action.endsWith('.removed')) return 'alert';
  return action.includes('credential') ? 'secondary' : 'primary';
}

// Read-only view of the compliance trail (Phase 5) — every environment/credential/discovery/
// access-session action recorded by writeAudit() across Phases 1-4. CONFIG data, so this survives
// an event reset by design (see CLAUDE/invariants.md).
export function AuditLogPage() {
  const [entityType, setEntityType] = useState('');
  const [beforeStack, setBeforeStack] = useState<number[]>([]);

  const before = beforeStack[beforeStack.length - 1];

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', entityType, before],
    queryFn: () => {
      const params = new URLSearchParams();
      if (entityType) params.set('entityType', entityType);
      if (before) params.set('before', String(before));
      return apiFetch<{ entries: AuditLogEntry[] }>(`/admin/audit-log?${params.toString()}`);
    },
  });

  function handleFilterChange(value: string) {
    setEntityType(value);
    setBeforeStack([]);
  }

  function nextPage() {
    const last = data?.entries[data.entries.length - 1];
    if (last) setBeforeStack((s) => [...s, last.id]);
  }

  function prevPage() {
    setBeforeStack((s) => s.slice(0, -1));
  }

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-md)' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>Audit Log</h1>
        <select
          value={entityType}
          onChange={(e) => handleFilterChange(e.target.value)}
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
            padding: 8,
            color: 'var(--text-primary)',
          }}
        >
          <option value="">All entity types</option>
          <option value="cloud_environment">Cloud environments</option>
          <option value="topology_node">Topology nodes / access targets</option>
          <option value="access_session">Access sessions</option>
          <option value="cyber_range_environment">Environment ↔ range links</option>
        </select>
      </div>

      {isLoading && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {data?.entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-sm) var(--space-md)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-control)',
              background: 'var(--surface-1)',
              gap: 'var(--space-md)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>
                <TelemetryBadge tone={toneForAction(entry.action)}>{entry.action}</TelemetryBadge>{' '}
                {entry.entityType}
                {entry.entityId != null ? ` #${entry.entityId}` : ''}
                {entry.metadata && <span style={{ color: 'var(--text-muted)' }}> · {JSON.stringify(entry.metadata)}</span>}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>
                {entry.actorUsername ?? 'system'} · {new Date(entry.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
        {data?.entries.length === 0 && <div style={{ fontSize: 14, color: 'var(--text-telemetry)' }}>No audit entries yet.</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-md)' }}>
        <Button variant="ghost" disabled={beforeStack.length === 0} onClick={prevPage}>
          ← Newer
        </Button>
        <Button variant="ghost" disabled={!data || data.entries.length < 100} onClick={nextPage}>
          Older →
        </Button>
      </div>
    </div>
  );
}
