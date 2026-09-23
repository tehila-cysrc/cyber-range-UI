import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { startCyberRangeForTeam } from '../../services/cyberRangeProgress.service.js';
import { emitProgressChanged } from '../../sockets/emitters.js';
import { endActiveSessions } from '../../services/accessBroker/accessBroker.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

// The only way a team's scenario is assigned/switched — students can't self-assign (see
// CLAUDE/invariants.md).
router.post('/teams/:teamId/cyber-ranges/:cyberRangeId/start', (req, res) => {
  const teamId = Number(req.params.teamId);
  const cyberRangeId = Number(req.params.cyberRangeId);

  if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) {
    res.status(404).json({ error: 'team not found' });
    return;
  }

  const result = startCyberRangeForTeam(teamId, cyberRangeId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  // Remote sessions into the previous scenario's VMs stop being authorized the moment it's switched.
  endActiveSessions({ teamId, exceptCyberRangeId: cyberRangeId }, 'force_closed', req.user!.username, 'scenario_changed');
  emitProgressChanged(teamId, { cyberRangeId, status: 'active' });
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

  endActiveSessions({ teamId }, 'force_closed', req.user!.username, 'scenario_completed');
  emitProgressChanged(teamId, { cyberRangeId, status: 'completed' });
  res.json({ ok: true });
});

export default router;
