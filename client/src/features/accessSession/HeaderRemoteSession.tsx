import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { AccessSessionPanel, type ActiveAccessSession } from './AccessSessionPanel';

// A student's live remote session (link, login, disconnect) used to be reachable only on the Topology
// page — going back to the timeline meant losing the credentials mid-investigation (UX audit UX-22).
// This header pill opens the same panel from any page.
export function HeaderRemoteSession() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['access-session-active', 'header'],
    queryFn: () => apiFetch<{ session: (ActiveAccessSession & { protocol?: string }) | null }>('/teams/me/access-sessions/active'),
  });
  const session = data?.session ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['access-session-active'] });
  useSocketEvent('access_session:started', refresh);
  useSocketEvent('access_session:ended', refresh);

  const disconnect = useMutation({
    mutationFn: (id: number) => apiFetch(`/teams/me/access-sessions/${id}/end`, { method: 'POST' }),
    onSuccess: () => {
      setOpen(false);
      refresh();
    },
  });

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  if (!session) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Your open remote session"
        style={{
          background: 'transparent',
          border: '1px solid var(--signal-primary)',
          borderRadius: 'var(--radius-control)',
          color: 'var(--signal-primary)',
          padding: '2px 10px',
          fontFamily: 'inherit',
          fontSize: 14,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Connected: {session.nodeLabel}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 36, right: 0, width: 340, zIndex: 20 }}>
          <AccessSessionPanel
            session={session}
            onDisconnect={() => disconnect.mutate(session.accessSessionId)}
            disconnecting={disconnect.isPending}
          />
        </div>
      )}
    </div>
  );
}
