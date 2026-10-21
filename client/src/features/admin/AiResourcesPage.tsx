import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { confirmAction } from '../../components/ConfirmDialog';
import { useToastStore } from '../../stores/toastStore';

// Admin "AI Management" (route /admin/ai-resources; platform phase P1 2026-10-18, simplified 2026-10-19,
// operational-only 2026-10-21). The admin does NOT manage the agent: its name, version, reply contract,
// model, instructions and the rubric are pinned in code (server aiConfig.ts PINNED_AGENT) and change only
// through a reviewed deploy. This page answers three questions: is AI ready, does a reference document
// need attention, are there unused Foundry resources to review.
// - Status: from GET /admin/ai/config ({switchOn, configured, enabled} only). It says "configured", never
//   "connected": this page makes no connectivity check. Missing setting names go to the server log.
// - Reference documents: the scenario list plus each scenario's existing ai-documents read (DB only, no
//   Foundry call). Upload/replace stays on the Scenarios page.
// - Foundry resources: counts from the tracked registry (ai_foundry_resources). Cleanup is explicit:
//   nothing preselected, only unused candidates are selectable, a confirmation lists the exact Foundry ids
//   and needs DELETE typed, the server re-checks every id, and results are shown per id. Never automatic.
// - The read-only Foundry inventory API (GET /admin/ai/foundry-inventory) stays for maintenance; no UI.

interface AiConfigView {
  switchOn: boolean;
  configured: boolean;
  enabled: boolean;
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
const REASON: Record<CleanupReason, string> = {
  document_deleted: 'Its scenario or document was deleted',
  superseded_unpinned: 'Replaced by a newer document; no team session uses it',
  failed_version: 'Left over from a failed upload',
  replaced_attempt: 'Earlier attempt that was retried',
};
const KIND: Record<FoundryResource['kind'], string> = { file: 'File', vector_store: 'Vector store' };

const card: CSSProperties = { background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-card, 8px)', padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 };
const mono: CSSProperties = { fontFamily: 'var(--font-mono, monospace)', fontSize: 13, overflowWrap: 'anywhere' };
const muted: CSSProperties = { fontSize: 13, color: 'var(--text-muted)' };
const alertText: CSSProperties = { fontSize: 13, color: 'var(--signal-alert)' };

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
      reasons.push('AI assessment is turned off on this server. Instructors cannot run AI checks.');
    } else if (!c.configured) {
      overall = 'attention';
      reasons.push('AI is turned on, but the server setup is incomplete, so AI stays off. Ask whoever deploys the app — the server log lists what is missing.');
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
          <div style={muted}>AI and the agent it uses are set by whoever deploys the app, not on this page.</div>
        </>
      )}
    </section>
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

export function AiResourcesPage() {
  const docs = useDocRows();
  return (
    <div className="page" style={{ padding: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>AI Management</h1>
      <StatusCard docRows={docs.rows} docsLoading={docs.isLoading || docs.rows.some((r) => r.loading)} />
      <DocumentsCard rows={docs.rows} isLoading={docs.isLoading} isError={docs.isError} />
      <ResourcesCard />
    </div>
  );
}
