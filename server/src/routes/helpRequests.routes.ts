import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { emitHelpRequestNew } from '../sockets/emitters.js';

const router = Router();

router.use(requireAuth);

// US-005: student requests help. The system NEVER attaches a hint — this row is purely a
// flag-and-notify to the human instructor.
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

  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO help_requests (team_id, cyber_range_id, requested_by_user_id, status, created_at)
       VALUES (?, ?, ?, 'open', ?)`,
    )
    .run(req.user!.teamId, activeProgress.cyberRangeId, req.user!.id, createdAt);

  const helpRequest = db
    .prepare(
      `SELECT
         hr.id AS id, hr.status AS status, hr.created_at AS createdAt,
         t.id AS teamId, t.name AS teamName,
         cr.name AS cyberRangeName
       FROM help_requests hr
       JOIN teams t ON t.id = hr.team_id
       JOIN cyber_ranges cr ON cr.id = hr.cyber_range_id
       WHERE hr.id = ?`,
    )
    .get(result.lastInsertRowid);

  emitHelpRequestNew(helpRequest);

  res.status(201).json({ helpRequest });
});

export default router;
