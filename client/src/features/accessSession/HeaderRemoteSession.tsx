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

  // The box floats at the centre of the screen and can be dragged anywhere by its non-interactive
  // parts; it stays open while the student works on the page (closed via × or the pill), and keeps
  // its position for the rest of the page session.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || pos || !boxRef.current) return;
    const { width, height } = boxRef.current.getBoundingClientRect();
    setPos({ x: Math.max(8, (window.innerWidth - width) / 2), y: Math.max(8, (window.innerHeight - height) / 2) });
  }, [open, pos, session]);

  function startDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button, a, input') || !boxRef.current) return;
    e.preventDefault();
    const rect = boxRef.current.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const onMove = (ev: MouseEvent) =>
      setPos({
        x: Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - rect.width),
        y: Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - rect.height),
      });
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  if (!session) return null;

  return (
    <div style={{ position: 'relative' }}>
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
        <div
          ref={boxRef}
          onMouseDown={startDrag}
          style={{
            position: 'fixed',
            left: pos?.x ?? 0,
            top: pos?.y ?? 0,
            visibility: pos ? 'visible' : 'hidden',
            width: 340,
            zIndex: 50,
            cursor: 'move',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
            borderRadius: 'var(--radius-container)',
          }}
        >
          <AccessSessionPanel
            session={session}
            credentialPath={endpoints.credential(session.accessSessionId)}
            onDisconnect={() => disconnect.mutate(session.accessSessionId)}
            disconnecting={disconnect.isPending}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
