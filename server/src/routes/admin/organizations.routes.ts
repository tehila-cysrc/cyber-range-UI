import { Router, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { can } from '../../authz/permissions.js';
import { organizationInScope } from '../../authz/scope.js';
import { writeAudit } from '../../services/audit.service.js';
import {
  generateUniqueJoinCode,
  getActiveRunRegistration,
  getOrganizationCodes,
  setOrganizationCode,
} from '../../services/registration.service.js';
import {
  createOrganization,
  deleteOrganization,
  listOrganizations,
  renameOrganization,
  type OrgResult,
} from '../../services/organizations.service.js';
import { emitLeaderboardUpdate } from '../../sockets/emitters.js';

const router = Router();

router.use(requireAuth);

function fail(res: Response, r: Extract<OrgResult<unknown>, { ok: false }>) {
  res.status(r.status).json({ error: r.error });
}

// joinCode is the organization's open registration code for the active run (null = closed) — only
// for callers who manage registration (admin). Instructors see their assigned organizations only.
router.get('/organizations', requirePermission('org.read'), (req, res) => {
  const reg = getActiveRunRegistration();
  const showCodes = can(req.user!.role, 'registration.manage');
  const codes = reg && showCodes ? getOrganizationCodes(reg.runId) : new Map<number, string>();
  const organizations = listOrganizations()
    .filter((o) => organizationInScope(req.user!, o.id))
    .map((o) => ({ ...o, joinCode: codes.get(o.id) ?? null }));
  res.json({ organizations });
});

// Open (or re-issue, which invalidates the old code) / close this organization's join code. A student
// using it can only pick this organization's teams (auth.routes.ts /registration/teams + /register).
router.put('/organizations/:id/registration', requirePermission('registration.manage'), (req, res) => {
  const id = Number(req.params.id);
  if (!listOrganizations().some((o) => o.id === id)) {
    res.status(404).json({ error: 'organization not found' });
    return;
  }
  const reg = getActiveRunRegistration();
  if (!reg) {
    res.status(409).json({ error: 'no active event run' });
    return;
  }
  const code = req.body?.open ? generateUniqueJoinCode(reg.runId) : null;
  setOrganizationCode(reg.runId, id, code);
  writeAudit(req.user!.username, code ? 'organization.registration_opened' : 'organization.registration_closed', 'organization', id, null, { organizationId: id });
  res.json({ open: !!code, joinCode: code });
});

router.post('/organizations', requirePermission('org.manage'), (req, res) => {
  const r = createOrganization(req.body?.name);
  if (!r.ok) return fail(res, r);
  writeAudit(req.user!.username, 'organization.created', 'organization', r.value.id, { name: r.value.name }, { organizationId: r.value.id });
  res.status(201).json({ organization: r.value });
});

router.patch('/organizations/:id', requirePermission('org.manage'), (req, res) => {
  const r = renameOrganization(Number(req.params.id), req.body?.name);
  if (!r.ok) return fail(res, r);
  writeAudit(req.user!.username, 'organization.renamed', 'organization', r.value.id, { name: r.value.name }, { organizationId: r.value.id });
  res.json({ organization: r.value });
});

router.delete('/organizations/:id', requirePermission('org.manage'), (req, res) => {
  const id = Number(req.params.id);
  const r = deleteOrganization(id);
  if (!r.ok) return fail(res, r);
  writeAudit(req.user!.username, 'organization.deleted', 'organization', id, r.value, { organizationId: id });
  emitLeaderboardUpdate(); // its teams lose their organization
  res.json({ ok: true, ...r.value });
});

export default router;
