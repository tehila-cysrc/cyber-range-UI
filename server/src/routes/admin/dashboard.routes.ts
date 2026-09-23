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

  // Live progress signals for the active scenario, so an instructor can spot a stalled team (no
  // entries for a while) without opening each team's timeline one by one.
  const activityStmt = db.prepare(
    `SELECT COUNT(*) AS entryCount,
            COALESCE(SUM(is_important_finding), 0) AS findingCount,
            MAX(created_at) AS lastEntryAt
     FROM documentation_entries WHERE team_id = ? AND cyber_range_id = ?`,
  );
  const totalPointsStmt = db.prepare('SELECT COALESCE(SUM(points), 0) AS total FROM scores WHERE team_id = ?');
  const memberCountStmt = db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_id = ? AND role = 'student'");

  const result = teams.map((team) => {
    const active = activeStmt.get(team.id) as ActiveRow | undefined;
    const openHelpCount = (openHelpCountStmt.get(team.id) as { n: number }).n;
    const completedCount = (completedCountStmt.get(team.id) as { n: number }).n;
    const activity = active
      ? (activityStmt.get(team.id, active.cyberRangeId) as { entryCount: number; findingCount: number; lastEntryAt: string | null })
      : null;

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
            entryCount: activity!.entryCount,
            findingCount: activity!.findingCount,
            lastEntryAt: activity!.lastEntryAt,
          }
        : null,
      openHelpCount,
      completedCount,
      totalPoints: (totalPointsStmt.get(team.id) as { total: number }).total,
      memberCount: (memberCountStmt.get(team.id) as { n: number }).n,
    };
  });

  res.json({ teams: result });
});

export default router;
