import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { notFoundOutOfScope, requirePermission } from '../../authz/requirePermission.js';
import { pairInScope } from '../../authz/scope.js';
import { isAdmin } from '../../authz/roles.js';
import { db } from '../../db/index.js';
import {
  forceCloseSession,
  listActiveSessions,
  restoreInstructorSession,
  revealInstructorSessionCredential,
} from '../../services/accessBroker/accessBroker.service.js';

const router = Router();

router.use(requireAuth);

// A team session is visible when its (team's organization, scenario) pair is in scope; a staff
// member's own diagnostic session only to that person and to admins (RBAC §2.2).
function sessionVisible(req: import('express').Request, s: { teamId: number | null; userId: number; cyberRangeId: number }): boolean {
  if (s.teamId === null) return s.userId === req.user!.id || isAdmin(req.user!.role);
  return pairInScope(req.user!, s.teamId, s.cyberRangeId);
}

router.get('/access-sessions', requirePermission('access_session.manage'), (req, res) => {
  res.json({ sessions: listActiveSessions().filter((s) => sessionVisible(req, s)) });
});

// The instructor's own latest active Connect session (header session box / Topology Admin panel).
router.get('/access-sessions/mine', requirePermission('access_session.manage'), async (req, res) => {
  const session = await restoreInstructorSession({ id: req.user!.id, username: req.user!.username });
  res.json({ session });
});

// Explicit "Show" for the instructor's own session — never bundled into the connect/restore response.
router.get('/access-sessions/:id/credential', requirePermission('access_session.manage'), async (req, res) => {
  const credential = await revealInstructorSessionCredential(Number(req.params.id), { id: req.user!.id, username: req.user!.username });
  if (!credential) {
    res.status(404).json({ error: 'no active session of yours with that id, or its credential is unavailable' });
    return;
  }
  res.json(credential);
});

router.post('/access-sessions/:id/force-close', requirePermission('access_session.manage'), (req, res) => {
  const session = db
    .prepare('SELECT team_id AS teamId, user_id AS userId, cyber_range_id AS cyberRangeId FROM access_sessions WHERE id = ?')
    .get(Number(req.params.id)) as { teamId: number | null; userId: number; cyberRangeId: number } | undefined;
  if (!session || !sessionVisible(req, session)) {
    if (session) notFoundOutOfScope(req, res, 'session', { cyberRangeId: session.cyberRangeId });
    else res.status(404).json({ error: 'no active session with that id' });
    return;
  }
  const closed = forceCloseSession(Number(req.params.id), req.user!.username);
  if (!closed) {
    res.status(404).json({ error: 'no active session with that id' });
    return;
  }
  res.json({ ok: true });
});

export default router;
