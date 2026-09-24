import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { emitHelpRequestResolved } from '../../sockets/emitters.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.get('/help-requests', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;

  const query = `
    SELECT
      hr.id AS id, hr.status AS status, hr.created_at AS createdAt, hr.resolved_at AS resolvedAt,
      hr.message AS message,
      t.id AS teamId, t.name AS teamName,
      cr.name AS cyberRangeName,
      u.display_name AS requestedByName
    FROM help_requests hr
    JOIN teams t ON t.id = hr.team_id
    JOIN cyber_ranges cr ON cr.id = hr.cyber_range_id
    JOIN users u ON u.id = hr.requested_by_user_id
    ${status ? 'WHERE hr.status = ?' : ''}
    ORDER BY hr.created_at DESC
  `;

  const helpRequests = status ? db.prepare(query).all(status) : db.prepare(query).all();
  res.json({ helpRequests });
});

router.post('/help-requests/:id/resolve', (req, res) => {
  const id = Number(req.params.id);
  const resolvedAt = new Date().toISOString();

  const existing = db.prepare('SELECT team_id AS teamId FROM help_requests WHERE id = ?').get(id) as
    | { teamId: number }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'help request not found' });
    return;
  }

  db.prepare(
    `UPDATE help_requests SET status = 'resolved', resolved_at = ?, resolved_by_user_id = ?
     WHERE id = ?`,
  ).run(resolvedAt, req.user!.id, id);

  emitHelpRequestResolved(existing.teamId, id, 'instructor');

  res.json({ ok: true });
});

export default router;
