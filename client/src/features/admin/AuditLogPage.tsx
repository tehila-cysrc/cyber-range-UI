import { useEffect, useState } from 'react';
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

// Plain-language labels — the raw codes ("TTP.EXPECTED_UPDATED") read like a developer log.
const ACTION_LABELS: Record<string, string> = {
  'access_session.credential_revealed': 'Revealed a VM login',
  'access_session.denied': 'Remote access denied',
  'access_session.ended': 'Remote session ended',
  'access_session.requested': 'Remote session started',
  'access_session.restored': 'Remote session restored',
  'access_target.configured': 'Configured VM login',
  'access_target.removed': 'Removed VM login',
  'environment.connectivity_checked': 'Checked environment connection',
  'environment.credential_rotated': 'Rotated environment credential',
  'environment.deleted': 'Deleted environment',
  'environment.discovery_completed': 'Discovery finished',
  'environment.discovery_triggered': 'Started discovery',
  'environment.linked': 'Linked environment to a range',
  'environment.registered': 'Registered environment',
  'environment.unlinked': 'Unlinked environment from a range',
  'environment.updated': 'Updated environment',
  'event.remote_access_revoked': 'Revoked remote access (event reset)',
  'event.reset_with_unverified_remote_access': 'Reset with unverified remote access',
  'registration.closed': 'Closed self-registration',
  'script.created': 'Created script',
  'script.deleted': 'Deleted script',
  'script.execution_finished': 'Script run finished',
  'script.execution_started': 'Started script run',
  'script.updated': 'Updated script',
  'topology.auto_layout': 'Auto-arranged topology',
  'ttp.credit_voided': 'Voided an ATT&CK credit',
  'ttp.expected_created': 'Added expected technique',
  'ttp.expected_deleted': 'Removed expected technique',
  'ttp.expected_updated': 'Edited expected technique',
  'ttp.manual_credit': 'Credited a technique manually',
  'ttp.occurrence_deleted': 'Deleted a technique occurrence',
  'ttp.occurrence_recorded': 'Recorded a technique occurrence',
};

function formatDetailValue(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.map(formatDetailValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setBeforeStack([]);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [beforeStack, setBeforeStack] = useState<number[]>([]);

  const before = beforeStack[beforeStack.length - 1];

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-log', entityType, before, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (entityType) params.set('entityType', entityType);
      if (search) params.set('search', search);
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
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-md)' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>Audit Log</h1>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search user, action or details (e.g. T1003)"
          aria-label="Search the audit log"
          style={{
            minWidth: 260,
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
            padding: 8,
            color: 'var(--text-primary)',
          }}
        />
        <select
          value={entityType}
          aria-label="Filter by entity type"
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
          <option value="cyber_range">Cyber ranges (topology layout)</option>
          <option value="script">Scripts / Run Script</option>
          <option value="expected_ttp">ATT&amp;CK expected techniques</option>
          <option value="ttp_detection">ATT&amp;CK credits</option>
          <option value="event_run">Event (reset, registration)</option>
        </select>
        </span>
      </div>

      {isLoading && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}
      {isError && <div style={{ color: 'var(--signal-alert)' }}>Couldn't load the audit log — try refreshing.</div>}

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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 15, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                <TelemetryBadge tone={toneForAction(entry.action)}>{ACTION_LABELS[entry.action] ?? entry.action}</TelemetryBadge>
              </span>
              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <span style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '2px 12px', overflowWrap: 'anywhere' }}>
                  {Object.entries(entry.metadata).map(([key, value]) => (
                    <span key={key}>
                      <span style={{ color: 'var(--text-telemetry)' }}>{key}:</span> {formatDetailValue(value)}
                    </span>
                  ))}
                </span>
              )}
              <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
                {entry.actorUsername ?? 'system'} · {new Date(entry.createdAt).toLocaleString()} · {entry.entityType}
                {entry.entityId != null ? ` #${entry.entityId}` : ''}
              </span>
            </div>
          </div>
        ))}
        {data?.entries.length === 0 && <div style={{ fontSize: 14, color: 'var(--text-telemetry)' }}>{search || entityType ? 'No entries match.' : 'No audit entries yet.'}</div>}
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
