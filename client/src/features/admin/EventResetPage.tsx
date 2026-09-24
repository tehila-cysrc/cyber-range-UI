import { useState } from 'react';
import { ExportResultsButtons } from './ExportResultsButtons';
import { confirmAction } from '../../components/ConfirmDialog';
import { useMutation } from '@tanstack/react-query';
import { API_ORIGIN, ApiError } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../../components/Button';

const CONFIRMATION_PHRASE = 'RESET EVENT';

interface EnvironmentRevocation {
  environmentId: number;
  environmentName: string;
  vmCount: number;
  remaining: string[];
  error: string | null;
}

interface RemoteAccessResult {
  ok: boolean;
  environments: EnvironmentRevocation[];
}

interface ResetJob {
  id: string;
  state: 'running' | 'refused' | 'done' | 'failed';
  phase: string;
  endedSessions: number;
  remoteAccess: RemoteAccessResult | null;
  error: string | null;
  newInstructor: { username: string; password: string } | null;
}

const POLL_MS = 3000;

// The server revokes every Bastion shareable link (and verifies it) before wiping the run — this shows
// exactly what happened per environment, and if verification failed, why the reset was refused.
function RemoteAccessSummary({ result, endedSessions }: { result: RemoteAccessResult; endedSessions: number }) {
  return (
    <div
      style={{
        margin: 'var(--space-md) 0',
        padding: 'var(--space-md)',
        border: `1px solid ${result.ok ? 'var(--surface-border)' : 'var(--signal-alert)'}`,
        borderRadius: 'var(--radius-container)',
        background: 'var(--surface-1)',
        fontSize: 14,
      }}
    >
      <div style={{ fontWeight: 600, color: result.ok ? 'var(--signal-primary)' : 'var(--signal-alert)', marginBottom: 6 }}>
        {result.ok ? 'Remote access revoked and verified' : 'Remote access NOT verified'}
      </div>
      <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
        {endedSessions} active remote session{endedSessions === 1 ? '' : 's'} ended.
      </div>
      {result.environments.length === 0 && <div style={{ color: 'var(--text-muted)' }}>No Bastion-enabled environments — no remote-access links to revoke.</div>}
      {result.environments.map((e) => (
        <div key={e.environmentId} style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
          {e.environmentName}: {e.vmCount} VM{e.vmCount === 1 ? '' : 's'} checked —{' '}
          {e.error ? (
            <span style={{ color: 'var(--signal-alert)' }}>{e.error}</span>
          ) : e.remaining.length > 0 ? (
            <span style={{ color: 'var(--signal-alert)' }}>links still live on {e.remaining.join(', ')}</span>
          ) : (
            <span style={{ color: 'var(--signal-primary)' }}>no live links</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function EventResetPage() {
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState<ResetJob | null>(null);
  const [refused, setRefused] = useState<ResetJob | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The reset runs as a server-side job: revoking remote access has to wait for Azure Bastion to finish
  // earlier operations, which can take many minutes — far longer than one request may stay open. The
  // job-status route needs no token on purpose (the reset deletes this instructor's own account).
  const mutation = useMutation({
    mutationFn: async (allowUnverifiedRemoteAccess: boolean): Promise<ResetJob> => {
      // Plain fetch, not apiFetch: a 401 from apiFetch would clear the session and redirect away from
      // this page before the outcome (incl. the new login) could be shown.
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_ORIGIN}/api/admin/event/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm: confirmText, allowUnverifiedRemoteAccess }),
      });
      const body = await res.json().catch(() => null);
      // 409 = a reset is already running (e.g. started from another tab) — follow that one instead.
      const jobId: string | undefined = res.status === 202 || res.status === 409 ? body?.jobId : undefined;
      if (!jobId) throw new ApiError(res.status, body?.error ?? `Reset failed (${res.status})`);

      setPhase('Starting');
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const poll = await fetch(`${API_ORIGIN}/api/event-reset-jobs/${jobId}`);
        if (!poll.ok) throw new ApiError(poll.status, 'Lost track of the reset job — check the Audit Log, then try again.');
        const { job } = (await poll.json()) as { job: ResetJob };
        setPhase(job.phase);
        if (job.state !== 'running') return job;
      }
    },
    onSuccess: (job) => {
      setPhase(null);
      setError(null);
      if (job.state === 'failed') {
        setError(job.error ?? 'Reset failed');
        return;
      }
      if (job.state === 'refused') {
        setRefused(job);
        return;
      }
      // Deliberately NOT clearing local auth state here: this page lives behind ProtectedRoute, and
      // clearing the token would immediately redirect to /login before the instructor can read the
      // new credentials below. The old token is already dead server-side (cascaded away with the
      // wiped run) — apiClient's 401 handling clears it on the next request, and "Go to login" below
      // does a full navigation away from this protected tree anyway.
      setRefused(null);
      setResult(job);
    },
    onError: (err) => {
      setPhase(null);
      setError(err instanceof ApiError ? err.message : 'Reset failed');
    },
  });

  if (result) {
    return (
      <div className="page" style={{ padding: 'var(--space-xl)', maxWidth: 640 }}>
        <h1 style={{ fontSize: 22, color: 'var(--signal-primary)' }}>Event reset complete</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          All teams, accounts, documentation, scores, and help requests have been wiped. Cyber Range
          definitions, topology, and categories were preserved. Student self-registration is closed
          for the new event until you open it on the Roster page.
        </p>
        {result.remoteAccess && <RemoteAccessSummary result={result.remoteAccess} endedSessions={result.endedSessions} />}
        {result.newInstructor && (
          <p style={{ color: 'var(--text-primary)' }}>
            Log back in as: <code>{result.newInstructor.username}</code> /{' '}
            <code>{result.newInstructor.password}</code>
          </p>
        )}
        <a href="/login" style={{ color: 'var(--signal-secondary)' }}>
          Go to login →
        </a>
      </div>
    );
  }

  const phraseOk = confirmText === CONFIRMATION_PHRASE;

  return (
    <div className="page" style={{ padding: 'var(--space-xl)', maxWidth: 560 }}>
      <h1 style={{ fontSize: 22, color: 'var(--signal-alert)', margin: '0 0 var(--space-sm)' }}>
        Reset Event
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
        This permanently deletes every team, student/instructor account, documentation entry, score,
        and help request for the current event run. Cyber Range definitions, topology, and
        documentation categories are kept. This cannot be undone.
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
        Before wiping anything, every active remote session is ended and every Azure Bastion link on
        the registered environments is revoked and verified, so the previous cohort keeps no way back
        into the range. If students were connecting recently, Azure can need several minutes before it
        accepts the revoke — the page shows progress.
      </p>
      <div
        style={{
          margin: 'var(--space-md) 0',
          padding: 'var(--space-md)',
          border: '1px solid var(--signal-tertiary)',
          borderRadius: 'var(--radius-container)',
          background: 'var(--surface-1)',
        }}
      >
        <div style={{ color: 'var(--text-primary)', fontSize: 15, marginBottom: 'var(--space-sm)' }}>
          First, keep the results — nothing can be recovered after the reset.
        </div>
        <ExportResultsButtons />
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
        Type <strong style={{ color: 'var(--text-primary)' }}>{CONFIRMATION_PHRASE}</strong> to
        confirm.
      </p>
      <input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={CONFIRMATION_PHRASE}
        aria-label="Confirmation phrase"
        style={{
          width: '100%',
          background: 'var(--surface-1)',
          border: '1px solid var(--signal-alert)',
          borderRadius: 'var(--radius-control)',
          padding: 8,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          marginBottom: 'var(--space-sm)',
        }}
      />
      {error && <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 15, marginBottom: 8 }}>{error}</div>}
      {phase && (
        <div role="status" style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 8 }}>
          {phase}… <span style={{ color: 'var(--text-telemetry)' }}>(keep this page open)</span>
        </div>
      )}

      {refused && (
        <>
          <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 15 }}>
            The event was NOT reset: the remote-access revoke could not be verified.
          </div>
          {refused.remoteAccess && <RemoteAccessSummary result={refused.remoteAccess} endedSessions={refused.endedSessions} />}
        </>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <Button variant="destructive" disabled={!phraseOk || mutation.isPending} onClick={() => mutation.mutate(false)}>
          {mutation.isPending ? 'Resetting…' : refused ? 'Retry reset' : 'Reset event permanently'}
        </Button>
        {refused && (
          <Button
            variant="ghost"
            disabled={!phraseOk || mutation.isPending}
            onClick={async () => {
              const ok = await confirmAction({
                title: 'Reset anyway?',
                message:
                  'Some Bastion links may still be live — revoke them in the Azure portal (Bastion → Shareable links) right after. This override is recorded in the audit log.',
                confirmLabel: 'Reset anyway',
                danger: true,
              });
              if (ok) mutation.mutate(true);
            }}
          >
            Reset anyway (links unverified)
          </Button>
        )}
      </div>
    </div>
  );
}
