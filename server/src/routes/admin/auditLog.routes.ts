import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { listAuditLog } from '../../services/audit.service.js';

const router = Router();

router.use(requireAuth);

// Read-only view of the compliance trail (Phase 5). Optional ?entityType= filter and ?before=<id>
// for simple keyset pagination (pass the last row's id back to page further into the past).
// Scoped per caller inside listAuditLog (RBAC §4.7): admin all, instructor their pairs.
router.get('/audit-log', requirePermission('audit.read'), (req, res) => {
  const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
  const before = req.query.before ? Number(req.query.before) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : undefined;
  res.json({ entries: listAuditLog({ entityType, before, limit, search }, req.user!) });
});

export default router;
