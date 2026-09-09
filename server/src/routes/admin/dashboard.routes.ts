import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

interface TeamRow {
  id: number;
  name: string;
}

interface ActiveRow {
  cyberRangeId: number;
  name: string;
  difficulty: string;
  dayLabel: string;
  startedAt: string;
  timeLimitSeconds: number | null;
}

// US-006: instructor sees every team from one view — day, active range, time remaining, progress
// state, open help request count. Renders as an array so the client can grid N teams, not 2.
router.get('/dashboard', (_req, res) => {
  const teams = db.prepare('SELECT id, name FROM teams ORDER BY sort_order').all() as unknown as TeamRow[];

  const activeStmt = db.prepare(
    `SELECT
       cr.id AS cyberRangeId, cr.name AS name, cr.difficulty AS difficulty, d.label AS dayLabel,
       p.started_at AS startedAt, p.time_limit_seconds AS timeLimitSeconds
     FROM team_cyber_range_progress p
     JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
     JOIN days d ON d.id = cr.day_id
     WHERE p.team_id = ? AND p.status = 'active'
     LIMIT 1`,
  );

  const openHelpCountStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM help_requests WHERE team_id = ? AND status = 'open'`,
  );

  const completedCountStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM team_cyber_range_progress WHERE team_id = ? AND status = 'completed'`,
  );

  const result = teams.map((team) => {
    const active = activeStmt.get(team.id) as ActiveRow | undefined;
    const openHelpCount = (openHelpCountStmt.get(team.id) as { n: number }).n;
    const completedCount = (completedCountStmt.get(team.id) as { n: number }).n;

    const remainingSeconds =
      active?.timeLimitSeconds != null
        ? Math.max(
            0,
            active.timeLimitSeconds -
              Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000),
          )
        : null;

    return {
      teamId: team.id,
      teamName: team.name,
      active: active
        ? {
            cyberRangeId: active.cyberRangeId,
            name: active.name,
            difficulty: active.difficulty,
            dayLabel: active.dayLabel,
            remainingSeconds,
          }
        : null,
      openHelpCount,
      completedCount,
    };
  });

  res.json({ teams: result });
});

export default router;
