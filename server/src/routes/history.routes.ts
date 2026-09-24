import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

function resolveTeamId(req: import('express').Request, res: import('express').Response): number | null {
  if (req.user!.role === 'instructor') {
    const teamId = Number(req.query.teamId);
    if (!teamId) {
      res.status(400).json({ error: 'instructor must pass ?teamId=' });
      return null;
    }
    return teamId;
  }
  if (!req.user!.teamId) {
    res.status(409).json({ error: 'user has no team assigned' });
    return null;
  }
  return req.user!.teamId;
}

// US-010: completed Cyber Ranges, day + difficulty only — no fabricated data.
router.get('/history', (req, res) => {
  const teamId = resolveTeamId(req, res);
  if (teamId === null) return;

  const completed = db
    .prepare(
      `SELECT
         cr.id AS cyberRangeId, cr.name AS name, cr.difficulty AS difficulty,
         d.key AS dayKey, d.label AS dayLabel, p.completed_at AS completedAt
       FROM team_cyber_range_progress p
       JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
       JOIN days d ON d.id = cr.day_id
       WHERE p.team_id = ? AND p.status = 'completed'
       ORDER BY p.completed_at DESC`,
    )
    .all(teamId);

  res.json({ completed });
});

// US-010 + FR-8: cross-day (AI/Azure/AWS) summary for the whole event, real data only — a day with
// no activity for this team is simply omitted, never shown with placeholder/zeroed content.
// Declared before the /:cyberRangeId route below so "event-summary" isn't captured as an id.
router.get('/history/event-summary', (req, res) => {
  const teamId = resolveTeamId(req, res);
  if (teamId === null) return;

  const rows = db
    .prepare(
      `SELECT
         d.key AS dayKey, d.label AS dayLabel,
         COUNT(*) AS completedCount,
         COALESCE(SUM(
           (SELECT COALESCE(SUM(s.points), 0) FROM scores s
            WHERE s.team_id = p.team_id AND s.cyber_range_id = p.cyber_range_id)
         ), 0) AS totalPoints
       FROM team_cyber_range_progress p
       JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
       JOIN days d ON d.id = cr.day_id
       WHERE p.team_id = ? AND p.status = 'completed'
       GROUP BY d.id
       ORDER BY d.sort_order`,
    )
    .all(teamId);

  res.json({ days: rows });
});

// Summary of one completed Cyber Range: documentation + scoring actually recorded for it.
router.get('/history/:cyberRangeId', (req, res) => {
  const teamId = resolveTeamId(req, res);
  if (teamId === null) return;
  const cyberRangeId = Number(req.params.cyberRangeId);

  const cyberRange = db
    .prepare(
      `SELECT cr.id AS id, cr.name AS name, cr.difficulty AS difficulty, d.label AS dayLabel
       FROM cyber_ranges cr JOIN days d ON d.id = cr.day_id WHERE cr.id = ?`,
    )
    .get(cyberRangeId);

  const documentation = db
    .prepare(
      `SELECT
         e.id AS id, e.body AS body, e.image_data_url AS imageDataUrl,
         e.is_important_finding AS isImportantFinding,
         e.after_time_limit AS afterTimeLimit,
         e.created_at AS createdAt, u.display_name AS authorName, c.label AS categoryLabel
       FROM documentation_entries e
       JOIN users u ON u.id = e.author_user_id
       LEFT JOIN documentation_categories c ON c.id = e.category_id
       WHERE e.team_id = ? AND e.cyber_range_id = ?
       ORDER BY e.created_at ASC`,
    )
    .all(teamId, cyberRangeId);

  const scoreTotal = db
    .prepare(
      'SELECT COALESCE(SUM(points), 0) AS total FROM scores WHERE team_id = ? AND cyber_range_id = ?',
    )
    .get(teamId, cyberRangeId) as { total: number };

  res.json({ cyberRange, documentation, scoreTotal: scoreTotal.total });
});

export default router;
