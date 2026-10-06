import { Router, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { writeAudit } from '../../services/audit.service.js';
import {
  createOrganization,
  deleteOrganization,
  listOrganizations,
  renameOrganization,
  type OrgResult,
} from '../../services/organizations.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

function fail(res: Response, r: Extract<OrgResult<unknown>, { ok: false }>) {
  res.status(r.status).json({ error: r.error });
}

router.get('/organizations', (_req, res) => {
  res.json({ organizations: listOrganizations() });
});

router.post('/organizations', (req, res) => {
  const r = createOrganization(req.body?.name);
  if (!r.ok) return fail(res, r);
  writeAudit(req.user!.username, 'organization.created', 'organization', r.value.id, { name: r.value.name });
  res.status(201).json({ organization: r.value });
});

router.patch('/organizations/:id', (req, res) => {
  const r = renameOrganization(Number(req.params.id), req.body?.name);
  if (!r.ok) return fail(res, r);
  writeAudit(req.user!.username, 'organization.renamed', 'organization', r.value.id, { name: r.value.name });
  res.json({ organization: r.value });
});

router.delete('/organizations/:id', (req, res) => {
  const id = Number(req.params.id);
  const r = deleteOrganization(id);
  if (!r.ok) return fail(res, r);
  writeAudit(req.user!.username, 'organization.deleted', 'organization', id, r.value);
  res.json({ ok: true, ...r.value });
});

export default router;
