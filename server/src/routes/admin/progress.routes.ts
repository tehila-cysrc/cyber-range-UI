import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.post('/teams/:teamId/cyber-ranges/:cyberRangeId/start', (req, res) => {
  const teamId = Number(req.params.teamId);
  const cyberRangeId = Number(req.params.cyberRangeId);

  const cyberRange = db
    .prepare('SELECT expected_duration_minutes AS expectedDurationMinutes FROM cyber_ranges WHERE id = ?')
    .get(cyberRangeId) as { expectedDurationMinutes: number | null } | undefined;

  if (!cyberRange) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }

  const timeLimitSeconds =
    cyberRange.expectedDurationMinutes != null ? cyberRange.expectedDurationMinutes * 60 : null;
  const startedAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status, started_at, time_limit_seconds)
     VALUES (?, ?, 'active', ?, ?)
     ON CONFLICT (team_id, cyber_range_id) DO UPDATE SET
       status = 'active',
       started_at = excluded.started_at,
       time_limit_seconds = excluded.time_limit_seconds,
       completed_at = NULL`,
  ).run(teamId, cyberRangeId, startedAt, timeLimitSeconds);

  res.json({ ok: true });
});

router.post('/teams/:teamId/cyber-ranges/:cyberRangeId/complete', (req, res) => {
  const teamId = Number(req.params.teamId);
  const cyberRangeId = Number(req.params.cyberRangeId);
  const completedAt = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE team_cyber_range_progress SET status = 'completed', completed_at = ?
       WHERE team_id = ? AND cyber_range_id = ?`,
    )
    .run(completedAt, teamId, cyberRangeId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'no progress row for this team/cyber range — start it first' });
    return;
  }

  res.json({ ok: true });
});

export default router;
