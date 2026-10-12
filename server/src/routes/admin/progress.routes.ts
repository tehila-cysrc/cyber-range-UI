import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { assertPairInScope } from '../../authz/resolve.js';
import { pairInScope, teamOrganization } from '../../authz/scope.js';
import { writeAudit } from '../../services/audit.service.js';
import { startCyberRangeForTeam } from '../../services/cyberRangeProgress.service.js';
import { emitProgressChanged } from '../../sockets/emitters.js';
import { endActiveSessions } from '../../services/accessBroker/accessBroker.service.js';
import { closeOpenHelpRequests } from '../../services/helpRequests.service.js';

const router = Router();

router.use(requireAuth);

// The only way a team's scenario is assigned/switched — students can't self-assign (see
// CLAUDE/invariants.md).
// Assigning a scenario hands the team its topology and starts scoring it against that answer key, so
// the (team's organization, scenario) pair must be in scope (RBAC PE-6).
router.post('/teams/:teamId/cyber-ranges/:cyberRangeId/start', requirePermission('progress.manage'), (req, res) => {
  const teamId = Number(req.params.teamId);
  const cyberRangeId = Number(req.params.cyberRangeId);

  if (!assertPairInScope(req, res, teamId, cyberRangeId)) return;
  // Switching pauses the team's current scenario and ends its sessions/help — not allowed when that
  // live scenario belongs to another instructor's pair.
  const live = db
    .prepare("SELECT cyber_range_id AS id FROM team_cyber_range_progress WHERE team_id = ? AND status = 'active' AND cyber_range_id != ?")
    .get(teamId, cyberRangeId) as { id: number } | undefined;
  if (live && !pairInScope(req.user!, teamId, live.id)) {
    res.status(409).json({ error: 'this team is live on a scenario outside your assignments — it has to be completed first', reason: 'scenario_out_of_scope' });
    return;
  }

  const result = startCyberRangeForTeam(teamId, cyberRangeId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  // Remote sessions into the previous scenario's VMs stop being authorized the moment it's switched.
  endActiveSessions({ teamId, exceptCyberRangeId: cyberRangeId }, 'force_closed', req.user!.username, 'scenario_changed');
  closeOpenHelpRequests(teamId, { exceptCyberRangeId: cyberRangeId });
  writeAudit(req.user!.username, 'progress.started', 'team', teamId, null, { organizationId: teamOrganization(teamId)?.orgId ?? null, cyberRangeId });
  emitProgressChanged(teamId, { cyberRangeId, status: 'active' });
  res.json({ ok: true });
});

router.post('/teams/:teamId/cyber-ranges/:cyberRangeId/complete', requirePermission('progress.manage'), (req, res) => {
  const teamId = Number(req.params.teamId);
  const cyberRangeId = Number(req.params.cyberRangeId);
  if (!assertPairInScope(req, res, teamId, cyberRangeId)) return;
  const completedAt = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE team_cyber_range_progress SET status = 'completed', completed_at = ?,
         first_completed_at = COALESCE(first_completed_at, ?)
       WHERE team_id = ? AND cyber_range_id = ?`,
    )
    .run(completedAt, completedAt, teamId, cyberRangeId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'no progress row for this team/cyber range — start it first' });
    return;
  }

  // Only this scenario's sessions and help requests — the team may be live on another one.
  endActiveSessions({ teamId, cyberRangeId }, 'force_closed', req.user!.username, 'scenario_completed');
  closeOpenHelpRequests(teamId, { onlyCyberRangeId: cyberRangeId });
  writeAudit(req.user!.username, 'progress.completed', 'team', teamId, null, { organizationId: teamOrganization(teamId)?.orgId ?? null, cyberRangeId });
  emitProgressChanged(teamId, { cyberRangeId, status: 'completed' });
  res.json({ ok: true });
});

export default router;
