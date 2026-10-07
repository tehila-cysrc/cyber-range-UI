import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { grantCertificate, listCertificateGrants, listCompletedTeamIds, revokeCertificate } from '../../services/certificate.service.js';
import { writeAudit } from '../../services/audit.service.js';
import { emitCertificateChanged } from '../../sockets/emitters.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

// Students the instructor granted the certificate to directly, plus the teams that earned it by
// completing a scenario (Roster → Students shows those as "Earned" instead of offering a grant).
router.get('/certificate-grants', (_req, res) => {
  res.json({ grants: listCertificateGrants(), completedTeamIds: listCompletedTeamIds() });
});

router.put('/users/:userId/certificate-grant', (req, res) => {
  const userId = Number(req.params.userId);
  const r = grantCertificate(userId, req.user!.id);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  writeAudit(req.user!.username, 'certificate.granted', 'user', userId, { username: r.username });
  emitCertificateChanged(r.teamId);
  res.json({ ok: true });
});

router.delete('/users/:userId/certificate-grant', (req, res) => {
  const userId = Number(req.params.userId);
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
