import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getActiveEventRunId } from '../../db/seed.js';
import { endActiveSessions } from '../../services/accessBroker/accessBroker.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

// Manual account creation for the current event run — mainly for additional instructor accounts
// or one-off overrides. Students can also self-register via POST /api/auth/register, but only while the
// instructor has opened registration with a join code (Roster page — see registration.service.ts).
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

// Move a student to another team (UX audit UX-10) — self-registered students pick their own team and
// a mistake used to be unfixable. Their past timeline entries, canvas items and scores stay with the old
// team (they're the team's investigation record). Remote sessions end and their tokens are revoked: a
// socket's team room is fixed at sign-in, so they must sign in again to join the new team's room.
router.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const teamId = Number(req.body?.teamId);
  const user = db.prepare('SELECT id, role, team_id AS teamId FROM users WHERE id = ?').get(id) as
    | { id: number; role: string; teamId: number | null }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  if (user.role !== 'student') {
    res.status(400).json({ error: 'only student accounts belong to a team' });
    return;
  }
  const team = db.prepare('SELECT id FROM teams WHERE id = ? AND event_run_id = ?').get(teamId, getActiveEventRunId());
  if (!team) {
    res.status(400).json({ error: 'teamId must be a team in the current event' });
    return;
  }
  if (user.teamId === teamId) {
    res.json({ ok: true, unchanged: true });
    return;
  }
  endActiveSessions({ userId: id }, 'force_closed', req.user!.username, 'user_moved');
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET team_id = ? WHERE id = ?').run(teamId, id);
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) {
    res.status(400).json({ error: "you can't remove your own account while signed in with it" });
    return;
  }
  // A removed account's live remote session would otherwise keep its Bastion link after the cascade.
  endActiveSessions({ userId: id }, 'force_closed', req.user!.username, 'user_deleted');
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
