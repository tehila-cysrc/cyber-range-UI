import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ProtectedRoute } from './ProtectedRoute';
import { LoginPage } from '../features/auth/LoginPage';
import { TeamWorkspacePage } from '../features/team/TeamWorkspacePage';
import { InvestigationPage } from '../features/documentation/InvestigationPage';
import { InstructorDashboardPage } from '../features/instructorDashboard/InstructorDashboardPage';
import { HomeRoute } from './HomeRoute';
import { ProgressPage } from '../features/scoring/ProgressPage';
import { LeaderboardPage } from '../features/leaderboard/LeaderboardPage';
import { HistoryPage } from '../features/history/HistoryPage';
import { CyberRangeSummaryPage } from '../features/history/CyberRangeSummaryPage';
import { EventSummaryPage } from '../features/history/EventSummaryPage';
import { EventResetPage } from '../features/admin/EventResetPage';
import { TeamsAdminPage } from '../features/admin/TeamsAdminPage';
import { EnvironmentsAdminPage } from '../features/environments/EnvironmentsAdminPage';
import { AuditLogPage } from '../features/admin/AuditLogPage';
import { ScriptLibraryPage } from '../features/scripts/ScriptLibraryPage';

// React Flow (topology) is the single largest dependency in the bundle — code-split it into its
// own chunk so it only loads for users who actually open a topology screen (see BACKLOG.md).
const TopologyViewerPage = lazy(() =>
  import('../features/topology/TopologyViewerPage').then((m) => ({ default: m.TopologyViewerPage })),
);
const TopologyAdminPage = lazy(() =>
  import('../features/topology/admin/TopologyAdminPage').then((m) => ({ default: m.TopologyAdminPage })),
);

// Instructor-only, rarely opened — kept out of the main bundle like the topology screens.
const ScenarioConfigPage = lazy(() =>
  import('../features/scenarios/ScenarioConfigPage').then((m) => ({ default: m.ScenarioConfigPage })),
);

function TopologyFallback() {
  return <div style={{ padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>Loading topology…</div>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { path: '/', element: <HomeRoute /> },
      { path: '/investigation', element: <InvestigationPage /> },
      {
        path: '/topology',
        element: (
          <Suspense fallback={<TopologyFallback />}>
            <TopologyViewerPage />
          </Suspense>
        ),
      },
      { path: '/progress', element: <ProgressPage /> },
      { path: '/team', element: <TeamWorkspacePage /> },
      { path: '/leaderboard', element: <LeaderboardPage /> },
      { path: '/debrief', element: <HistoryPage /> },
      { path: '/debrief/event-summary', element: <EventSummaryPage /> },
      { path: '/debrief/:cyberRangeId', element: <CyberRangeSummaryPage /> },
      {
        path: '/instructor',
        element: (
          <ProtectedRoute requireRole="instructor">
            <InstructorDashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/topology',
        element: (
          <ProtectedRoute requireRole="instructor">
            <Suspense fallback={<TopologyFallback />}>
              <TopologyAdminPage />
            </Suspense>
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/teams',
        element: (
          <ProtectedRoute requireRole="instructor">
            <TeamsAdminPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/event-reset',
        element: (
          <ProtectedRoute requireRole="instructor">
            <EventResetPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/environments',
        element: (
          <ProtectedRoute requireRole="instructor">
            <EnvironmentsAdminPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/audit-log',
        element: (
          <ProtectedRoute requireRole="instructor">
            <AuditLogPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/scripts',
        element: (
          <ProtectedRoute requireRole="instructor">
            <ScriptLibraryPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/scenarios',
        element: (
          <ProtectedRoute requireRole="instructor">
            <Suspense fallback={<div style={{ padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>Loading…</div>}>
              <ScenarioConfigPage />
            </Suspense>
          </ProtectedRoute>
        ),
      },
    ],
  },
]);
