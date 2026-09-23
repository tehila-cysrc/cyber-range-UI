import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getActiveEventRunId } from '../../db/seed.js';
import { endActiveSessions } from '../../services/accessBroker/accessBroker.service.js';
import { generateJoinCode, getActiveRunRegistration, setRegistrationCode } from '../../services/registration.service.js';
import { writeAudit } from '../../services/audit.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.get('/teams', (_req, res) => {
  const teams = db.prepare('SELECT id, name FROM teams ORDER BY sort_order').all() as {
    id: number;
    name: string;
  }[];

  const membersStmt = db.prepare(
    'SELECT id, username, display_name AS displayName FROM users WHERE team_id = ? ORDER BY display_name',
  );

  const result = teams.map((team) => ({
    ...team,
    members: membersStmt.all(team.id),
  }));

  res.json({ teams: result });
});

// Student self-registration control (Roster page). Closed by default; opening it issues a fresh random
// join code, and "regenerate" invalidates the old one (e.g. if it was shared too widely).
router.get('/registration', (_req, res) => {
  const reg = getActiveRunRegistration();
  res.json({ open: !!reg?.code, joinCode: reg?.code ?? null });
});

router.put('/registration', (req, res) => {
  const { open } = req.body ?? {};
  const reg = getActiveRunRegistration();
  if (!reg) {
    res.status(409).json({ error: 'no active event run' });
    return;
  }
  const code = open ? generateJoinCode() : null;
  setRegistrationCode(reg.runId, code);
  writeAudit(req.user!.username, open ? 'registration.opened' : 'registration.closed', 'event_run', reg.runId, null);
  res.json({ open: !!code, joinCode: code });
});

// Onboarding a new cohort (e.g. after an event reset) — flexible N teams, never a fixed 2.
router.post('/teams', (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const runId = getActiveEventRunId();
  if (runId === null) {
    res.status(409).json({ error: 'no active event run' });
    return;
  }

  const nextSort = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM teams WHERE event_run_id = ?')
    .get(runId) as { n: number };

  const result = db
    .prepare('INSERT INTO teams (event_run_id, name, sort_order) VALUES (?, ?, ?)')
    .run(runId, name.trim(), nextSort.n);

  res.status(201).json({ team: { id: result.lastInsertRowid, name: name.trim() } });
});

router.delete('/teams/:id', (req, res) => {
  // Cascades to that team's users/progress/documentation/scores/help_requests too — deliberate:
  // an instructor removing a team they just created by mistake should not leave orphaned rows.
  // The cascade would delete the session rows but not their Bastion links — end them properly first.
  endActiveSessions({ teamId: Number(req.params.id) }, 'force_closed', req.user!.username, 'team_deleted');
  const result = db.prepare('DELETE FROM teams WHERE id = ?').run(Number(req.params.id));
  if (result.changes === 0) {
    res.status(404).json({ error: 'team not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
