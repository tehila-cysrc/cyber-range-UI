import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { assertPairInScope } from '../../authz/resolve.js';
import { scopeWhere } from '../../authz/scope.js';
import { writeAudit } from '../../services/audit.service.js';
import { emitHelpRequestResolved } from '../../sockets/emitters.js';

const router = Router();

router.use(requireAuth);

router.get('/help-requests', requirePermission('help.manage'), (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const scoped = scopeWhere(req.user!, 't.organization_id', 'hr.cyber_range_id');

  const query = `
    SELECT
      hr.id AS id, hr.status AS status, hr.created_at AS createdAt, hr.resolved_at AS resolvedAt,
      hr.message AS message,
      t.id AS teamId, t.name AS teamName,
      cr.name AS cyberRangeName,
      u.display_name AS requestedByName, u.avatar AS requestedByAvatar
    FROM help_requests hr
    JOIN teams t ON t.id = hr.team_id
    JOIN cyber_ranges cr ON cr.id = hr.cyber_range_id
    JOIN users u ON u.id = hr.requested_by_user_id
    WHERE ${scoped.sql} ${status ? 'AND hr.status = ?' : ''}
    ORDER BY hr.created_at DESC
  `;

  const helpRequests = db.prepare(query).all(...scoped.params, ...(status ? [status] : []));
  res.json({ helpRequests });
});

router.post('/help-requests/:id/resolve', requirePermission('help.manage'), (req, res) => {
  const id = Number(req.params.id);
  const resolvedAt = new Date().toISOString();

  const existing = db.prepare('SELECT team_id AS teamId, cyber_range_id AS cyberRangeId FROM help_requests WHERE id = ?').get(id) as
    | { teamId: number; cyberRangeId: number }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'help request not found' });
    return;
  }
  if (!assertPairInScope(req, res, existing.teamId, existing.cyberRangeId, 'help request')) return;

  db.prepare(
    `UPDATE help_requests SET status = 'resolved', resolved_at = ?, resolved_by_user_id = ?
     WHERE id = ?`,
  ).run(resolvedAt, req.user!.id, id);

  writeAudit(req.user!.username, 'help_request.resolved', 'help_request', id, { teamId: existing.teamId }, { cyberRangeId: existing.cyberRangeId });
  emitHelpRequestResolved(existing.teamId, existing.cyberRangeId, id, 'instructor');

  res.json({ ok: true });
});

export default router;
