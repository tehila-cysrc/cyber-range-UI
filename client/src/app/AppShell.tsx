import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { useClockStore } from '../stores/clockStore';
import { disconnectSocket, getSocket } from '../lib/socketClient';
import { apiFetch } from '../lib/apiClient';
import { useSocketEvent } from '../hooks/useSocketEvent';
import { Toaster } from '../components/Toaster';
import { ConfirmDialogHost } from '../components/ConfirmDialog';
import { GamifiedEffects } from '../features/leaderboard/GamifiedEffects';
import { UserIcon } from '../components/icons';
import { MissionClockBadge, useActiveCyberRange, useMissionClockSync } from '../features/clock/MissionClock';
import { HelpRequestButton } from '../features/helpRequests/HelpRequestButton';
import { HeaderRemoteSession } from '../features/accessSession/HeaderRemoteSession';
import { useOpenHelpRequestCount, useOwnHelpRequestSync } from '../features/helpRequests/HelpNotifiers';
import logoUrl from '../assets/company-logo.svg';
import appIconUrl from '../assets/app-icon.svg';

// NOTE: docs/DESIGN.md's nav spec lists "Milestones" as the 4th destination. The PRD dropped
// discrete milestones in favor of free-form instructor scoring on documentation (US-007), so this
// destination is deliberately renamed "Progress" here — not a silent oversight, see PROGRESS.txt.
const NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/investigation', label: 'Investigation' },
  { to: '/topology', label: 'Topology' },
  { to: '/progress', label: 'Progress' },
  { to: '/team', label: 'Team' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/debrief', label: 'Debrief' },
];

// Student-only views that have no working instructor equivalent (no team_id, no team-switcher) —
// instructors use the corresponding INSTRUCTOR_NAV_ITEMS entry instead (e.g. Roster for Team).
// Debrief stays: it has an instructor team picker.
const HIDDEN_FOR_INSTRUCTOR = new Set(['/', '/topology', '/team']);

const INSTRUCTOR_NAV_ITEMS = [
  { to: '/instructor', label: 'Instructor' },
  { to: '/admin/scenarios', label: 'Scenarios' },
  { to: '/admin/topology', label: 'Topology Admin' },
  { to: '/admin/scripts', label: 'Script Library' },
  { to: '/admin/teams', label: 'Roster' },
  { to: '/admin/environments', label: 'Environments' },
  { to: '/admin/audit-log', label: 'Audit Log' },
  { to: '/admin/event-reset', label: 'Reset', alert: true },
];

function NavItem({
  to,
  label,
  end,
  alert,
  badge,
}: {
  to: string;
  label: string;
  end?: boolean;
  alert?: boolean;
  badge?: number;
}) {
  const activeColor = alert ? 'var(--signal-alert)' : 'var(--signal-primary)';
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        fontSize: 15,
        fontWeight: 500,
        textDecoration: 'none',
        color: isActive ? (alert ? 'var(--signal-alert)' : 'var(--text-primary)') : 'var(--text-muted)',
        borderBottom: isActive ? `2px solid ${activeColor}` : '2px solid transparent',
        padding: '4px 0',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      })}
    >
      {label}
      {!!badge && (
        <span
          aria-label={`${badge} open help ${badge === 1 ? 'request' : 'requests'}`}
          style={{
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            borderRadius: 9,
            background: 'var(--signal-alert)',
            color: 'var(--surface-floor)',
            fontSize: 12,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}

// Reflects the actual socket.io connection (not a fabricated "live" claim) — every page relies on
// this same socket for realtime updates, so its state is a meaningful, honest status to surface.
function LiveStatusBadge() {
  const [connected, setConnected] = useState(() => getSocket()?.connected ?? false);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    setConnected(socket.connected);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // Deliberately not a bordered badge — boxed next to the account button it read as clickable.
  return (
    <span
      className="live-status"
      role="status"
      data-connected={connected}
      title={connected ? 'Realtime connection active' : 'Realtime connection lost — reconnecting'}
    >
      <span className="live-status-dot" aria-hidden="true" />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

// Collapsed to just a green identity icon per user request — the name/role/sign-out live in a
// small menu revealed on click instead of sitting permanently in the nav bar.
function UserMenu({ displayName, role, onLogout }: { displayName: string; role: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`${displayName} · ${role}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '1px solid var(--signal-primary)',
          background: 'rgba(15, 23, 42, 0.8)',
          color: 'var(--signal-primary)',
          cursor: 'pointer',
        }}
      >
        <UserIcon />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 36,
            right: 0,
            minWidth: 160,
            padding: 'var(--space-sm)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            background: 'var(--surface-1)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-sm)',
            zIndex: 10,
          }}
        >
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-telemetry)' }}>
            {displayName} · {role}
          </div>
          <button
            onClick={onLogout}
            style={{
              background: 'transparent',
              border: '1px solid var(--surface-border)',
              color: 'var(--text-muted)',
              borderRadius: 'var(--radius-control)',
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 14,
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// Students' help request used to live only on Home; this puts it one click away on every page.
function HeaderHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          background: 'transparent',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-control)',
          color: 'var(--text-muted)',
          padding: '2px 10px',
          fontFamily: 'inherit',
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        Help
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 36,
            right: 0,
            padding: 'var(--space-md)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            background: 'var(--surface-1)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            zIndex: 20,
          }}
        >
          <HelpRequestButton compact onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const { user, clear } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resetClock = useClockStore((s) => s.reset);
  const isStudent = user?.role === 'student';
  const isInstructor = user?.role === 'instructor';
  useMissionClockSync(isStudent);
  useOwnHelpRequestSync(isStudent);
  const openHelpCount = useOpenHelpRequestCount(isInstructor);
  const { data: activeRange } = useActiveCyberRange(isStudent);
  // Students don't need a Leaderboard tab that only says "not enabled"; the instructor keeps it
  // (they switch it on from the Dashboard and may want to preview it).
  const { data: leaderboard } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => apiFetch<{ enabled: boolean; teams: unknown[] }>('/leaderboard'),
    enabled: isStudent,
  });
  useSocketEvent<{ teams: unknown[]; enabled?: boolean }>('leaderboard:update', ({ teams, enabled }) => {
    queryClient.setQueryData(['leaderboard'], { enabled: enabled ?? true, teams });
  });

  // Mounted once for every page: when the instructor assigns/switches/completes this team's
  // scenario, every open view (Home clock, Investigation, Topology, Debrief) must follow — without it
  // a student kept writing to, and timing, the previous scenario until a manual refresh.
  useSocketEvent<{ teamId: number }>('progress:changed', () => {
    resetClock();
    queryClient.invalidateQueries({ queryKey: ['active-cyber-range'] });
    queryClient.invalidateQueries({ queryKey: ['history'] });
    queryClient.invalidateQueries({ queryKey: ['event-summary'] });
    queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
  });

  async function handleLogout() {
    // Revoke the token server-side too — otherwise it stays valid for its full 12h TTL on a shared
    // lab machine, even though the UI looks signed out.
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    disconnectSocket();
    clear();
    navigate('/login');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav className="app-nav" aria-label="Main">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <img src={appIconUrl} alt="" style={{ width: 40, height: 40, borderRadius: 'var(--radius-control)' }} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--text-primary)',
            }}
          >
            Cyber Range
          </span>
        </div>

        <div className="app-nav-links">
          {NAV_ITEMS.filter((item) => !isInstructor || !HIDDEN_FOR_INSTRUCTOR.has(item.to))
            .filter((item) => !(isStudent && item.to === '/leaderboard' && leaderboard && !leaderboard.enabled))
            .map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          {isInstructor &&
            INSTRUCTOR_NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} badge={item.to === '/instructor' ? openHelpCount : undefined} />
            ))}
        </div>

        {isStudent && activeRange?.active && <HeaderRemoteSession />}
        {isStudent && <MissionClockBadge />}
        {isStudent && activeRange?.active && <HeaderHelp />}

        {user && <LiveStatusBadge />}
        {user && <UserMenu displayName={user.displayName} role={user.role} onLogout={handleLogout} />}
      </nav>

      <main style={{ flex: 1, maxWidth: 'var(--layout-max-width)', width: '100%', margin: '0 auto' }}>
        <Outlet />
      </main>

      <footer
        style={{
          borderTop: '1px solid var(--surface-border)',
          background: 'var(--surface-1)',
          padding: 'var(--space-md) var(--space-lg)',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <img src={logoUrl} alt="" style={{ height: 20, opacity: 0.7 }} />
      </footer>

      <GamifiedEffects />
      <Toaster />
      <ConfirmDialogHost />
    </div>
  );
}
