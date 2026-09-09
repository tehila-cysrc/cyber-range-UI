import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { forceCloseSession, listActiveSessions } from '../../services/accessBroker/accessBroker.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.get('/access-sessions', (_req, res) => {
  res.json({ sessions: listActiveSessions() });
});

router.post('/access-sessions/:id/force-close', (req, res) => {
  const closed = forceCloseSession(Number(req.params.id), req.user!.username);
  if (!closed) {
    res.status(404).json({ error: 'no active session with that id' });
    return;
  }
  res.json({ ok: true });
});

export default router;
