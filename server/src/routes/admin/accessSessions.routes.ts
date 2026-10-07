import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  forceCloseSession,
  listActiveSessions,
  restoreInstructorSession,
  revealInstructorSessionCredential,
} from '../../services/accessBroker/accessBroker.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.get('/access-sessions', (_req, res) => {
  res.json({ sessions: listActiveSessions() });
});

// The instructor's own latest active Connect session (header session box / Topology Admin panel).
router.get('/access-sessions/mine', async (req, res) => {
  const session = await restoreInstructorSession({ id: req.user!.id, username: req.user!.username });
  res.json({ session });
});

// Explicit "Show" for the instructor's own session — never bundled into the connect/restore response.
router.get('/access-sessions/:id/credential', async (req, res) => {
  const credential = await revealInstructorSessionCredential(Number(req.params.id), { id: req.user!.id, username: req.user!.username });
  if (!credential) {
    res.status(404).json({ error: 'no active session of yours with that id, or its credential is unavailable' });
    return;
  }
  res.json(credential);
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
