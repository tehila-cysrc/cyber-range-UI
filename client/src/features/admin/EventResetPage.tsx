import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';

const CONFIRMATION_PHRASE = 'RESET EVENT';

interface ResetResponse {
  newInstructor: { username: string; password: string };
}

export function EventResetPage() {
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState<ResetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<ResetResponse>('/admin/event/reset', {
        method: 'POST',
        body: JSON.stringify({ confirm: confirmText }),
      }),
    onSuccess: (data) => {
      setError(null);
      // Deliberately NOT clearing local auth state here: this page lives behind ProtectedRoute, and
      // clearing the token would immediately redirect to /login before the instructor can read the
      // new credentials below. The old token is already dead server-side (cascaded away with the
      // wiped run) — apiClient's existing 401 handling clears it on the next failed request, and the
      // "Go to login" link below does a full navigation away from this protected tree anyway.
      setResult(data);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Reset failed');
    },
  });

  if (result) {
    return (
      <div style={{ padding: 'var(--space-xl)' }}>
        <h1 style={{ fontSize: 22, color: 'var(--signal-primary)' }}>Event reset complete</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          All teams, accounts, documentation, scores, and help requests have been wiped. Cyber Range
          definitions, topology, and categories were preserved.
        </p>
        <p style={{ color: 'var(--text-primary)' }}>
          Log back in as: <code>{result.newInstructor.username}</code> /{' '}
          <code>{result.newInstructor.password}</code>
        </p>
        <a href="/login" style={{ color: 'var(--signal-secondary)' }}>
          Go to login →
        </a>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-xl)', maxWidth: 480 }}>
      <h1 style={{ fontSize: 22, color: 'var(--signal-alert)', margin: '0 0 var(--space-sm)' }}>
        Reset Event
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
        This permanently deletes every team, student/instructor account, documentation entry, score,
        and help request for the current event run. Cyber Range definitions, topology, and
        documentation categories are kept. This cannot be undone.
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
        Type <strong style={{ color: 'var(--text-primary)' }}>{CONFIRMATION_PHRASE}</strong> to
        confirm.
      </p>
      <input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={CONFIRMATION_PHRASE}
        style={{
          width: '100%',
          background: 'transparent',
          border: '1px solid var(--signal-alert)',
          borderRadius: 'var(--radius-control)',
          padding: 8,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          marginBottom: 'var(--space-sm)',
        }}
      />
      {error && <div style={{ color: 'var(--signal-alert)', fontSize: 15, marginBottom: 8 }}>{error}</div>}
      <Button
        variant="destructive"
        disabled={confirmText !== CONFIRMATION_PHRASE || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Resetting…' : 'Reset event permanently'}
      </Button>
    </div>
  );
}
