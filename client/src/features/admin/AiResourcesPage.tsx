import { useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { confirmAction } from '../../components/ConfirmDialog';
import { useToastStore } from '../../stores/toastStore';

// Admin "AI resources" (platform phase P1, 2026-10-18; BACKLOG "Admin Foundry resource cleanup screen").
// - AI configuration: setting names and the pinned agent version (never values or secrets).
// - Tracked resources: the Foundry files / vector stores this app created (ai_foundry_resources).
//   Cleanup is explicit: nothing preselected, only unused candidates are selectable, a confirmation lists
//   the exact Foundry ids, the server re-checks every id, and results are shown per id. Never automatic.
// - Foundry inventory: a READ-ONLY listing of the project, loaded only on request, marking what this app
//   does not track (test resources made by scripts, other stores). Untracked items cannot be deleted here.

interface AiConfigView {
  switchOn: boolean;
  configured: boolean;
  enabled: boolean;
  missing: string[];
  agentName: string | null;
  agentVersion: string | null;
  requestTimeoutMs: number;
  maxConcurrent: number;
  acceptedContractVersions: string[];
}

type CleanupReason = 'document_deleted' | 'superseded_unpinned' | 'failed_version' | 'replaced_attempt';
interface FoundryResource {
  id: number;
  kind: 'file' | 'vector_store';
  foundryId: string;
  cyberRangeId: number | null;
  scenarioName: string | null;
  documentId: number | null;
  documentVersion: number | null;
  documentStatus: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteError: string | null;
  inUse: boolean;
  cleanupReason: CleanupReason | null;
}
interface CleanupOutcome {
  deleted: { id: number; kind: string; foundryId: string }[];
  failed: { id: number; kind: string; foundryId: string; errorCode: string }[];
}
interface Tracked {
  id: number;
  scenarioName: string | null;
  documentVersion: number | null;
  inUse: boolean;
  cleanupReason: CleanupReason | null;
  deleted: boolean;
}
interface Inventory {
  fetchedAt: string;
  agentName: string | null;
  pinnedVersion: string | null;
  vectorStores: { id: string; name: string | null; status: string | null; createdAt: string | null; usageBytes: number | null; fileCount: number | null; tracked: Tracked | null }[];
  files: { id: string; filename: string | null; bytes: number | null; purpose: string | null; createdAt: string | null; tracked: Tracked | null }[];
  agentVersions: { version: string; description: string | null; createdAt: string | null; pinned: boolean }[];
  truncated: { vectorStores: boolean; files: boolean; agentVersions: boolean };
  missingFromFoundry: { id: number; kind: string; foundryId: string }[];
}

const REASON: Record<CleanupReason, string> = {
  document_deleted: 'Scenario or document deleted',
  superseded_unpinned: 'Replaced version, no session uses it',
  failed_version: 'Failed upload',
  replaced_attempt: 'Earlier attempt (retried)',
};
const KIND: Record<FoundryResource['kind'], string> = { file: 'File', vector_store: 'Vector store' };

const card: CSSProperties = { background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-card, 8px)', padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' };
const th: CSSProperties = { textAlign: 'left', fontSize: 12, color: 'var(--text-telemetry)', fontWeight: 500, padding: '6px 8px', borderBottom: '1px solid var(--surface-border)' };
const td: CSSProperties = { fontSize: 14, color: 'var(--text-primary)', padding: '6px 8px', borderBottom: '1px solid var(--surface-border)', verticalAlign: 'top' };
const mono: CSSProperties = { fontFamily: 'var(--font-mono, monospace)', fontSize: 13 };
const muted: CSSProperties = { fontSize: 13, color: 'var(--text-muted)' };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const errText = (e: unknown) => (e instanceof ApiError ? `${e.message}${e.reason ? ` (${e.reason})` : ''}` : 'Request failed');

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, margin: 0, color: 'var(--text-primary)' }}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function ConfigCard() {
  const { data, isError } = useQuery({ queryKey: ['ai-config'], queryFn: () => apiFetch<{ config: AiConfigView }>('/admin/ai/config') });
  const c = data?.config;
  return (
    <Card title="AI configuration">
      {isError && <span style={muted}>Could not load the configuration.</span>}
      {c && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <TelemetryBadge tone={c.enabled ? 'primary' : 'muted'}>{c.enabled ? 'AI assessment enabled' : 'AI assessment off'}</TelemetryBadge>
            <TelemetryBadge tone={c.switchOn ? 'secondary' : 'muted'}>Switch {c.switchOn ? 'on' : 'off'}</TelemetryBadge>
            <TelemetryBadge tone={c.configured ? 'secondary' : 'alert'}>{c.configured ? 'Configured' : 'Not configured'}</TelemetryBadge>
          </div>
          <div style={muted}>
            Agent <span style={mono}>{c.agentName ?? '—'}</span>, pinned version <span style={mono}>{c.agentVersion ?? 'none (AI stays off)'}</span> · accepted reply contracts{' '}
            {c.acceptedContractVersions.join(', ')} · timeout {Math.round(c.requestTimeoutMs / 1000)} s · up to {c.maxConcurrent} jobs at a time
          </div>
          {c.missing.length > 0 && <div style={{ fontSize: 13, color: 'var(--signal-alert)' }}>Missing or invalid settings: {c.missing.join(', ')}</div>}
          <div style={muted}>Settings come from the server environment; they are changed by redeploying, not here.</div>
        </>
      )}
    </Card>
  );
}

function TrackedCard() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [outcome, setOutcome] = useState<CleanupOutcome | null>(null);
  const state = showAll ? 'all' : 'candidates';
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ai-foundry-resources', state],
    queryFn: () => apiFetch<{ resources: FoundryResource[] }>(`/admin/ai/foundry-resources?state=${state}`),
  });
  const rows = data?.resources ?? [];
  const selectable = (r: FoundryResource) => r.cleanupReason !== null;
  const chosen = rows.filter((r) => selected.has(r.id) && selectable(r));

  const cleanup = useMutation({
    mutationFn: (ids: number[]) => apiFetch<CleanupOutcome>('/admin/ai/foundry-resources/cleanup', { method: 'POST', body: JSON.stringify({ resourceIds: ids }) }),
    onSuccess: (res) => {
      setOutcome(res);
      setSelected(new Set());
      push(`${res.deleted.length} deleted, ${res.failed.length} failed.`, res.failed.length ? 'error' : 'success');
    },
    onError: (e) => push(`Cleanup refused: ${errText(e)}`, 'error'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['ai-foundry-resources'] });
      void qc.invalidateQueries({ queryKey: ['ai-foundry-inventory'] });
    },
  });

  async function onDelete() {
    if (!chosen.length) return;
    const list = chosen.map((r) => `• ${KIND[r.kind]} ${r.foundryId} — ${r.scenarioName ?? 'deleted scenario'}${r.documentVersion ? ` v${r.documentVersion}` : ''}`).join('\n');
    const ok = await confirmAction({
      title: `Permanently delete ${chosen.length} Foundry resource${chosen.length === 1 ? '' : 's'}?`,
      message: `These exact resources will be deleted in Microsoft Foundry. This cannot be undone. The server re-checks that each one is still unused.\n\n${list}`,
      confirmLabel: 'Delete in Foundry',
      danger: true,
      requireText: 'DELETE',
    });
    if (ok) cleanup.mutate(chosen.map((r) => r.id));
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Card
      title="Tracked Foundry resources"
      right={
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); setSelected(new Set()); }} /> Show all (in use and deleted)
          </label>
          <Button variant="destructive" disabled={!chosen.length || cleanup.isPending} onClick={() => void onDelete()}>
            {cleanup.isPending ? 'Deleting…' : `Delete selected (${chosen.length})`}
          </Button>
        </span>
      }
    >
      <div style={muted}>
        Files and vector stores this app created for scenario reference documents. Only unused resources can be selected; nothing is ever deleted automatically.
      </div>
      {isLoading && <span style={muted}>Loading…</span>}
      {isError && <span style={muted}>Could not load the resources.</span>}
      {!isLoading && !isError && rows.length === 0 && <span style={muted}>{showAll ? 'This app has not created any Foundry resources yet.' : 'No cleanup candidates. Everything tracked is in use or already deleted.'}</span>}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th} aria-label="Select" />
                <th style={th}>Kind</th>
                <th style={th}>Foundry id</th>
                <th style={th}>Scenario · version</th>
                <th style={th}>Status</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    {selectable(r) && <input type="checkbox" aria-label={`Select ${r.foundryId}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                  </td>
                  <td style={td}>{KIND[r.kind]}</td>
                  <td style={{ ...td, ...mono }}>{r.foundryId}</td>
                  <td style={td}>
                    {r.scenarioName ?? <span style={muted}>deleted scenario</span>}
                    {r.documentVersion ? ` · v${r.documentVersion}` : ''}
                  </td>
                  <td style={td}>
                    {r.deletedAt ? (
                      <TelemetryBadge tone="muted">Deleted {when(r.deletedAt)}{r.deletedBy ? ` by ${r.deletedBy}` : ''}</TelemetryBadge>
                    ) : r.inUse ? (
                      <TelemetryBadge tone="primary">In use</TelemetryBadge>
                    ) : r.cleanupReason ? (
                      <TelemetryBadge tone="secondary">{REASON[r.cleanupReason]}</TelemetryBadge>
                    ) : null}
                    {r.deleteError && <div style={{ fontSize: 12, color: 'var(--signal-alert)' }}>Last delete failed: {r.deleteError}</div>}
                  </td>
                  <td style={td}>{when(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {outcome && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <strong style={{ fontSize: 14 }}>Last cleanup</strong>
          {outcome.deleted.map((d) => <span key={`d${d.id}`} style={{ ...mono, color: 'var(--text-primary)' }}>✓ deleted {d.foundryId}</span>)}
          {outcome.failed.map((f) => <span key={`f${f.id}`} style={{ ...mono, color: 'var(--signal-alert)' }}>✗ {f.foundryId} — {f.errorCode} (still listed; retry later)</span>)}
        </div>
      )}
    </Card>
  );
}

function TrackedBadge({ t }: { t: Tracked | null }) {
  if (!t) return <TelemetryBadge tone="tertiary">Not tracked by this app</TelemetryBadge>;
  if (t.deleted) return <TelemetryBadge tone="alert">Tracked as deleted</TelemetryBadge>;
  return (
    <TelemetryBadge tone={t.inUse ? 'primary' : 'secondary'}>
      {t.scenarioName ?? 'deleted scenario'}{t.documentVersion ? ` v${t.documentVersion}` : ''} · {t.inUse ? 'in use' : 'cleanup candidate'}
    </TelemetryBadge>
  );
}

function InventoryCard() {
  const [requested, setRequested] = useState(false);
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['ai-foundry-inventory'],
    queryFn: () => apiFetch<{ inventory: Inventory }>('/admin/ai/foundry-inventory'),
    enabled: requested, // only when the admin asks: this calls Microsoft Foundry (read-only)
    retry: false,
  });
  const inv = data?.inventory;
  return (
    <Card
      title="Foundry project inventory (read-only)"
      right={
        <Button variant="ghost" disabled={isFetching} onClick={() => (requested ? void refetch() : setRequested(true))}>
          {isFetching ? 'Loading…' : inv ? 'Refresh from Foundry' : 'Load from Foundry'}
        </Button>
      }
    >
      <div style={muted}>
        Lists what exists in the Foundry project, including resources this app does not track (for example test resources created by scripts). Untracked items can't be deleted
        here; their cleanup needs a separate decision.
      </div>
      {error && <span style={{ fontSize: 13, color: 'var(--signal-alert)' }}>Could not list Foundry: {errText(error)}</span>}
      {inv && (
        <>
          <div style={muted}>Fetched {when(inv.fetchedAt)}</div>
          <h3 style={{ fontSize: 14, margin: '8px 0 0' }}>Agent versions — {inv.agentName}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {inv.agentVersions.map((a) => (
                <tr key={a.version}>
                  <td style={{ ...td, ...mono, width: 60 }}>v{a.version}</td>
                  <td style={td}>{a.description || <span style={muted}>no description</span>}</td>
                  <td style={td}>{a.pinned ? <TelemetryBadge tone="primary">Pinned on this server</TelemetryBadge> : null}</td>
                  <td style={td}>{when(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ fontSize: 14, margin: '8px 0 0' }}>Vector stores</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {inv.vectorStores.map((v) => (
                <tr key={v.id}>
                  <td style={{ ...td, ...mono }}>{v.id}</td>
                  <td style={td}>{v.name ?? '—'}</td>
                  <td style={td}><TrackedBadge t={v.tracked} /></td>
                  <td style={td}>{when(v.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ fontSize: 14, margin: '8px 0 0' }}>Files</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {inv.files.map((f) => (
                <tr key={f.id}>
                  <td style={{ ...td, ...mono }}>{f.id}</td>
                  <td style={td}>{f.filename ?? '—'}</td>
                  <td style={td}><TrackedBadge t={f.tracked} /></td>
                  <td style={td}>{when(f.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(inv.truncated.vectorStores || inv.truncated.files || inv.truncated.agentVersions) && <div style={muted}>Only the first 100 of each kind are shown.</div>}
          {inv.missingFromFoundry.length > 0 && (
            <div style={muted}>
              Tracked but not listed by Foundry (already gone, or beyond the first page): {inv.missingFromFoundry.map((m) => m.foundryId).join(', ')}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function AiResourcesPage() {
  return (
    <div className="page" style={{ padding: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>AI resources</h1>
      <ConfigCard />
      <TrackedCard />
      <InventoryCard />
    </div>
  );
}
