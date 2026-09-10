import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { LifeBuoyIcon } from '../../components/icons';

export function HelpRequestButton() {
  const [justSent, setJustSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiFetch('/help-requests', { method: 'POST' }),
    onSuccess: () => {
      setError(null);
      setJustSent(true);
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
        <span style={{ fontSize: 14, color: 'var(--signal-primary)' }}>
          Sent — the instructor has been notified.
        </span>
      )}
      {error && <span style={{ fontSize: 14, color: 'var(--signal-alert)' }}>{error}</span>}
    </div>
  );
}
