import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ProtectedRoute } from './ProtectedRoute';
import { LoginPage } from '../features/auth/LoginPage';
import { TeamWorkspacePage } from '../features/team/TeamWorkspacePage';
import { InvestigationPage } from '../features/documentation/InvestigationPage';
import { TopologyViewerPage } from '../features/topology/TopologyViewerPage';
import { TopologyAdminPage } from '../features/topology/admin/TopologyAdminPage';
import { InstructorDashboardPage } from '../features/instructorDashboard/InstructorDashboardPage';
import { HomeRoute } from './HomeRoute';
import { ProgressPage } from '../features/scoring/ProgressPage';
import { LeaderboardPage } from '../features/leaderboard/LeaderboardPage';
import { HistoryPage } from '../features/history/HistoryPage';
import { CyberRangeSummaryPage } from '../features/history/CyberRangeSummaryPage';
import { EventSummaryPage } from '../features/history/EventSummaryPage';
import { EventResetPage } from '../features/admin/EventResetPage';

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
      { path: '/topology', element: <TopologyViewerPage /> },
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
            <TopologyAdminPage />
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
    ],
  },
]);
