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

  // Every scenario the team worked on that isn't the live one — completed, or paused because the
  // instructor switched the team to another scenario. A paused scenario used to be visible nowhere
  // (not live, not "completed"), so its timeline, canvas and scores looked deleted.
  const scenarios = db
    .prepare(
      `SELECT
         cr.id AS cyberRangeId, cr.name AS name, cr.difficulty AS difficulty,
         d.key AS dayKey, d.label AS dayLabel, p.status AS status,
         p.started_at AS startedAt, p.completed_at AS completedAt
       FROM team_cyber_range_progress p
       JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
       JOIN days d ON d.id = cr.day_id
       WHERE p.team_id = ? AND p.status IN ('completed', 'paused')
       ORDER BY COALESCE(p.completed_at, p.started_at) DESC`,
    )
    .all(teamId);

  res.json({ completed, scenarios });
});

// US-010 + FR-8: cross-day (AI/Azure/AWS) summary for the whole event, real data only — a day with
// no activity for this team is simply omitted, never shown with placeholder/zeroed content. Counts
// every scenario the team worked on (completed, paused by a switch, or live) and all their points —
// counting only completed ones silently dropped a switched-away scenario's work from the summary.
// Declared before the /:cyberRangeId route below so "event-summary" isn't captured as an id.
router.get('/history/event-summary', (req, res) => {
  const teamId = resolveTeamId(req, res);
  if (teamId === null) return;

  const rows = db
    .prepare(
      `SELECT
         d.key AS dayKey, d.label AS dayLabel,
         SUM(p.status = 'completed') AS completedCount,
         SUM(p.status = 'paused') AS pausedCount,
         SUM(p.status = 'active') AS activeCount,
         COALESCE(SUM(
           (SELECT COALESCE(SUM(s.points), 0) FROM scores s
            WHERE s.team_id = p.team_id AND s.cyber_range_id = p.cyber_range_id)
         ), 0) AS totalPoints
       FROM team_cyber_range_progress p
       JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
       JOIN days d ON d.id = cr.day_id
       WHERE p.team_id = ? AND p.status IN ('completed', 'paused', 'active')
       GROUP BY d.id
       ORDER BY d.sort_order`,
    )
    .all(teamId);

  res.json({ days: rows });
});

// Summary of one Cyber Range the team worked on (completed, paused or still live): documentation,
// each score awarded and the help requests actually recorded for it. The canvas has its own route.
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

  const progress = db
    .prepare(
      `SELECT status, started_at AS startedAt, completed_at AS completedAt
       FROM team_cyber_range_progress WHERE team_id = ? AND cyber_range_id = ?`,
    )
    .get(teamId, cyberRangeId);
  if (!cyberRange || !progress) {
    res.status(404).json({ error: 'this team has no history for that Cyber Range' });
    return;
  }

  const documentation = db
    .prepare(
      `SELECT
         e.id AS id, e.body AS body, e.image_data_url AS imageDataUrl,
         e.is_important_finding AS isImportantFinding,
         e.after_time_limit AS afterTimeLimit,
         e.created_at AS createdAt, u.display_name AS authorName, u.avatar AS authorAvatar, c.label AS categoryLabel
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

  const scores = db
    .prepare(
      `SELECT
         s.id AS id, s.points AS points, s.note AS note, s.source AS source, s.created_at AS createdAt,
         st.display_name AS studentName, st.avatar AS studentAvatar
       FROM scores s
       LEFT JOIN users st ON st.id = s.student_user_id
       WHERE s.team_id = ? AND s.cyber_range_id = ?
       ORDER BY s.created_at ASC`,
    )
    .all(teamId, cyberRangeId);

  const helpRequests = db
    .prepare(
      `SELECT
         h.id AS id, h.status AS status, h.message AS message, h.created_at AS createdAt,
         h.resolved_at AS resolvedAt, (h.resolved_at IS NOT NULL AND h.resolved_by_user_id IS NULL) AS autoClosed,
         u.display_name AS requestedByName, u.avatar AS requestedByAvatar
       FROM help_requests h
       JOIN users u ON u.id = h.requested_by_user_id
       WHERE h.team_id = ? AND h.cyber_range_id = ?
       ORDER BY h.created_at ASC`,
    )
    .all(teamId, cyberRangeId);

  res.json({ cyberRange, progress, documentation, scoreTotal: scoreTotal.total, scores, helpRequests });
});

export default router;
