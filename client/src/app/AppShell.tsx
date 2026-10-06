import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { useClockStore } from '../stores/clockStore';
import { disconnectSocket, getSocket } from '../lib/socketClient';
import { apiFetch } from '../lib/apiClient';
import { useSocketEvent } from '../hooks/useSocketEvent';
import { Toaster } from '../components/Toaster';
import { ConfirmDialogHost } from '../components/ConfirmDialog';
import { GamifiedEffects } from '../features/leaderboard/GamifiedEffects';
import { GearIcon, UserIcon } from '../components/icons';
import { ProfileDialog } from '../features/auth/ProfileDialog';
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

type NavLinkItem = { to: string; label: string; end?: boolean; alert?: boolean };
type NavGroup = { label: string; items: NavLinkItem[] };

// The instructor bar is grouped by when each page is used (during the event / before it) instead of
// one flat row of 12 tabs. The student-only views (Home, Topology, Team) have no instructor entry. Labels describe the instructor's view of the page — e.g. /investigation
// is reading a team's timeline, not investigating. Routes are unchanged; only labels differ.
const INSTRUCTOR_DASHBOARD: NavLinkItem = { to: '/instructor', label: 'Live Dashboard' };
const INSTRUCTOR_GROUPS: NavGroup[] = [
  {
    label: 'Monitor',
    items: [
      { to: '/investigation', label: 'Team Timelines' },
      { to: '/progress', label: 'Team Scores' },
      { to: '/leaderboard', label: 'Leaderboard' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/admin/scenarios', label: 'Scenarios' },
      { to: '/admin/topology', label: 'Topology Builder' },
      { to: '/admin/teams', label: 'Teams & Students' },
      { to: '/admin/environments', label: 'Cloud Environments' },
      { to: '/admin/scripts', label: 'Training Scripts' },
    ],
  },
];
const INSTRUCTOR_DEBRIEF: NavLinkItem = { to: '/debrief', label: 'Debrief' };
// Rare / destructive actions live behind the gear, out of the main row.
const INSTRUCTOR_SYSTEM: NavGroup = {
  label: 'System',
  items: [
    { to: '/admin/audit-log', label: 'Activity Log' },
    { to: '/admin/event-reset', label: 'Reset Event…', alert: true },
  ],
};

function isUnder(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

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

// A nav-bar group that opens a small menu of links. The menu is position:fixed (placed from the
// trigger's rect) because under 700px the links row scrolls horizontally and would clip an
// absolutely-positioned menu.
function NavDropdown({
  group,
  trigger,
  align = 'left',
}: {
  group: NavGroup;
  trigger?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  const { pathname } = useLocation();
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;
  const activeItem = group.items.find((item) => isUnder(pathname, item.to));
  const anyAlert = activeItem?.alert;

  useEffect(() => setPos(null), [pathname]);

  useEffect(() => {
    if (!open) return;
    function close(e: Event) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setPos(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPos(null);
        buttonRef.current?.focus();
      }
    }
    const onScrollOrResize = () => setPos(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  function toggle() {
    if (open) return setPos(null);
    const rect = buttonRef.current!.getBoundingClientRect();
    setPos(
      align === 'right'
        ? { top: rect.bottom + 6, right: window.innerWidth - rect.right }
        : { top: rect.bottom + 6, left: rect.left },
    );
  }

  const activeColor = anyAlert ? 'var(--signal-alert)' : 'var(--signal-primary)';
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={trigger ? group.label : undefined}
        title={trigger ? group.label : undefined}
        className={trigger ? 'nav-icon-button' : 'nav-group-button'}
        data-active={!!activeItem}
        style={
          trigger
            ? { color: activeItem ? activeColor : undefined }
            : { borderBottomColor: activeItem ? activeColor : 'transparent' }
        }
      >
        {trigger ?? (
          <>
            {group.label}
            {activeItem && <span className="nav-group-current">: {activeItem.label}</span>}
            <span aria-hidden="true" className="nav-group-caret">
              ▾
            </span>
          </>
        )}
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={group.label} className="nav-menu" style={pos}>
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              role="menuitem"
              className="nav-menu-item"
              data-alert={item.alert || undefined}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </>
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
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const menuButtonStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid var(--surface-border)',
    color: 'var(--text-muted)',
    borderRadius: 'var(--radius-control)',
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 14,
  };

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
            onClick={() => {
              setOpen(false);
              setEditing(true);
            }}
            style={menuButtonStyle}
          >
            Edit profile
          </button>
          <button onClick={onLogout} style={menuButtonStyle}>
            Sign out
          </button>
        </div>
      )}
      {editing && <ProfileDialog onClose={() => setEditing(false)} />}
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
          {isInstructor ? (
            <>
              <NavItem {...INSTRUCTOR_DASHBOARD} badge={openHelpCount} />
              {INSTRUCTOR_GROUPS.map((group) => (
                <NavDropdown key={group.label} group={group} />
              ))}
              <NavItem {...INSTRUCTOR_DEBRIEF} />
            </>
          ) : (
            NAV_ITEMS.filter((item) => !(isStudent && item.to === '/leaderboard' && leaderboard && !leaderboard.enabled))
              .map((item) => <NavItem key={item.to} {...item} />)
          )}
        </div>

        {isStudent && activeRange?.active && <HeaderRemoteSession />}
        {isStudent && <MissionClockBadge />}
        {isStudent && activeRange?.active && <HeaderHelp />}

        {user && <LiveStatusBadge />}
        {isInstructor && <NavDropdown group={INSTRUCTOR_SYSTEM} trigger={<GearIcon />} align="right" />}
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
