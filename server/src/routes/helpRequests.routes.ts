import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { emitHelpRequestNew } from '../sockets/emitters.js';

const router = Router();

router.use(requireAuth);

// US-005: student requests help. The system NEVER attaches a hint — this row is purely a
// flag-and-notify to the human instructor.
const MAX_MESSAGE_LENGTH = 500;

const HELP_REQUEST_SELECT = `
  SELECT
    hr.id AS id, hr.status AS status, hr.created_at AS createdAt, hr.message AS message,
    t.id AS teamId, t.name AS teamName,
    cr.name AS cyberRangeName,
    u.display_name AS requestedByName
  FROM help_requests hr
  JOIN teams t ON t.id = hr.team_id
  JOIN cyber_ranges cr ON cr.id = hr.cyber_range_id
  JOIN users u ON u.id = hr.requested_by_user_id`;

// The team's own open request, if any — lets every teammate's page show "waiting for the
// instructor" (and survive a refresh) instead of a confirmation that vanished after 8 seconds.
router.get('/help-requests/mine', (req, res) => {
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.json({ helpRequest: null });
    return;
  }
  const helpRequest =
    db.prepare(`${HELP_REQUEST_SELECT} WHERE hr.team_id = ? AND hr.status = 'open' ORDER BY hr.created_at LIMIT 1`).get(req.user!.teamId) ??
    null;
  res.json({ helpRequest });
});

router.post('/help-requests', (req, res) => {
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can request help' });
    return;
  }

  const activeProgress = db
    .prepare(
      `SELECT cyber_range_id AS cyberRangeId FROM team_cyber_range_progress
       WHERE team_id = ? AND status = 'active' LIMIT 1`,
    )
    .get(req.user!.teamId) as { cyberRangeId: number } | undefined;

  if (!activeProgress) {
    res.status(409).json({ error: 'no active Cyber Range to request help for' });
    return;
  }

  // One open request per team: repeated clicks (or several teammates asking at once) shouldn't flood
  // the instructor's queue with duplicates — the team just sees its request is already pending.
  const alreadyOpen = db
    .prepare(`SELECT id FROM help_requests WHERE team_id = ? AND status = 'open' ORDER BY created_at LIMIT 1`)
    .get(req.user!.teamId) as { id: number } | undefined;
  if (alreadyOpen) {
    res.status(200).json({ alreadyOpen: true, helpRequestId: alreadyOpen.id });
    return;
  }

  // Optional "what do you need?" — the instructor otherwise walks over with no context.
  const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const message = rawMessage ? rawMessage.slice(0, MAX_MESSAGE_LENGTH) : null;

  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO help_requests (team_id, cyber_range_id, requested_by_user_id, status, created_at, message)
       VALUES (?, ?, ?, 'open', ?, ?)`,
    )
    .run(req.user!.teamId, activeProgress.cyberRangeId, req.user!.id, createdAt, message);

  const helpRequest = db.prepare(`${HELP_REQUEST_SELECT} WHERE hr.id = ?`).get(result.lastInsertRowid);

  emitHelpRequestNew(req.user!.teamId, helpRequest);

  res.status(201).json({ helpRequest });
});

export default router;
