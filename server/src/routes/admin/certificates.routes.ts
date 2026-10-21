import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { assertPairInScope, assertTeamInScope } from '../../authz/resolve.js';
import { pairInScope, scenarioInScope, teamInScope } from '../../authz/scope.js';
import { db } from '../../db/index.js';
import {
  findStudent,
  grantCertificate,
  listCertificateGrants,
  listCompletedTeamScenarios,
  revokeCertificate,
  studentCertificateOptions,
} from '../../services/certificate.service.js';
import {
  createCertificateTemplate,
  deleteCertificateTemplate,
  listCertificateTemplates,
  scenariosByTemplate,
  updateCertificateTemplate,
} from '../../services/certificateTemplates.service.js';
import { writeAudit } from '../../services/audit.service.js';
import { emitCertificateChanged } from '../../sockets/emitters.js';

const router = Router();

router.use(requireAuth);

// ---- Certificate library (CONFIG). Shared by every scenario, so editing it is admin-only
// (certificate.manage); staff who edit a scenario read it to pick one (scenario.inspect).

router.get('/certificate-templates', requirePermission('scenario.inspect'), (req, res) => {
  const used = scenariosByTemplate();
  const templates = listCertificateTemplates().map((t) => ({
    ...t,
    scenarios: (used.get(t.id) ?? []).filter((s) => scenarioInScope(req.user!, s.id)),
  }));
  res.json({ templates });
});

router.post('/certificate-templates', requirePermission('certificate.manage'), (req, res) => {
  const r = createCertificateTemplate(req.body);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  writeAudit(req.user!.username, 'certificate_template.created', 'certificate_template', r.template.id, { name: r.template.name });
  res.status(201).json({ template: r.template });
});

router.patch('/certificate-templates/:id', requirePermission('certificate.manage'), (req, res) => {
  const id = Number(req.params.id);
  const r = updateCertificateTemplate(id, req.body);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  writeAudit(req.user!.username, 'certificate_template.updated', 'certificate_template', id, { changes: Object.keys(req.body ?? {}) });
  res.json({ template: r.template });
});

router.delete('/certificate-templates/:id', requirePermission('certificate.manage'), (req, res) => {
  const id = Number(req.params.id);
  const r = deleteCertificateTemplate(id);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  writeAudit(req.user!.username, 'certificate_template.deleted', 'certificate_template', id, { name: r.name, scenariosReset: r.scenariosReset });
  res.json({ ok: true });
});

// ---- Students' certificates (RUN). One per (student, scenario): earned by completing it, or granted.

// Roster → Students summary: direct grants plus the (team, scenario) pairs completed, both limited to
// the caller's scope (a grant/completion is team work on a scenario → pair scope).
router.get('/certificate-grants', requirePermission('student.manage'), (req, res) => {
  const teamOf = db.prepare('SELECT team_id AS teamId FROM users WHERE id = ?');
  const grants = listCertificateGrants().filter((g) => {
    const row = teamOf.get(g.userId) as { teamId: number | null } | undefined;
    if (!row?.teamId) return false;
    return g.cyberRangeId === null ? teamInScope(req.user!, row.teamId) : pairInScope(req.user!, row.teamId, g.cyberRangeId);
  });
  const completed = listCompletedTeamScenarios().filter((c) => pairInScope(req.user!, c.teamId, c.cyberRangeId));
  res.json({ grants, completed });
});

// The student's own team decides scope (not just "is a student").
function studentTeamInScope(req: import('express').Request, res: import('express').Response, userId: number): number | null {
  const student = findStudent(userId);
  if (!student.ok) {
    res.status(404).json({ error: 'student not found' });
    return null;
  }
  return assertTeamInScope(req, res, student.teamId) ? student.teamId : null;
}

// Roster → Students "Certificates" dialog: the team's scenarios in scope, earned/granted, and the
// certificate each one prints.
router.get('/users/:userId/certificates', requirePermission('student.manage'), (req, res) => {
  const userId = Number(req.params.userId);
  const teamId = studentTeamInScope(req, res, userId);
  if (teamId === null) return;
  const options = studentCertificateOptions(userId, teamId).filter(
    (o) => o.cyberRangeId === null || pairInScope(req.user!, teamId, o.cyberRangeId),
  );
  res.json({ certificates: options });
});

router.put('/users/:userId/certificate-grants/:cyberRangeId', requirePermission('student.manage'), (req, res) => {
  const userId = Number(req.params.userId);
  const cyberRangeId = Number(req.params.cyberRangeId);
  if (!Number.isInteger(cyberRangeId)) {
    res.status(400).json({ error: 'invalid scenario id' });
    return;
  }
  const teamId = studentTeamInScope(req, res, userId);
  if (teamId === null || !assertPairInScope(req, res, teamId, cyberRangeId, 'scenario')) return;
  const r = grantCertificate(userId, cyberRangeId, req.user!.id);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  writeAudit(req.user!.username, 'certificate.granted', 'user', userId, { username: r.username }, { cyberRangeId });
  emitCertificateChanged(r.teamId);
  res.json({ ok: true });
});

// `:cyberRangeId` = "general" revokes a grant made before certificates were per scenario.
router.delete('/users/:userId/certificate-grants/:cyberRangeId', requirePermission('student.manage'), (req, res) => {
  const userId = Number(req.params.userId);
  const cyberRangeId = req.params.cyberRangeId === 'general' ? null : Number(req.params.cyberRangeId);
  if (cyberRangeId !== null && !Number.isInteger(cyberRangeId)) {
    res.status(400).json({ error: 'invalid scenario id' });
    return;
  }
  const teamId = studentTeamInScope(req, res, userId);
  if (teamId === null) return;
  if (cyberRangeId !== null && !assertPairInScope(req, res, teamId, cyberRangeId, 'scenario')) return;
  const r = revokeCertificate(userId, cyberRangeId);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  writeAudit(req.user!.username, 'certificate.revoked', 'user', userId, { username: r.username }, cyberRangeId === null ? undefined : { cyberRangeId });
  emitCertificateChanged(r.teamId);
  res.json({ ok: true });
});

export default router;
