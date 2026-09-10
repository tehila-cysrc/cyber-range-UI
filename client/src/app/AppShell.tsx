import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { disconnectSocket } from '../lib/socketClient';
import { GamifiedEffects } from '../features/leaderboard/GamifiedEffects';
import { Avatar } from '../components/Avatar';

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

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-md)',
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            color: 'var(--text-telemetry)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {user?.displayName && <Avatar name={user.displayName} size={22} />}
            {user?.displayName} · {user?.role}
          </span>
          <button
            onClick={handleLogout}
            style={{
              background: 'transparent',
              border: '1px solid var(--surface-border)',
              color: 'var(--text-muted)',
              borderRadius: 'var(--radius-control)',
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Sign out
          </button>
        </div>
      </nav>

      <main style={{ flex: 1, maxWidth: 'var(--layout-max-width)', width: '100%', margin: '0 auto' }}>
        <Outlet />
      </main>

      <GamifiedEffects />
    </div>
  );
}
