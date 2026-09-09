import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getActiveEventRunId } from '../../db/seed.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

// Onboarding: create a student or instructor account in the current event run. No
// self-registration by design (see CLAUDE/invariants.md) — this is the only way accounts get made
// outside the seed script.
router.post('/users', (req, res) => {
  const { username, password, role, teamId, displayName } = req.body ?? {};

  if (typeof username !== 'string' || !username.trim()) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'password is required' });
    return;
  }
  if (role !== 'student' && role !== 'instructor') {
    res.status(400).json({ error: 'role must be "student" or "instructor"' });
    return;
  }
  if (role === 'student' && !teamId) {
    res.status(400).json({ error: 'teamId is required for a student' });
    return;
  }

  const runId = getActiveEventRunId();
  if (runId === null) {
    res.status(409).json({ error: 'no active event run' });
    return;
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO users (event_run_id, username, password, role, team_id, display_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        username.trim(),
        password,
        role,
        role === 'student' ? teamId : null,
        (displayName || username).trim(),
      );

    res.status(201).json({
      user: { id: result.lastInsertRowid, username: username.trim(), role, teamId: teamId ?? null },
    });
  } catch (err) {
    // UNIQUE(event_run_id, username) violation — the only realistic failure mode here.
    res.status(409).json({ error: `username "${username}" is already taken this run` });
  }
});

router.delete('/users/:id', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default router;
