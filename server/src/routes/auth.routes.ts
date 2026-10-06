import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { endActiveSessions } from '../services/accessBroker/accessBroker.service.js';
import {
  getActiveRunRegistration,
  isRateLimited,
  isRegistrationOpen,
  normalizeJoinCode,
  recordFailure,
  resolveJoinCode,
  teamsForScope,
  type JoinScope,
} from '../services/registration.service.js';
import { MIN_PASSWORD_LENGTH, updateOwnProfile } from '../services/profile.service.js';
import { parseAvatar, setOwnAvatar } from '../services/avatar.service.js';

const router = Router();

export { MIN_PASSWORD_LENGTH };
const TOKEN_TTL_HOURS = Number(process.env.TOKEN_TTL_HOURS ?? 12);

interface UserRow {
  id: number;
  username: string;
  password: string;
  role: string;
  teamId: number | null;
  displayName: string;
  avatar: string | null;
}

router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const activeRun = db.prepare('SELECT id FROM event_runs WHERE is_active = 1').get() as
    | { id: number }
    | undefined;
  if (!activeRun) {
    res.status(409).json({ error: 'no active event run — ask an instructor to seed/reset the event' });
    return;
  }

  // Plaintext comparison is an explicit, documented decision for this internal tool — see CLAUDE.md.
  const user = db
    .prepare(
      `SELECT id, username, password, role, team_id AS teamId, display_name AS displayName, avatar
       FROM users WHERE event_run_id = ? AND username = ?`,
    )
    .get(activeRun.id, username) as UserRow | undefined;

  if (!user || user.password !== password) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  db.prepare('INSERT INTO auth_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    user.id,
    createdAt.toISOString(),
    expiresAt.toISOString(),
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      teamId: user.teamId,
      displayName: user.displayName,
      avatar: user.avatar,
    },
  });
});

// Public: is self-registration open for this event? Reveals nothing else (no team names, no code).
router.get('/registration', (_req, res) => {
  res.json({ open: isRegistrationOpen() });
});

// Validates a join code and, only if it's right, returns the team names for the picker. POST so the
// code never lands in a URL / access log. Previously team names were public (GET /auth/teams).
// Returns what the code unlocks (general code -> unassigned teams, organization code -> that
// organization's teams), or null after already sending the error response.
function checkJoinCode(
  req: import('express').Request,
  res: import('express').Response,
): (JoinScope & { runId: number }) | null {
  const ip = req.ip ?? 'unknown';
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'too many wrong join codes — wait a few minutes and try again' });
    return null;
  }
  const reg = getActiveRunRegistration();
  if (!reg) {
    res.status(409).json({ error: 'no active event run — ask an instructor to seed/reset the event' });
    return null;
  }
  if (!isRegistrationOpen()) {
    res.status(403).json({ error: 'registration is closed — ask your instructor for an account or a join code', reason: 'registration_closed' });
    return null;
  }
  const scope = resolveJoinCode(reg.runId, reg.code, normalizeJoinCode(req.body?.joinCode));
  if (!scope) {
    recordFailure(ip);
    res.status(403).json({ error: 'that join code is not valid for this event', reason: 'invalid_join_code' });
    return null;
  }
  return { ...scope, runId: reg.runId };
}

router.post('/registration/teams', (req, res) => {
  const scope = checkJoinCode(req, res);
  if (!scope) return;
  res.json({ teams: teamsForScope(scope.runId, scope), organizationName: scope.organizationName });
});

// Self-registration, gated by the instructor's join code (see registration.service.ts): only when the
// instructor has opened registration for this event, and only with the code they handed out.
router.post('/register', (req, res) => {
  const scope = checkJoinCode(req, res);
  if (!scope) return;
  const { teamId, username, password, displayName } = req.body ?? {};
  const avatar = parseAvatar(req.body?.avatar);
  if (!avatar.ok) {
    res.status(400).json({ error: avatar.error });
    return;
  }

  if (typeof username !== 'string' || !username.trim()) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    return;
  }
  if (typeof teamId !== 'number') {
    res.status(400).json({ error: 'teamId is required' });
    return;
  }

  const activeRun = db.prepare('SELECT id FROM event_runs WHERE is_active = 1').get() as
    | { id: number }
    | undefined;
  if (!activeRun) {
    res.status(409).json({ error: 'no active event run — ask an instructor to seed/reset the event' });
    return;
  }

  // Server-side scope check — the picker only lists the code's teams, but teamId comes from the client.
  const team = db
    .prepare('SELECT id FROM teams WHERE id = ? AND event_run_id = ? AND organization_id IS ?')
    .get(teamId, activeRun.id, scope.organizationId);
  if (!team) {
    res.status(400).json({ error: 'that team is not available with this join code' });
    return;
  }

  let userId: number;
  try {
    const result = db
      .prepare(
        `INSERT INTO users (event_run_id, username, password, role, team_id, display_name, avatar)
         VALUES (?, ?, ?, 'student', ?, ?, ?)`,
      )
      .run(activeRun.id, username.trim(), password, teamId, (displayName || username).trim(), avatar.avatar);
    userId = Number(result.lastInsertRowid);
  } catch (err) {
    res.status(409).json({ error: `username "${username}" is already taken this run` });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  db.prepare('INSERT INTO auth_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    createdAt.toISOString(),
    expiresAt.toISOString(),
  );

  res.status(201).json({
    token,
    user: {
      id: userId,
      username: username.trim(),
      role: 'student',
      teamId,
      displayName: (displayName || username).trim(),
      avatar: avatar.avatar,
    },
  });
});

router.post('/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization!.slice(7);
  // A signed-out user must not leave a live remote session (and its Bastion link) behind on a shared
  // lab machine.
  endActiveSessions({ userId: req.user!.id }, 'completed', req.user!.username, 'logout');
  db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db
    .prepare(
      'SELECT id, username, role, team_id AS teamId, display_name AS displayName, avatar FROM users WHERE id = ?',
    )
    .get(req.user!.id);
  res.json({ user });
});

// Self-service profile edit for any signed-in user — see profile.service.ts for the rules.
router.patch('/me', requireAuth, (req, res) => {
  const token = req.headers.authorization!.slice(7);
  const result = updateOwnProfile(req.user!.id, token, req.body ?? {});
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ user: result.user, passwordChanged: result.passwordChanged });
});

// Pick or clear (null) the signed-in user's preset avatar — see avatar.service.ts.
router.put('/me/avatar', requireAuth, (req, res) => {
  const result = setOwnAvatar(req.user!.id, req.body?.avatar);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ avatar: result.avatar });
});

export default router;
