import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const TOKEN_TTL_HOURS = Number(process.env.TOKEN_TTL_HOURS ?? 12);

interface UserRow {
  id: number;
  username: string;
  password: string;
  role: string;
  teamId: number | null;
  displayName: string;
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
      `SELECT id, username, password, role, team_id AS teamId, display_name AS displayName
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
    },
  });
});

// Public roster for the registration team picker — names only, no member/account details.
router.get('/teams', (_req, res) => {
  const activeRun = db.prepare('SELECT id FROM event_runs WHERE is_active = 1').get() as
    | { id: number }
    | undefined;
  if (!activeRun) {
    res.status(409).json({ error: 'no active event run — ask an instructor to seed/reset the event' });
    return;
  }

  const teams = db
    .prepare('SELECT id, name FROM teams WHERE event_run_id = ? ORDER BY sort_order')
    .all(activeRun.id) as { id: number; name: string }[];

  res.json({ teams });
});

// Self-registration: instructors create teams, students pick one and create their own account.
router.post('/register', (req, res) => {
  const { teamId, username, password, displayName } = req.body ?? {};

  if (typeof username !== 'string' || !username.trim()) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'password is required' });
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

  const team = db
    .prepare('SELECT id FROM teams WHERE id = ? AND event_run_id = ?')
    .get(teamId, activeRun.id);
  if (!team) {
    res.status(400).json({ error: 'unknown team for the active event' });
    return;
  }

  let userId: number;
  try {
    const result = db
      .prepare(
        `INSERT INTO users (event_run_id, username, password, role, team_id, display_name)
         VALUES (?, ?, ?, 'student', ?, ?)`,
      )
      .run(activeRun.id, username.trim(), password, teamId, (displayName || username).trim());
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
    },
  });
});

router.post('/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization!.slice(7);
  db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db
    .prepare(
      'SELECT id, username, role, team_id AS teamId, display_name AS displayName FROM users WHERE id = ?',
    )
    .get(req.user!.id);
  res.json({ user });
});

export default router;
