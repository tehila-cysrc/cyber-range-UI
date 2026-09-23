import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import teamsRoutes from './routes/teams.routes.js';
import documentationRoutes from './routes/documentation.routes.js';
import investigationCanvasRoutes from './routes/investigationCanvas.routes.js';
import cyberRangesRoutes from './routes/cyberRanges.routes.js';
import topologyRoutes from './routes/topology.routes.js';
import helpRequestsRoutes from './routes/helpRequests.routes.js';
import adminTeamsRoutes from './routes/admin/teams.routes.js';
import adminProgressRoutes from './routes/admin/progress.routes.js';
import adminTopologyRoutes from './routes/admin/topology.routes.js';
import adminHelpRequestsRoutes from './routes/admin/helpRequests.routes.js';
import adminDashboardRoutes from './routes/admin/dashboard.routes.js';
import adminPressureThresholdsRoutes from './routes/admin/pressureThresholds.routes.js';
import adminScoringRoutes from './routes/admin/scoring.routes.js';
import adminScoringConfigRoutes from './routes/admin/scoringConfig.routes.js';
import leaderboardRoutes from './routes/leaderboard.routes.js';
import historyRoutes from './routes/history.routes.js';
import adminEventRoutes from './routes/admin/event.routes.js';
import adminUsersRoutes from './routes/admin/users.routes.js';
import adminEnvironmentsRoutes from './routes/admin/environments.routes.js';
import accessSessionsRoutes from './routes/accessSessions.routes.js';
import adminAccessSessionsRoutes from './routes/admin/accessSessions.routes.js';
import adminAuditLogRoutes from './routes/admin/auditLog.routes.js';
import adminCyberRangesRoutes from './routes/admin/cyberRanges.routes.js';
import adminScriptsRoutes from './routes/admin/scripts.routes.js';
import mitreRoutes from './routes/mitre.routes.js';
import adminTtpRoutes from './routes/admin/ttp.routes.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' }));
  // Default 100kb is too small for a documentation entry's optional base64 image attachment.
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/teams', teamsRoutes);
  app.use('/api', documentationRoutes);
  app.use('/api', investigationCanvasRoutes);
  app.use('/api', cyberRangesRoutes);
  app.use('/api', topologyRoutes);
  app.use('/api', helpRequestsRoutes);
  app.use('/api/admin', adminTeamsRoutes);
  app.use('/api/admin', adminProgressRoutes);
  app.use('/api/admin', adminTopologyRoutes);
  app.use('/api/admin', adminHelpRequestsRoutes);
  app.use('/api/admin', adminDashboardRoutes);
  app.use('/api/admin', adminPressureThresholdsRoutes);
  app.use('/api/admin', adminScoringRoutes);
  app.use('/api/admin', adminScoringConfigRoutes);
  app.use('/api', leaderboardRoutes);
  app.use('/api', historyRoutes);
  app.use('/api/admin', adminEventRoutes);
  app.use('/api/admin', adminUsersRoutes);
  app.use('/api/admin', adminEnvironmentsRoutes);
  app.use('/api/teams', accessSessionsRoutes);
  app.use('/api/admin', adminAccessSessionsRoutes);
  app.use('/api/admin', adminAuditLogRoutes);
  app.use('/api/admin', adminCyberRangesRoutes);
  app.use('/api/admin', adminScriptsRoutes);
  app.use('/api', mitreRoutes);
  app.use('/api/admin', adminTtpRoutes);

  // Express's default handler answers an unhandled throw (e.g. a FOREIGN KEY failure) with an HTML
  // page containing the full stack trace and absolute server paths — never send that to a client.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const isBadJson = (err as { type?: string })?.type === 'entity.parse.failed';
    const isTooLarge = (err as { type?: string })?.type === 'entity.too.large';
    if (isBadJson || isTooLarge) {
      res.status(isTooLarge ? 413 : 400).json({ error: isTooLarge ? 'request body too large' : 'malformed JSON body' });
      return;
    }
    console.error('[api] unhandled error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
