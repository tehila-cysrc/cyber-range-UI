import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

function requireTeam(req: import('express').Request, res: import('express').Response): number | null {
  if (req.user!.role === 'instructor') {
    res.status(400).json({ error: 'instructor has no team — use /api/admin/teams' });
    return null;
  }
  if (!req.user!.teamId) {
    res.status(409).json({ error: 'user has no team assigned' });
    return null;
  }
  return req.user!.teamId;
}

// US-002: team workspace — own team's members, without exposing the other team's data.
router.get('/me', (req, res) => {
  const teamId = requireTeam(req, res);
  if (teamId === null) return;

  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId);
  const members = db
    .prepare(
      'SELECT id, username, display_name AS displayName FROM users WHERE team_id = ? ORDER BY display_name',
    )
    .all(teamId);

  res.json({ team, members });
});

interface ActiveProgressRow {
  progressId: number;
  cyberRangeId: number;
  name: string;
  difficulty: string;
  expectedDurationMinutes: number | null;
  dayKey: string;
  dayLabel: string;
  status: string;
  startedAt: string | null;
  timeLimitSeconds: number | null;
}

// US-001: active Cyber Range view — day, name, difficulty, configured time.
router.get('/me/active-cyber-range', (req, res) => {
  const teamId = requireTeam(req, res);
  if (teamId === null) return;

  const row = db
    .prepare(
      `SELECT
         p.id AS progressId,
         cr.id AS cyberRangeId,
         cr.name AS name,
         cr.difficulty AS difficulty,
         cr.expected_duration_minutes AS expectedDurationMinutes,
         d.key AS dayKey,
         d.label AS dayLabel,
         p.status AS status,
         p.started_at AS startedAt,
         p.time_limit_seconds AS timeLimitSeconds
       FROM team_cyber_range_progress p
       JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
       JOIN days d ON d.id = cr.day_id
       WHERE p.team_id = ? AND p.status = 'active'
       LIMIT 1`,
    )
    .get(teamId) as ActiveProgressRow | undefined;

  if (!row) {
    res.json({ active: null });
    return;
  }

  const remainingSeconds =
    row.timeLimitSeconds != null && row.startedAt
      ? Math.max(
          0,
          row.timeLimitSeconds - Math.floor((Date.now() - new Date(row.startedAt).getTime()) / 1000),
        )
      : null;

  res.json({
    active: {
      progressId: row.progressId,
      cyberRangeId: row.cyberRangeId,
      name: row.name,
      difficulty: row.difficulty,
      day: { key: row.dayKey, label: row.dayLabel },
      expectedDurationMinutes: row.expectedDurationMinutes,
      status: row.status,
      startedAt: row.startedAt,
      remainingSeconds,
    },
  });
});

// US-007: student view of scoring — individual + team attribution, no separate milestones entity.
router.get('/me/scores', (req, res) => {
  const teamId = requireTeam(req, res);
  if (teamId === null) return;

  const entries = db
    .prepare(
      `SELECT
         s.id AS id, s.points AS points, s.is_gamified AS isGamified, s.note AS note,
         s.created_at AS createdAt, s.student_user_id AS studentUserId,
         u.display_name AS studentName,
         s.documentation_entry_id AS documentationEntryId,
         substr(e.body, 1, 140) AS documentationExcerpt,
         cr.name AS cyberRangeName
       FROM scores s
       LEFT JOIN users u ON u.id = s.student_user_id
       LEFT JOIN documentation_entries e ON e.id = s.documentation_entry_id
       LEFT JOIN cyber_ranges cr ON cr.id = s.cyber_range_id
       WHERE s.team_id = ?
       ORDER BY s.created_at DESC`,
    )
    .all(teamId);

  const teamTotalRow = db
    .prepare('SELECT COALESCE(SUM(points), 0) AS total FROM scores WHERE team_id = ?')
    .get(teamId) as { total: number };

  const perStudent = db
    .prepare(
      `SELECT u.id AS studentUserId, u.display_name AS studentName, COALESCE(SUM(s.points), 0) AS total
       FROM users u
       LEFT JOIN scores s ON s.student_user_id = u.id AND s.team_id = ?
       WHERE u.team_id = ?
       GROUP BY u.id`,
    )
    .all(teamId, teamId);

  res.json({ entries, teamTotal: teamTotalRow.total, perStudent });
});

export default router;
