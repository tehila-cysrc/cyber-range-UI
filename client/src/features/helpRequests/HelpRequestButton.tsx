import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { LifeBuoyIcon } from '../../components/icons';

export interface OwnHelpRequest {
  id: number;
  createdAt: string;
  message: string | null;
  requestedByName: string;
}

export const OWN_HELP_REQUEST_KEY = ['help-request-mine'];

export function useOwnHelpRequest() {
  return useQuery({
    queryKey: OWN_HELP_REQUEST_KEY,
    queryFn: () => apiFetch<{ helpRequest: OwnHelpRequest | null }>('/help-requests/mine'),
  });
}

function minutesAgo(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return mins === 0 ? 'just now' : `${mins}m ago`;
}

// The team's request stays visible as "waiting" until the instructor resolves it (or the scenario
// ends) — for every teammate and across page changes, instead of an 8-second confirmation.
export function HelpRequestButton({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const { data } = useOwnHelpRequest();
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ alreadyOpen?: boolean }>('/help-requests', {
        method: 'POST',
        body: JSON.stringify({ message: message.trim() || undefined }),
      }),
    onSuccess: () => {
      setError(null);
      setComposing(false);
      setMessage('');
      queryClient.invalidateQueries({ queryKey: OWN_HELP_REQUEST_KEY });
      onDone?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to send help request'),
  });

  const open = data?.helpRequest;

  if (open) {
    return (
      <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, maxWidth: 420 }}>
        <span style={{ color: 'var(--signal-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <LifeBuoyIcon />
          Waiting for the instructor · {open.requestedByName} asked {minutesAgo(open.createdAt)}
        </span>
        {open.message && <span style={{ color: 'var(--text-muted)' }}>“{open.message}”</span>}
      </div>
    );
  }

  if (!composing) {
    return (
      <Button
        variant="ghost"
        onClick={() => setComposing(true)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...(compact ? { padding: '4px 10px', fontSize: 14 } : {}) }}
      >
        <LifeBuoyIcon />
        {compact ? 'Help' : 'Request instructor help'}
      </Button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, width: compact ? 280 : 420, maxWidth: '100%' }}
    >
      <label style={{ fontSize: 14, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        What do you need? (optional)
        <textarea
          autoFocus
          value={message}
          maxLength={500}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. We can't find where the attacker got in"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
            padding: 8,
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            fontSize: 14,
            resize: 'vertical',
          }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Sending…' : 'Send to instructor'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setComposing(false)}>
          Cancel
        </Button>
      </div>
      {error && <span style={{ fontSize: 14, color: 'var(--signal-alert)' }}>{error}</span>}
    </form>
  );
}
