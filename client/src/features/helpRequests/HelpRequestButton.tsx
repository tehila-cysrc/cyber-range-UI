import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { LifeBuoyIcon } from '../../components/icons';

export function HelpRequestButton() {
  const [justSent, setJustSent] = useState<'sent' | 'already' | false>(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiFetch<{ alreadyOpen?: boolean }>('/help-requests', { method: 'POST' }),
    onSuccess: (res) => {
      setError(null);
      // The server keeps one open request per team, so a second click doesn't spam the instructor.
      setJustSent(res?.alreadyOpen ? 'already' : 'sent');
      setTimeout(() => setJustSent(false), 8000);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to send help request');
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <Button
        variant="ghost"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <LifeBuoyIcon />
        {mutation.isPending ? 'Sending…' : 'Request instructor help'}
      </Button>
      {justSent && (
        <span role="status" style={{ fontSize: 14, color: 'var(--signal-primary)' }}>
          {justSent === 'already'
            ? 'Your team already has an open request — the instructor has it and will come to you.'
            : 'Sent — the instructor has been notified.'}
        </span>
      )}
      {error && <span style={{ fontSize: 14, color: 'var(--signal-alert)' }}>{error}</span>}
    </div>
  );
}
