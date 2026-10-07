import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { AccessSessionPanel, type ActiveAccessSession } from './AccessSessionPanel';

// A live remote session (link, login, disconnect) used to be reachable only on the Topology page —
// going back to the timeline meant losing the credentials mid-investigation (UX audit UX-22). This
// header pill opens the session box from any page; it's also where Connect lands (the box opens
// itself — see openRemoteSessionBox). Students see their own session, instructors their own
// diagnostic Connect session.
const OPEN_EVENT = 'remote-session:open';

export function openRemoteSessionBox() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function remoteSessionEndpoints(role: 'student' | 'instructor') {
  return role === 'instructor'
    ? {
        active: '/admin/access-sessions/mine',
        credential: (id: number) => `/admin/access-sessions/${id}/credential`,
        end: (id: number) => `/admin/access-sessions/${id}/force-close`,
      }
    : {
        active: '/teams/me/access-sessions/active',
        credential: (id: number) => `/teams/me/access-sessions/${id}/credential`,
        end: (id: number) => `/teams/me/access-sessions/${id}/end`,
      };
}

export function HeaderRemoteSession({ role }: { role: 'student' | 'instructor' }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const endpoints = remoteSessionEndpoints(role);

  const { data } = useQuery({
    queryKey: ['access-session-active', 'header', role],
    queryFn: () => apiFetch<{ session: (ActiveAccessSession & { protocol?: string }) | null }>(endpoints.active),
  });
  const session = data?.session ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['access-session-active'] });
  useSocketEvent('access_session:started', refresh);
  useSocketEvent('access_session:ended', refresh);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      queryClient.invalidateQueries({ queryKey: ['access-session-active'] });
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [queryClient]);

  const disconnect = useMutation({
    mutationFn: (id: number) => apiFetch(endpoints.end(id), { method: 'POST' }),
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
            credentialPath={endpoints.credential(session.accessSessionId)}
            onDisconnect={() => disconnect.mutate(session.accessSessionId)}
            disconnecting={disconnect.isPending}
          />
        </div>
      )}
    </div>
  );
}
