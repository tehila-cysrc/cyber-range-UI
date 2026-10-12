import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { assertTeamInScope } from '../../authz/resolve.js';
import { teamInScope } from '../../authz/scope.js';
import { db } from '../../db/index.js';
import { grantCertificate, listCertificateGrants, listCompletedTeamIds, revokeCertificate } from '../../services/certificate.service.js';
import { writeAudit } from '../../services/audit.service.js';
import { emitCertificateChanged } from '../../sockets/emitters.js';

const router = Router();

router.use(requireAuth);

// Students the instructor granted the certificate to directly, plus the teams that earned it by
// completing a scenario (Roster → Students shows those as "Earned" instead of offering a grant).
router.get('/certificate-grants', requirePermission('student.manage'), (req, res) => {
  const teamOf = db.prepare('SELECT team_id AS teamId FROM users WHERE id = ?');
  const grants = listCertificateGrants().filter((g) => {
    const row = teamOf.get(g.userId) as { teamId: number | null } | undefined;
    return !!row?.teamId && teamInScope(req.user!, row.teamId);
  });
  res.json({ grants, completedTeamIds: listCompletedTeamIds().filter((t) => teamInScope(req.user!, t)) });
});

// The student's own team decides scope (not just "is a student").
function studentInScope(req: import('express').Request, res: import('express').Response, userId: number): boolean {
  const row = db.prepare("SELECT team_id AS teamId FROM users WHERE id = ? AND role = 'student'").get(userId) as { teamId: number | null } | undefined;
  if (!row?.teamId) {
    res.status(404).json({ error: 'student not found' });
    return false;
  }
  return assertTeamInScope(req, res, row.teamId);
}

router.put('/users/:userId/certificate-grant', requirePermission('student.manage'), (req, res) => {
  const userId = Number(req.params.userId);
  if (!studentInScope(req, res, userId)) return;
  const r = grantCertificate(userId, req.user!.id);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  writeAudit(req.user!.username, 'certificate.granted', 'user', userId, { username: r.username });
  emitCertificateChanged(r.teamId);
  res.json({ ok: true });
});

router.delete('/users/:userId/certificate-grant', requirePermission('student.manage'), (req, res) => {
  const userId = Number(req.params.userId);
  if (!studentInScope(req, res, userId)) return;
  const r = revokeCertificate(userId);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  writeAudit(req.user!.username, 'certificate.revoked', 'user', userId, { username: r.username });
  emitCertificateChanged(r.teamId);
  res.json({ ok: true });
});

export default router;
