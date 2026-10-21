import { useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_ORIGIN, apiFetch, ApiError } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { useCan } from '../../lib/permissions';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { confirmAction } from '../../components/ConfirmDialog';
import { useToastStore } from '../../stores/toastStore';
import { formatEntryTime } from '../documentation/InvestigationPage';

// AI Scenario Configuration (docs/ai-investigation-assessment-plan.md §F-1): the scenario's ground-truth
// reference document for the AI assessment, uploaded once and reused by every team. The rubric weights
// are defined in code since 2026-10-21 (no editor). Answer-key data like the ATT&CK list above it — staff only, served under /admin. The server
// never returns the document bytes or Foundry ids; this screen only shows metadata and status.
// Simplified instructor UX (2026-10-18): instructors see one upload/replace control and a plain status;
// version history, rebuild, download and file details sit under "Advanced settings",
// shown to admins (ai_resources.manage) only. Pinning and every server rule are unchanged.

type DocStatus = 'processing' | 'ready' | 'failed' | 'superseded';

interface AiDocument {
  id: number;
  version: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: DocStatus;
  isCurrent: boolean;
  errorCode: string | null;
  uploadedBy: string;
  createdAt: string;
  readyAt: string | null;
  supersededAt: string | null;
  pinnedSessionCount: number;
  pinnedTeams: string[];
  assessmentCount: number;
  foundryDeleted: boolean; // Foundry copy gone (bytes kept) — "Rebuild in Foundry"
  rebuilding: boolean;
}

type RubricKey = 'identification' | 'understanding' | 'connections' | 'clarity';

interface AiDocumentsResponse {
  current: AiDocument | null;
  versions: AiDocument[];
  ready: boolean;
  aiEnabled: boolean;
  rubric: { criteria: { key: RubricKey; label: string; maxPoints: number }[]; isDefault: boolean };
}

const MAX_BYTES = 5 * 1024 * 1024; // mirrors the server limit (documentValidation.ts)
const ACCEPT = '.pdf,.docx,.txt';

const monoLabel: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-telemetry)',
};


function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Server error codes -> plain language. Unknown codes fall back to a generic line (never raw details).
function describeDocumentError(code: string | null): string {
  if (!code) return 'Processing failed.';
  if (code === 'interrupted') return 'Processing was interrupted by a server restart — retry it.';
  if (code.startsWith('indexing_failed')) return 'Microsoft Foundry could not process this file. Check that it opens and contains text, then retry or upload another version.';
  switch (code) {
    case 'ai_auth_failed':
      return 'The server could not authenticate to Microsoft Foundry. Ask an admin to check the AI configuration.';
    case 'ai_not_configured':
      return 'AI assessment is not configured on the server.';
    case 'ai_rate_limited':
      return 'Microsoft Foundry was busy (rate limited). Retry in a minute.';
    case 'ai_timeout':
      return 'Microsoft Foundry did not finish in time. Retry it.';
    case 'ai_unavailable':
      return 'Microsoft Foundry was temporarily unavailable. Retry it.';
    default:
      return 'Processing failed. Retry it, or upload another version.';
  }
}

function statusBadge(d: AiDocument) {
  switch (d.status) {
    case 'ready':
      return <TelemetryBadge tone="primary">Ready</TelemetryBadge>;
    case 'processing':
      return <TelemetryBadge tone="secondary">Processing…</TelemetryBadge>;
    case 'failed':
      return <TelemetryBadge tone="alert">Failed</TelemetryBadge>;
    default:
      return <TelemetryBadge>Replaced</TelemetryBadge>;
  }
}

// The original file of a version (scenario authors; the server audits every download).
async function downloadVersion(cyberRangeId: number, doc: AiDocument) {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${API_ORIGIN}/api/admin/cyber-ranges/${cyberRangeId}/ai-documents/${doc.id}/content`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.originalFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

export function AiScenarioConfigSection({ cyberRangeId }: { cyberRangeId: number }) {
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const canAuthor = useCan('scenario.author');
  const isAdmin = useCan('ai_resources.manage');
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const queryKey = ['ai-documents', cyberRangeId];

  const { data, error: loadError } = useQuery({
    queryKey,
    queryFn: () => apiFetch<AiDocumentsResponse>(`/admin/cyber-ranges/${cyberRangeId}/ai-documents`),
    // Poll only while a version is being processed in Foundry.
    refetchInterval: (q) => (q.state.data?.versions.some((v) => v.status === 'processing' || v.rebuilding) ? 3000 : false),
  });

  // No reset effect needed: ScenarioConfigPage keys this section by scenario, so switching scenarios
  // remounts it with fresh state.
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

  const upload = useMutation({
    mutationFn: async (file: File) =>
      apiFetch<{ document: AiDocument }>(`/admin/cyber-ranges/${cyberRangeId}/ai-documents`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentBase64: await readAsDataUrl(file) }),
      }),
    onSuccess: (res) => {
      setError(null);
      push(isAdmin ? `Version ${res.document.version} uploaded — processing in Microsoft Foundry.` : 'Document uploaded. It is being prepared — usually under a minute.', 'success');
      invalidate();
    },
    onError: (err) => setError(errorText(err, 'Could not upload the document.')),
  });

  const retry = useMutation({
    mutationFn: (documentId: number) =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/ai-documents/${documentId}/retry`, { method: 'POST' }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(errorText(err, 'Could not retry processing.')),
  });

  const rebuild = useMutation({
    mutationFn: (documentId: number) =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/ai-documents/${documentId}/rebuild`, { method: 'POST' }),
    onSuccess: () => {
      setError(null);
      push('Rebuilding this version in Microsoft Foundry from the stored file.', 'success');
      invalidate();
    },
    onError: (err) => setError(errorText(err, 'Could not rebuild this version.')),
  });

  async function onDownload(doc: AiDocument) {
    try {
      await downloadVersion(cyberRangeId, doc);
    } catch {
      push('Could not download the document.', 'error');
    }
  }

  const processing = data?.versions.find((v) => v.status === 'processing') ?? null;
  const current = data?.current ?? null;
  const newest = data?.versions[0] ?? null;
  // A failed upload newer than the current version (or with none current) is what needs attention.
  const pendingFailure = newest && newest.status === 'failed' && (!current || newest.version > current.version) ? newest : null;

  async function onFileChosen(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setError(null);
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) {
      setError('Only PDF, DOCX and TXT documents are supported.');
      return;
    }
    if (file.size === 0) {
      setError('The file is empty.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('The document is larger than 5 MB.');
      return;
    }
    // Re-read right before warning: teams may have started sessions since the page loaded, and the
    // pinned count in the dialog must be current.
    let fresh: AiDocumentsResponse;
    try {
      fresh = await queryClient.fetchQuery({ queryKey, queryFn: () => apiFetch<AiDocumentsResponse>(`/admin/cyber-ranges/${cyberRangeId}/ai-documents`), staleTime: 0 });
    } catch (err) {
      setError(errorText(err, 'Could not load the AI configuration.'));
      return;
    }
    const liveCurrent = fresh.current;
    if (liveCurrent) {
      const pinned = liveCurrent.pinnedSessionCount;
      const ok = await confirmAction(
        isAdmin
          ? {
              title: `Replace the reference document (v${liveCurrent.version})?`,
              message:
                (pinned > 0
                  ? `${pinned} team session${pinned === 1 ? ' is' : 's are'} using v${liveCurrent.version} and will keep using it. `
                  : '') +
                'Only team sessions started after the new version is ready will use it. Assessments already made keep the version they used. The current version stays in use until the new one is processed successfully.',
              confirmLabel: 'Upload new version',
            }
          : {
              title: 'Replace the reference document?',
              message: 'Teams that already started keep the current document. Teams that start later use the new one.',
              confirmLabel: 'Replace',
            },
      );
      if (!ok) return;
    }
    upload.mutate(file);
  }

  const readiness = !data ? null : processing ? (
    <TelemetryBadge tone="secondary">{isAdmin ? `Processing v${processing.version}…` : 'Preparing…'}</TelemetryBadge>
  ) : current ? (
    <TelemetryBadge tone="primary">{isAdmin ? `Ready · v${current.version}` : 'Ready'}</TelemetryBadge>
  ) : pendingFailure ? (
    <TelemetryBadge tone="alert">Failed</TelemetryBadge>
  ) : (
    <TelemetryBadge>No document yet</TelemetryBadge>
  );
  // A version that running sessions still use has lost its Foundry copy: only an admin can rebuild it.
  const needsRebuild = !!data?.versions.some((v) => v.foundryDeleted && !v.rebuilding && v.pinnedSessionCount > 0);

  const uploadDisabled = !data?.aiEnabled || !!processing || upload.isPending;

  return (
    <section
      aria-labelledby="ai-config-heading"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-container)',
        padding: 'var(--space-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-md)',
        marginTop: 'var(--space-lg)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 id="ai-config-heading" style={{ ...monoLabel, margin: 0 }}>
          Reference document for AI
        </h2>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {readiness}
          {data && !data.aiEnabled && <TelemetryBadge>AI disabled on server</TelemetryBadge>}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
        The scenario's answer key — storyline, expected findings, attack steps. The AI compares each team's investigation with it.
        Students never see it. PDF, DOCX or TXT, up to 5 MB.
      </p>

      {loadError && (
        <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 14 }}>
          {errorText(loadError, 'Could not load the AI configuration.')}
        </div>
      )}

      {data && !data.aiEnabled && (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
          AI assessment is switched off on this server, so documents can't be uploaded or processed right now.
        </p>
      )}

      {current && !isAdmin && (
        <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
          <bdi>{current.originalFilename}</bdi>
        </div>
      )}

      {current && isAdmin && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'baseline', fontSize: 14 }}>
          <span style={{ color: 'var(--text-primary)' }}>
            <bdi>{current.originalFilename}</bdi>
          </span>
          <span className="tabular" style={{ color: 'var(--text-muted)' }}>
            v{current.version} · {formatSize(current.sizeBytes)} · uploaded by <bdi>{current.uploadedBy}</bdi> ·{' '}
            {formatEntryTime(current.createdAt)}
          </span>
          <span className="tabular" title={current.sha256} style={{ ...monoLabel, fontSize: 11 }}>
            SHA-256 {current.sha256.slice(0, 12)}
          </span>
        </div>
      )}

      {processing && (
        <div role="status" style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          {isAdmin ? (
            <>
              Processing <bdi>{processing.originalFilename}</bdi> (v{processing.version}) in Microsoft Foundry — this usually takes under a
              minute.{current ? ` v${current.version} stays in use until it is ready.` : ''}
            </>
          ) : (
            <>
              Preparing <bdi>{processing.originalFilename}</bdi> — usually under a minute.{current ? ' The current document stays in use until then.' : ''}
            </>
          )}
        </div>
      )}

      {pendingFailure && (
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center', fontSize: 14 }}>
          <span style={{ color: 'var(--signal-alert)' }}>
            {isAdmin ? `v${pendingFailure.version} (` : ''}
            <bdi>{pendingFailure.originalFilename}</bdi>
            {isAdmin ? ')' : ''}: {describeDocumentError(pendingFailure.errorCode)}
            {current ? (isAdmin ? ` v${current.version} is still in use.` : ' The previous document is still in use.') : ''}
          </span>
          {canAuthor && data?.aiEnabled && !processing && (
            <Button
              type="button"
              variant="ghost"
              disabled={retry.isPending}
              onClick={() => retry.mutate(pendingFailure.id)}
              style={{ padding: '4px 12px', fontSize: 14 }}
            >
              Retry
            </Button>
          )}
        </div>
      )}

      {needsRebuild && !isAdmin && (
        <div role="alert" style={{ fontSize: 14, color: 'var(--signal-alert)' }}>
          Some teams' copy of the reference document is no longer available, so they can't be checked with AI. Ask an admin to rebuild it.
        </div>
      )}

      {canAuthor && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            aria-label="Reference document file"
            style={{ display: 'none' }}
            onChange={(e) => void onFileChosen(e.target.files?.[0])}
          />
          <Button type="button" variant="ghost" disabled={uploadDisabled} onClick={() => fileInput.current?.click()} style={{ padding: '6px 14px', fontSize: 14 }}>
            {upload.isPending ? 'Uploading…' : current ? 'Replace document' : 'Upload reference document'}
          </Button>
        </div>
      )}

      {error && (
        <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 14 }}>
          {error}
        </div>
      )}

      {isAdmin && data && (
        <button
          type="button"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
          style={{ ...monoLabel, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'start' }}
        >
          {showAdvanced ? '▾' : '▸'} Advanced settings (admin){needsRebuild ? ' — needs attention' : ''}
        </button>
      )}

      {isAdmin && showAdvanced && data && data.versions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <span style={monoLabel}>Version history ({data.versions.length})</span>
          {(
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.versions.map((v) => (
                <li key={v.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'baseline', fontSize: 14 }}>
                  <span className="tabular" style={{ color: 'var(--text-primary)', minWidth: 28 }}>
                    v{v.version}
                  </span>
                  {statusBadge(v)}
                  <span style={{ color: 'var(--text-primary)' }}>
                    <bdi>{v.originalFilename}</bdi>
                  </span>
                  <span className="tabular" style={{ color: 'var(--text-muted)' }}>
                    {formatSize(v.sizeBytes)} · <bdi>{v.uploadedBy}</bdi> · {formatEntryTime(v.createdAt)}
                  </span>
                  {v.pinnedSessionCount > 0 && (
                    <span style={{ color: 'var(--text-muted)' }} title={v.pinnedTeams.join(', ')}>
                      · used by {v.pinnedSessionCount} team session{v.pinnedSessionCount === 1 ? '' : 's'} (<bdi>{v.pinnedTeams.join(', ')}</bdi>)
                    </span>
                  )}
                  {v.assessmentCount > 0 && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      · {v.assessmentCount} AI assessment{v.assessmentCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {v.status === 'failed' && <span style={{ color: 'var(--text-muted)' }}>· {describeDocumentError(v.errorCode)}</span>}
                  {v.rebuilding && <TelemetryBadge tone="secondary">Rebuilding…</TelemetryBadge>}
                  {v.foundryDeleted && !v.rebuilding && (
                    <span style={{ color: v.pinnedSessionCount > 0 ? 'var(--signal-alert)' : 'var(--text-muted)' }}>
                      · Foundry copy deleted{v.pinnedSessionCount > 0 ? ' — the sessions above cannot be assessed until it is rebuilt' : ''}
                    </span>
                  )}
                  {canAuthor && v.foundryDeleted && !v.rebuilding && (v.status === 'ready' || v.status === 'superseded') && (
                    <Button type="button" variant="ghost" disabled={rebuild.isPending} onClick={() => rebuild.mutate(v.id)} style={{ padding: '2px 10px', fontSize: 13 }}>
                      Rebuild in Foundry
                    </Button>
                  )}
                  {canAuthor && (
                    <Button type="button" variant="ghost" onClick={() => void onDownload(v)} style={{ padding: '2px 10px', fontSize: 13 }}>
                      Download
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

    </section>
  );
}
