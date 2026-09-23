import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getActiveEventRunId } from '../../db/seed.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

// Manual account creation for the current event run — mainly for additional instructor accounts
// or one-off overrides. Students normally self-register via POST /api/auth/register.
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
  const id = Number(req.params.id);
  if (id === req.user!.id) {
    res.status(400).json({ error: "you can't remove your own account while signed in with it" });
    return;
  }
  try {
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
  } catch {
    // FOREIGN KEY failure: the account authored timeline entries / canvas nodes / help requests or
    // awarded scores. Deleting it would silently rewrite the team's investigation record, so refuse
    // with an explanation instead of an opaque 500.
    res.status(409).json({
      error:
        'This account has recorded activity (timeline entries, canvas items, help requests or scores) and cannot be removed without erasing it. Delete the whole team, or leave the account in place.',
    });
    return;
  }
  res.json({ ok: true });
});

export default router;
