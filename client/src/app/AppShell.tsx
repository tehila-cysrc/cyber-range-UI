import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { disconnectSocket } from '../lib/socketClient';
import { GamifiedEffects } from '../features/leaderboard/GamifiedEffects';
import { UserIcon } from '../components/icons';
import logoUrl from '../assets/company-logo.svg';

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

const INSTRUCTOR_NAV_ITEMS = [
  { to: '/instructor', label: 'Instructor' },
  { to: '/admin/topology', label: 'Topology Admin' },
  { to: '/admin/teams', label: 'Roster' },
  { to: '/admin/environments', label: 'Environments' },
  { to: '/admin/audit-log', label: 'Audit Log' },
  { to: '/admin/event-reset', label: 'Reset', alert: true },
];

function NavItem({ to, label, end, alert }: { to: string; label: string; end?: boolean; alert?: boolean }) {
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
      })}
    >
      {label}
    </NavLink>
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

export function AppShell() {
  const { user, clear } = useAuthStore();
  const navigate = useNavigate();

  function handleLogout() {
    disconnectSocket();
    clear();
    navigate('/login');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav
        style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-lg)',
          padding: '0 var(--space-lg)',
          borderBottom: '1px solid var(--surface-border)',
          background: 'var(--surface-1)',
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--signal-primary)',
          }}
        />

        <div style={{ display: 'flex', gap: 'var(--space-md)', flex: 1 }}>
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
          {user?.role === 'instructor' &&
            INSTRUCTOR_NAV_ITEMS.map((item) => <NavItem key={item.to} {...item} />)}
        </div>

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
    </div>
  );
}
