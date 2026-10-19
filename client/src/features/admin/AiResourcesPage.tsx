import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { confirmAction } from '../../components/ConfirmDialog';
import { useToastStore } from '../../stores/toastStore';

// Admin "AI Management" (route /admin/ai-resources; platform phase P1 2026-10-18, simplified 2026-10-19).
// Answers three questions at a glance: is AI ready, does anything need attention, are there unused
// Foundry resources to review. Technical detail sits under a collapsed "Advanced settings".
// - Status: from GET /admin/ai/config (setting names only, never values). It says "configured", never
//   "connected": this page makes no connectivity check. AI is switched on/off only in the server environment.
// - Reference documents: the scenario list plus each scenario's existing ai-documents read (DB only, no
//   Foundry call). Upload/replace stays on the Scenarios page.
// - Foundry resources: counts from the tracked registry (ai_foundry_resources). Cleanup is explicit:
//   nothing preselected, only unused candidates are selectable, a confirmation lists the exact Foundry ids
//   and needs DELETE typed, the server re-checks every id, and results are shown per id. Never automatic.
// - Foundry inventory (advanced): READ-ONLY listing of the project, loaded only on request. Untracked
//   items cannot be deleted here.

interface AiConfigView {
  switchOn: boolean;
  configured: boolean;
  enabled: boolean;
  missing: string[];
  agentName: string | null;
  agentVersion: string | null;
  requestContractVersion: string;
  requestTimeoutMs: number;
  maxConcurrent: number;
  acceptedContractVersions: string[];
}

interface ScenarioItem {
  id: number;
  name: string;
  dayLabel: string;
}
type DocStatus = 'processing' | 'ready' | 'failed' | 'superseded';
interface AiDocument {
  id: number;
  version: number;
  originalFilename: string;
  status: DocStatus;
  pinnedSessionCount: number;
  foundryDeleted: boolean;
  rebuilding: boolean;
}
interface AiDocumentsResponse {
  current: AiDocument | null;
  versions: AiDocument[];
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
  document_deleted: 'Its scenario or document was deleted',
  superseded_unpinned: 'Replaced by a newer document; no team session uses it',
  failed_version: 'Left over from a failed upload',
  replaced_attempt: 'Earlier attempt that was retried',
};
const KIND: Record<FoundryResource['kind'], string> = { file: 'File', vector_store: 'Vector store' };

const card: CSSProperties = { background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-card, 8px)', padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 };
const th: CSSProperties = { textAlign: 'left', fontSize: 12, color: 'var(--text-telemetry)', fontWeight: 500, padding: '6px 8px', borderBottom: '1px solid var(--surface-border)' };
const td: CSSProperties = { fontSize: 14, color: 'var(--text-primary)', padding: '6px 8px', borderBottom: '1px solid var(--surface-border)', verticalAlign: 'top' };
const mono: CSSProperties = { fontFamily: 'var(--font-mono, monospace)', fontSize: 13, overflowWrap: 'anywhere' };
const muted: CSSProperties = { fontSize: 13, color: 'var(--text-muted)' };
const alertText: CSSProperties = { fontSize: 13, color: 'var(--signal-alert)' };
const monoLabel: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-telemetry)' };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const errText = (e: unknown) => (e instanceof ApiError ? `${e.message}${e.reason ? ` (${e.reason})` : ''}` : 'Request failed');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

// ---- data -----------------------------------------------------------------------------------------

function useAiConfig() {
  return useQuery({ queryKey: ['ai-config'], queryFn: () => apiFetch<{ config: AiConfigView }>('/admin/ai/config') });
}

function useTrackedResources() {
  return useQuery({
    queryKey: ['ai-foundry-resources', 'all'],
    queryFn: () => apiFetch<{ resources: FoundryResource[] }>('/admin/ai/foundry-resources?state=all'),
  });
}

type DocState = 'ready' | 'processing' | 'failed' | 'missing';
interface DocRow {
  scenario: ScenarioItem;
  loading: boolean;
  error: boolean;
  state: DocState | null;
  filename: string | null;
  note: string | null; // something an admin should know besides the main status
  attention: boolean; // failed, or a running session's Foundry copy is gone
}

// Same reading as the Scenarios page (AiScenarioConfigSection): a processing version wins, then the
// current ready one, then a failed upload with nothing current, else no document.
function docRow(scenario: ScenarioItem, data: AiDocumentsResponse | undefined, loading: boolean, error: boolean): DocRow {
  if (!data) return { scenario, loading, error, state: null, filename: null, note: null, attention: false };
  const processing = data.versions.find((v) => v.status === 'processing') ?? null;
  const current = data.current;
  const newest = data.versions[0] ?? null;
  const pendingFailure = newest && newest.status === 'failed' && (!current || newest.version > current.version) ? newest : null;
  const needsRebuild = data.versions.some((v) => v.foundryDeleted && !v.rebuilding && v.pinnedSessionCount > 0);
  const state: DocState = processing ? 'processing' : current ? 'ready' : pendingFailure ? 'failed' : 'missing';
  const shown = processing ?? current ?? pendingFailure;
  let note: string | null = null;
  if (needsRebuild) note = 'A version that team sessions use is missing in Foundry — rebuild it under Advanced settings on the scenario page.';
  else if (state === 'ready' && pendingFailure) note = `A newer upload (${pendingFailure.originalFilename}) failed; the current document is still in use.`;
  else if (state === 'failed') note = 'Processing failed — retry or upload another file on the scenario page.';
  return { scenario, loading, error, state, filename: shown?.originalFilename ?? null, note, attention: state === 'failed' || needsRebuild || !!pendingFailure };
}

function useDocRows() {
  const scenarios = useQuery({ queryKey: ['cyber-ranges'], queryFn: () => apiFetch<{ cyberRanges: ScenarioItem[] }>('/cyber-ranges') });
  const list = scenarios.data?.cyberRanges ?? [];
  // One existing per-scenario read each (same query key as the Scenarios page, so caches are shared).
  const docs = useQueries({
    queries: list.map((s) => ({
      queryKey: ['ai-documents', s.id],
      queryFn: () => apiFetch<AiDocumentsResponse>(`/admin/cyber-ranges/${s.id}/ai-documents`),
      refetchInterval: (q: { state: { data?: AiDocumentsResponse } }) => (q.state.data?.versions.some((v) => v.status === 'processing' || v.rebuilding) ? 3000 : false),
    })),
  });
  const rows = list.map((s, i) => docRow(s, docs[i]?.data, docs[i]?.isLoading ?? true, docs[i]?.isError ?? false));
  return { rows, isLoading: scenarios.isLoading, isError: scenarios.isError };
}

// ---- 1. status ------------------------------------------------------------------------------------

type Overall = 'ready' | 'disabled' | 'attention';
const OVERALL: Record<Overall, { label: string; tone: 'primary' | 'muted' | 'alert' }> = {
  ready: { label: 'Ready', tone: 'primary' },
  disabled: { label: 'Disabled', tone: 'muted' },
  attention: { label: 'Needs attention', tone: 'alert' },
};

function StatusCard({ docRows, docsLoading }: { docRows: DocRow[]; docsLoading: boolean }) {
  const { data, isLoading, isError } = useAiConfig();
  const c = data?.config;

  const loadedDocs = docRows.filter((r) => r.state !== null);
  const failedDocs = docRows.filter((r) => r.attention);
  const missingDocs = docRows.filter((r) => r.state === 'missing');
  const readyDocs = docRows.filter((r) => r.state === 'ready');
  const noReadyDoc = !docsLoading && docRows.length > 0 && loadedDocs.length === docRows.length && readyDocs.length === 0;

  let overall: Overall | null = null;
  const reasons: string[] = [];
  if (c) {
    if (!c.switchOn) {
      overall = 'disabled';
      reasons.push('AI assessment is switched off in the server configuration. Instructors cannot run AI checks.');
      if (!c.configured) reasons.push(`The configuration is also incomplete (${plural(c.missing.length, 'setting')} missing or invalid — see Advanced settings).`);
    } else if (!c.configured) {
      overall = 'attention';
      reasons.push(`AI is switched on, but ${plural(c.missing.length, 'required setting is', 'required settings are')} missing or invalid, so AI stays off. The names are listed under Advanced settings.`);
    } else {
      overall = failedDocs.length > 0 || noReadyDoc ? 'attention' : 'ready';
      if (noReadyDoc) reasons.push('No scenario has a ready reference document yet, so AI checks cannot run.');
      if (failedDocs.length > 0) reasons.push(`${plural(failedDocs.length, 'scenario has', 'scenarios have')} a reference document problem — see Reference documents below.`);
      if (!noReadyDoc && missingDocs.length > 0) reasons.push(`${plural(missingDocs.length, 'scenario has', 'scenarios have')} no reference document; AI checks are not available for ${missingDocs.length === 1 ? 'it' : 'them'}.`);
      if (overall === 'ready' && reasons.length === 0) reasons.push('AI checks are available to instructors.');
    }
  }

  return (
    <section style={{ ...card, gap: 'var(--space-md)' }} aria-labelledby="ai-status-heading">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
        <h2 id="ai-status-heading" style={{ fontSize: 16, margin: 0, color: 'var(--text-primary)' }}>
          AI status
        </h2>
        {isLoading && <span style={muted}>Checking…</span>}
        {overall && <TelemetryBadge tone={OVERALL[overall].tone}>{OVERALL[overall].label}</TelemetryBadge>}
      </div>
      {isError && <span style={alertText}>Could not load the AI status. Reload the page to try again.</span>}
      {c && (
        <>
          <ul style={{ margin: 0, paddingInlineStart: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, color: 'var(--text-primary)' }}>
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-sm)' }}>
            <StatusFact label="Microsoft Foundry">
              {c.configured ? 'Settings complete' : <span style={{ color: 'var(--signal-alert)' }}>Not configured</span>}
              <div style={muted}>{c.configured ? 'The connection is not tested on this page; it is used when a document is processed or a check runs.' : 'Required settings are missing in the server environment.'}</div>
            </StatusFact>
            <StatusFact label="Agent version">
              {c.agentVersion ? (
                <>
                  <span style={mono}>{c.agentName ?? '—'}</span> · version <span style={mono}>{c.agentVersion}</span>
                  <div style={muted}>Pinned: a newer version in Foundry is not used until the server is changed.</div>
                </>
              ) : (
                <>
                  <span style={{ color: 'var(--signal-alert)' }}>No version pinned</span>
                  <div style={muted}>AI stays off until a reviewed version is set on the server.</div>
                </>
              )}
            </StatusFact>
          </div>
          <div style={muted}>AI is turned on or off in the server environment and changed by redeploying, not on this page.</div>
        </>
      )}
    </section>
  );
}

function StatusFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 'var(--space-sm)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-control)', minWidth: 0 }}>
      <span style={monoLabel}>{label}</span>
      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{children}</div>
    </div>
  );
}

// ---- 2. reference documents -----------------------------------------------------------------------

const DOC_BADGE: Record<DocState, { label: string; tone: 'primary' | 'secondary' | 'alert' | 'muted' }> = {
  ready: { label: 'Ready', tone: 'primary' },
  processing: { label: 'Processing…', tone: 'secondary' },
  failed: { label: 'Failed', tone: 'alert' },
  missing: { label: 'Missing', tone: 'muted' },
};

function DocumentsCard({ rows, isLoading, isError }: { rows: DocRow[]; isLoading: boolean; isError: boolean }) {
  return (
    <Card title="Reference documents">
      <div style={muted}>Each scenario needs one reference document for AI checks. Upload or replace it on the scenario's page.</div>
      {isLoading && <span style={muted}>Loading scenarios…</span>}
      {isError && <span style={alertText}>Could not load the scenarios.</span>}
      {!isLoading && !isError && rows.length === 0 && (
        <span style={muted}>
          No scenarios yet. <Link to="/admin/scenarios" style={{ color: 'var(--signal-secondary)' }}>Create one on the Scenarios page</Link>.
        </span>
      )}
      {rows.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          {rows.map((r) => (
            <li key={r.scenario.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)', padding: '8px 0', borderBottom: '1px solid var(--surface-border)' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{r.scenario.name}</div>
                <div style={{ ...muted, overflowWrap: 'anywhere' }}>
                  {r.filename ? <bdi>{r.filename}</bdi> : r.state === 'missing' ? 'No document uploaded' : r.scenario.dayLabel}
                </div>
                {r.note && <div style={r.attention ? alertText : muted}>{r.note}</div>}
              </div>
              {r.loading ? (
                <span style={muted}>Loading…</span>
              ) : r.error ? (
                <span style={alertText}>Could not load</span>
              ) : r.state ? (
                <TelemetryBadge tone={DOC_BADGE[r.state].tone}>{DOC_BADGE[r.state].label}</TelemetryBadge>
              ) : null}
              <Link to={`/admin/scenarios?scenario=${r.scenario.id}`} style={{ fontSize: 14, marginInlineStart: 'auto', color: 'var(--signal-secondary)' }}>
                {r.state === 'missing' ? 'Upload →' : r.state === 'failed' ? 'Fix →' : 'Open scenario →'}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- 3. Foundry resources -------------------------------------------------------------------------

function ResourcesCard() {
  const { data, isLoading, isError } = useTrackedResources();
  const [reviewing, setReviewing] = useState(false);
  const [outcome, setOutcome] = useState<CleanupOutcome | null>(null);
  const live = (data?.resources ?? []).filter((r) => r.deletedAt === null);
  const inUse = live.filter((r) => r.inUse).length;
  const eligible = live.filter((r) => r.cleanupReason !== null).length;

  return (
    <Card
      title="Foundry resources"
      right={
        <Button variant="ghost" disabled={isLoading || isError || eligible === 0} onClick={() => setReviewing(true)}>
          Review unused resources
        </Button>
      }
    >
      <div style={muted}>Files and search indexes this app created in Microsoft Foundry for reference documents. Nothing is ever deleted automatically.</div>
      {isLoading && <span style={muted}>Loading…</span>}
      {isError && <span style={alertText}>Could not load the resources.</span>}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-sm)' }}>
          <Stat label="Tracked" value={live.length} />
          <Stat label="In use" value={inUse} />
          <Stat label="Unused, can be cleaned up" value={eligible} highlight={eligible > 0} />
        </div>
      )}
      {data && eligible === 0 && <span style={muted}>{live.length === 0 ? 'This app has not created any Foundry resources yet.' : 'Nothing to clean up — every tracked resource is in use.'}</span>}
      {outcome && <CleanupResult outcome={outcome} />}
      {reviewing && (
        <ReviewDialog
          onClose={() => setReviewing(false)}
          onDone={(res) => {
            setOutcome(res);
            setReviewing(false);
          }}
        />
      )}
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{ padding: 'var(--space-sm)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-control)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="tabular" style={{ fontSize: 24, color: highlight ? 'var(--signal-primary)' : 'var(--text-primary)' }}>
        {value}
      </span>
      <span style={muted}>{label}</span>
    </div>
  );
}

function CleanupResult({ outcome }: { outcome: CleanupOutcome }) {
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <strong style={{ fontSize: 14 }}>Last cleanup</strong>
      {outcome.deleted.map((d) => (
        <span key={`d${d.id}`} style={{ ...mono, color: 'var(--text-primary)' }}>
          ✓ deleted {d.foundryId}
        </span>
      ))}
      {outcome.failed.map((f) => (
        <span key={`f${f.id}`} style={{ ...mono, color: 'var(--signal-alert)' }}>
          ✗ {f.foundryId} — {f.errorCode} (still listed; retry later)
        </span>
      ))}
    </div>
  );
}

// Lists the server's current cleanup candidates. Nothing is preselected; the confirmation names every
// Foundry id and needs DELETE typed; the server re-checks each id and answers per id.
function ReviewDialog({ onClose, onDone }: { onClose: () => void; onDone: (res: CleanupOutcome) => void }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ai-foundry-resources', 'candidates'],
    queryFn: () => apiFetch<{ resources: FoundryResource[] }>('/admin/ai/foundry-resources?state=candidates'),
    staleTime: 0,
  });
  const rows = data?.resources ?? [];
  const chosen = rows.filter((r) => selected.has(r.id) && r.cleanupReason !== null);

  const cleanup = useMutation({
    mutationFn: (ids: number[]) => apiFetch<CleanupOutcome>('/admin/ai/foundry-resources/cleanup', { method: 'POST', body: JSON.stringify({ resourceIds: ids }) }),
    onSuccess: (res) => {
      push(`${res.deleted.length} deleted, ${res.failed.length} failed.`, res.failed.length ? 'error' : 'success');
      onDone(res);
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
      title: `Permanently delete ${plural(chosen.length, 'Foundry resource')}?`,
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
  const busy = cleanup.isPending;

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{ position: 'fixed', inset: 0, background: 'var(--overlay-backdrop)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 1900, overflowY: 'auto' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-review-title"
        style={{
          width: 'min(880px, 100%)',
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border-strong)',
          borderRadius: 'var(--radius-container)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          padding: 'var(--space-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
          margin: '24px 0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-md)' }}>
          <h2 id="ai-review-title" style={{ fontSize: 20, margin: 0, color: 'var(--text-primary)' }}>
            Unused Foundry resources
          </h2>
          <Button variant="ghost" onClick={onClose} disabled={busy} style={{ padding: '4px 12px', fontSize: 14 }}>
            Close
          </Button>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
          No team session uses these resources. Select the ones to delete — nothing is selected for you. Only resources this app created are listed.
        </p>
        {isLoading && <span style={muted}>Loading…</span>}
        {isError && <span style={alertText}>Could not load the resources.</span>}
        {data && rows.length === 0 && <span style={muted}>Nothing to clean up — every tracked resource is in use or already deleted.</span>}
        {rows.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {rows.map((r) => (
              <li key={r.id} style={{ borderBottom: '1px solid var(--surface-border)' }}>
                <label style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', padding: '10px 0', cursor: 'pointer' }}>
                  <input type="checkbox" aria-label={`Select ${r.foundryId}`} checked={selected.has(r.id)} disabled={busy} onChange={() => toggle(r.id)} style={{ marginTop: 3 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{KIND[r.kind]}</span>
                      <span style={{ ...mono, color: 'var(--text-primary)' }}>{r.foundryId}</span>
                    </div>
                    <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                      {r.cleanupReason ? REASON[r.cleanupReason] : '—'}
                      <span style={muted}>
                        {' '}
                        · {r.scenarioName ?? 'deleted scenario'}
                        {r.documentVersion ? ` v${r.documentVersion}` : ''} · created {when(r.createdAt)}
                      </span>
                    </span>
                    <span style={muted}>Eligible for cleanup — the server checks again that it is unused right before deleting.</span>
                    {r.deleteError && <span style={alertText}>Last delete failed: {r.deleteError}</span>}
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!chosen.length || busy} onClick={() => void onDelete()}>
            {busy ? 'Deleting…' : `Delete selected (${chosen.length})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- 4. advanced settings -------------------------------------------------------------------------

function AdvancedSettings() {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ ...monoLabel, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'start', alignSelf: 'flex-start' }}
      >
        {open ? '▾' : '▸'} Advanced settings
      </button>
      {open && (
        <>
          <ConfigDetails />
          <TrackedInventory />
          <InventoryCard />
        </>
      )}
    </section>
  );
}

function ConfigDetails() {
  const { data, isError } = useAiConfig();
  const c = data?.config;
  return (
    <Card title="Configuration details">
      {isError && <span style={alertText}>Could not load the configuration.</span>}
      {c && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <TelemetryBadge tone={c.enabled ? 'primary' : 'muted'}>{c.enabled ? 'AI assessment enabled' : 'AI assessment off'}</TelemetryBadge>
            <TelemetryBadge tone={c.switchOn ? 'secondary' : 'muted'}>Switch {c.switchOn ? 'on' : 'off'}</TelemetryBadge>
            <TelemetryBadge tone={c.configured ? 'secondary' : 'alert'}>{c.configured ? 'Configured' : 'Not configured'}</TelemetryBadge>
          </div>
          <div style={muted}>
            Agent <span style={mono}>{c.agentName ?? '—'}</span>, pinned version <span style={mono}>{c.agentVersion ?? 'none (AI stays off)'}</span> · response contract{' '}
            {c.requestContractVersion} · accepted reply formats {c.acceptedContractVersions.join(', ')} · timeout {Math.round(c.requestTimeoutMs / 1000)} s · up to {c.maxConcurrent} jobs at a time
          </div>
          {c.missing.length > 0 ? (
            <div style={alertText}>
              Missing or invalid settings: <span style={mono}>{c.missing.join(', ')}</span>
            </div>
          ) : (
            <div style={muted}>No missing settings.</div>
          )}
          <div style={muted}>Setting names only — values and secrets are never shown. They are changed in the server environment by redeploying.</div>
        </>
      )}
    </Card>
  );
}

// Read-only: deleting happens only through "Review unused resources".
function TrackedInventory() {
  const { data, isLoading, isError } = useTrackedResources();
  const rows = data?.resources ?? [];
  return (
    <Card title="All tracked Foundry resources">
      <div style={muted}>Every file and vector store this app created, including in-use and deleted ones.</div>
      {isLoading && <span style={muted}>Loading…</span>}
      {isError && <span style={alertText}>Could not load the resources.</span>}
      {data && rows.length === 0 && <span style={muted}>This app has not created any Foundry resources yet.</span>}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
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
                  <td style={td}>{KIND[r.kind]}</td>
                  <td style={{ ...td, ...mono }}>{r.foundryId}</td>
                  <td style={td}>
                    {r.scenarioName ?? <span style={muted}>deleted scenario</span>}
                    {r.documentVersion ? ` · v${r.documentVersion}` : ''}
                  </td>
                  <td style={td}>
                    {r.deletedAt ? (
                      <TelemetryBadge tone="muted">
                        Deleted {when(r.deletedAt)}
                        {r.deletedBy ? ` by ${r.deletedBy}` : ''}
                      </TelemetryBadge>
                    ) : r.inUse ? (
                      <TelemetryBadge tone="primary">In use</TelemetryBadge>
                    ) : r.cleanupReason ? (
                      <TelemetryBadge tone="secondary">Unused</TelemetryBadge>
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
    </Card>
  );
}

function TrackedBadge({ t }: { t: Tracked | null }) {
  if (!t) return <TelemetryBadge tone="tertiary">Not tracked by this app</TelemetryBadge>;
  if (t.deleted) return <TelemetryBadge tone="alert">Tracked as deleted</TelemetryBadge>;
  return (
    <TelemetryBadge tone={t.inUse ? 'primary' : 'secondary'}>
      {t.scenarioName ?? 'deleted scenario'}
      {t.documentVersion ? ` v${t.documentVersion}` : ''} · {t.inUse ? 'in use' : 'cleanup candidate'}
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
      {error && <span style={alertText}>Could not list Foundry: {errText(error)}</span>}
      {inv && (
        <div style={{ overflowX: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
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
                  <td style={td}>
                    <TrackedBadge t={v.tracked} />
                  </td>
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
                  <td style={td}>
                    <TrackedBadge t={f.tracked} />
                  </td>
                  <td style={td}>{when(f.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(inv.truncated.vectorStores || inv.truncated.files || inv.truncated.agentVersions) && <div style={muted}>Only the first 100 of each kind are shown.</div>}
          {inv.missingFromFoundry.length > 0 && (
            <div style={muted}>Tracked but not listed by Foundry (already gone, or beyond the first page): {inv.missingFromFoundry.map((m) => m.foundryId).join(', ')}</div>
          )}
        </div>
      )}
    </Card>
  );
}

export function AiResourcesPage() {
  const docs = useDocRows();
  return (
    <div className="page" style={{ padding: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>AI Management</h1>
      <StatusCard docRows={docs.rows} docsLoading={docs.isLoading || docs.rows.some((r) => r.loading)} />
      <DocumentsCard rows={docs.rows} isLoading={docs.isLoading} isError={docs.isError} />
      <ResourcesCard />
      <AdvancedSettings />
    </div>
  );
}
