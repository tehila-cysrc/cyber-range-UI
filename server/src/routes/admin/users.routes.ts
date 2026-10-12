import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getActiveEventRunId } from '../../db/seed.js';
import { endActiveSessions } from '../../services/accessBroker/accessBroker.service.js';
import { MIN_PASSWORD_LENGTH } from '../auth.routes.js';
import { parseAvatar } from '../../services/avatar.service.js';
import { writeAudit } from '../../services/audit.service.js';
import { kickRevokedSockets } from '../../sockets/index.js';
import { activeAdminCount, getAccount, insertAccount, revokeAccountTokens, usernameTaken } from '../../services/accounts.service.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

// Staff accounts (Roster → Instructors); `id` is the account id. Students are listed per team by
// GET /admin/teams instead.
router.get('/instructors', (_req, res) => {
  const instructors = db
    .prepare(
      `SELECT id, username, display_name AS displayName, avatar, role FROM accounts
       WHERE disabled_at IS NULL ORDER BY display_name COLLATE NOCASE`,
    )
    .all();
  res.json({ instructors });
});

// Disables a staff account (it keeps its history; it can no longer sign in). Never the caller's own
// account, never the last active admin.
router.delete('/accounts/:id', (req, res) => {
  const id = Number(req.params.id);
  const account = getAccount(id);
  if (!account || account.disabledAt) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  if (id === req.user!.accountId) {
    res.status(400).json({ error: "you can't remove your own account while signed in with it" });
    return;
  }
  if (account.role === 'admin' && activeAdminCount() <= 1) {
    res.status(409).json({ error: 'this is the last active admin account' });
    return;
  }
  const memberIds = db.prepare('SELECT id FROM users WHERE account_id = ?').all(id) as { id: number }[];
  for (const m of memberIds) endActiveSessions({ userId: m.id }, 'force_closed', req.user!.username, 'account_disabled');
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    revokeAccountTokens(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  writeAudit(req.user!.username, 'account.disabled', 'account', id, { username: account.username, role: account.role });
  kickRevokedSockets();
  res.json({ ok: true });
});

// Manual account creation for the current event run — mainly for additional instructor accounts
// or one-off overrides. Students can also self-register via POST /api/auth/register, but only while the
// instructor has opened registration with a join code (Roster page — see registration.service.ts).
router.post('/users', (req, res) => {
  const { username, password, role, teamId, displayName } = req.body ?? {};

  if (typeof username !== 'string' || !username.trim()) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
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

  // Staff are accounts (CONFIG). Until scoped instructors exist (RBAC stage 3), a new staff account is
  // an admin — exactly what an "instructor" has been so far.
  if (role === 'instructor') {
    const accountId = insertAccount(
      { username: username.trim(), password, role: 'admin', displayName: (displayName || username).trim(), avatar: avatar.avatar },
      req.user!.accountId,
    );
    writeAudit(req.user!.username, 'account.created', 'account', accountId, { username: username.trim(), role: 'admin' });
    res.status(201).json({ user: { id: accountId, username: username.trim(), role: 'admin', teamId: null } });
    return;
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO users (event_run_id, username, password, role, team_id, display_name, avatar)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        username.trim(),
        password,
        role,
        role === 'student' ? teamId : null,
        (displayName || username).trim(),
        avatar.avatar,
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
  const user = db.prepare('SELECT id, role, team_id AS teamId FROM users WHERE id = ? AND deactivated_at IS NULL').get(id) as
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
  kickRevokedSockets();
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) {
    res.status(400).json({ error: "you can't remove your own account while signed in with it" });
    return;
  }
  const user = db.prepare("SELECT username, role FROM users WHERE id = ? AND deactivated_at IS NULL AND role = 'student'").get(id) as
    | { username: string; role: string }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
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
