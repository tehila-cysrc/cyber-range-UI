import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { endOwnSession, requestAccessSession } from '../services/accessBroker/accessBroker.service.js';

const router = Router();

router.use(requireAuth);

// Student-only: request a browser-access session into a lab VM. topologyNodeId is the only
// client-supplied value — everything else (which cyber range is "active", whether the node belongs
// to it, which credential to use) is resolved server-side. See accessBroker.service.ts for the full
// RBAC chain and CLAUDE/invariants.md for why this mirrors the existing help_requests pattern.
router.post('/me/access-sessions', (req, res) => {
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can request an access session' });
    return;
  }

  const { topologyNodeId } = req.body ?? {};
  if (typeof topologyNodeId !== 'number') {
    res.status(400).json({ error: 'topologyNodeId is required' });
    return;
  }

  const outcome = requestAccessSession(
    { id: req.user!.id, teamId: req.user!.teamId, username: req.user!.username },
    topologyNodeId,
    req.ip ?? null,
  );

  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.message, reason: outcome.reason });
    return;
  }

  res.status(201).json({ accessSessionId: outcome.accessSessionId, wsUrl: outcome.wsUrl, expiresAt: outcome.expiresAt });
});

router.post('/me/access-sessions/:id/end', (req, res) => {
  if (!req.user!.teamId) {
    res.status(403).json({ error: 'no team' });
    return;
  }

  const ended = endOwnSession(Number(req.params.id), req.user!.teamId, req.user!.username);
  if (!ended) {
    res.status(404).json({ error: 'no active session with that id for your team' });
    return;
  }

  res.json({ ok: true });
});

export default router;
