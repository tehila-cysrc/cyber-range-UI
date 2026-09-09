import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { startCyberRangeForTeam } from '../../services/cyberRangeProgress.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

// Students normally start their own team's scenario via POST /api/teams/me/cyber-ranges/:id/start —
// this instructor path stays available for overrides (e.g. re-starting a team stuck mid-range).
router.post('/teams/:teamId/cyber-ranges/:cyberRangeId/start', (req, res) => {
  const teamId = Number(req.params.teamId);
  const cyberRangeId = Number(req.params.cyberRangeId);

  const result = startCyberRangeForTeam(teamId, cyberRangeId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

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
