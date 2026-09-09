import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { listAuditLog } from '../../services/audit.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

// Read-only view of the compliance trail (Phase 5). Optional ?entityType= filter and ?before=<id>
// for simple keyset pagination (pass the last row's id back to page further into the past).
router.get('/audit-log', (req, res) => {
  const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
  const before = req.query.before ? Number(req.query.before) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  res.json({ entries: listAuditLog({ entityType, before, limit }) });
});

export default router;
