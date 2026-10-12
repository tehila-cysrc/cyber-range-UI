import { Router } from 'express';
import { isStudent } from '../../authz/roles.js';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { assertTeamInScope } from '../../authz/resolve.js';
import { getActiveEventRunId } from '../../db/seed.js';
import { endActiveSessions } from '../../services/accessBroker/accessBroker.service.js';
import { MIN_PASSWORD_LENGTH } from '../auth.routes.js';
import { parseAvatar } from '../../services/avatar.service.js';
import { writeAudit } from '../../services/audit.service.js';
import { kickRevokedSockets } from '../../sockets/index.js';
import { usernameTaken } from '../../services/accounts.service.js';

const router = Router();

router.use(requireAuth);

// Manual student creation for the current event run. Students can also self-register via
// POST /api/auth/register, but only while an admin has opened registration with a join code. Staff
// accounts are created on /admin/accounts (admin only) — this route never creates one (RBAC PE-2).
router.post('/users', requirePermission('student.manage'), (req, res) => {
  const { username, password, role, teamId, displayName } = req.body ?? {};

  if (typeof username !== 'string' || !username.trim()) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    return;
  }
  if (role !== undefined && !isStudent(role)) {
    res.status(400).json({ error: 'only students are created here — staff accounts are managed under Accounts' });
    return;
  }
  if (!teamId) {
    res.status(400).json({ error: 'teamId is required for a student' });
    return;
  }
  if (!assertTeamInScope(req, res, Number(teamId))) return;
  if (usernameTaken(username.trim())) {
    res.status(409).json({ error: `username "${username}" is already taken` });
    return;
  }
  const avatar = parseAvatar(req.body?.avatar);
  if (!avatar.ok) {
    res.status(400).json({ error: avatar.error });
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
        `INSERT INTO users (event_run_id, username, password, role, team_id, display_name, avatar)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(runId, username.trim(), password, 'student', Number(teamId), (displayName || username).trim(), avatar.avatar);

    writeAudit(req.user!.username, 'user.created', 'user', Number(result.lastInsertRowid), { username: username.trim(), teamId: Number(teamId) });
    res.status(201).json({
      user: { id: result.lastInsertRowid, username: username.trim(), role: 'student', teamId: Number(teamId) },
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
router.patch('/users/:id', requirePermission('student.manage'), (req, res) => {
  const id = Number(req.params.id);
  const teamId = Number(req.body?.teamId);
  // Only students belong to a team; a staff membership row is simply not found here.
  const user = db
    .prepare("SELECT id, team_id AS teamId FROM users WHERE id = ? AND deactivated_at IS NULL AND role = 'student'")
    .get(id) as { id: number; teamId: number | null } | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  // Both ends of the move must be in scope (RBAC PE-5): the student's current team and the target.
  if (user.teamId === null || !assertTeamInScope(req, res, user.teamId)) {
    if (user.teamId === null) res.status(404).json({ error: 'user not found' });
    return;
  }
  if (!assertTeamInScope(req, res, teamId)) return;
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
  writeAudit(req.user!.username, 'user.moved', 'user', id, { fromTeamId: user.teamId, toTeamId: teamId });
  kickRevokedSockets();
  res.json({ ok: true });
});

router.delete('/users/:id', requirePermission('student.manage'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) {
    res.status(400).json({ error: "you can't remove your own account while signed in with it" });
    return;
  }
  const user = db
    .prepare("SELECT username, role, team_id AS teamId FROM users WHERE id = ? AND deactivated_at IS NULL AND role = 'student'")
    .get(id) as { username: string; role: string; teamId: number | null } | undefined;
  if (!user || user.teamId === null) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  if (!assertTeamInScope(req, res, user.teamId)) return;
  // A removed account's live remote session would otherwise keep its Bastion link after the cascade.
  endActiveSessions({ userId: id }, 'force_closed', req.user!.username, 'user_deleted');
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  } catch {
    // FOREIGN KEY failure: the account authored timeline entries / canvas nodes / help requests or
    // awarded scores. Deleting it would silently rewrite the team's investigation record, so the account
    // is deactivated instead: it can't sign in and drops out of every roster, but its work stays credited.
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET deactivated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
      db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    writeAudit(req.user!.username, 'user.deactivated', 'user', id, { username: user.username, role: user.role });
    kickRevokedSockets();
    res.json({ ok: true, deactivated: true });
    return;
  }
  writeAudit(req.user!.username, 'user.deleted', 'user', id, { username: user.username, role: user.role });
  kickRevokedSockets();
  res.json({ ok: true });
});

export default router;
