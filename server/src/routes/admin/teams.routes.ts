import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getActiveEventRunId } from '../../db/seed.js';
import { endActiveSessions } from '../../services/accessBroker/accessBroker.service.js';
import { generateUniqueJoinCode, getActiveRunRegistration, setRegistrationCode } from '../../services/registration.service.js';
import { writeAudit } from '../../services/audit.service.js';
import { setTeamOrganization } from '../../services/organizations.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.get('/teams', (_req, res) => {
  const teams = db
    .prepare(
      `SELECT t.id, t.name, t.organization_id AS organizationId, o.name AS organizationName
       FROM teams t LEFT JOIN organizations o ON o.id = t.organization_id
       ORDER BY t.sort_order`,
    )
    .all() as { id: number; name: string; organizationId: number | null; organizationName: string | null }[];

  const membersStmt = db.prepare(
    'SELECT id, username, display_name AS displayName, avatar FROM users WHERE team_id = ? ORDER BY display_name',
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
  const code = open ? generateUniqueJoinCode(reg.runId) : null;
  setRegistrationCode(reg.runId, code);
  writeAudit(req.user!.username, open ? 'registration.opened' : 'registration.closed', 'event_run', reg.runId, null);
  res.json({ open: !!code, joinCode: code });
});

// Onboarding a new cohort (e.g. after an event reset) — flexible N teams, never a fixed 2.
router.post('/teams', (req, res) => {
  const { name, organizationId } = req.body ?? {};
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
  const teamId = Number(result.lastInsertRowid);

  // Optional — a team can be created first and assigned to an organization later (PATCH below).
  const org = setTeamOrganization(teamId, organizationId);
  if (!org.ok) {
    db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
    res.status(org.status).json({ error: org.error });
    return;
  }

  res.status(201).json({ team: { id: teamId, name: name.trim(), organizationId: org.value.organizationId } });
});

// Assign a team to an organization, or clear it with {organizationId: null}.
router.patch('/teams/:id', (req, res) => {
  if (!req.body || !('organizationId' in req.body)) {
    res.status(400).json({ error: 'organizationId is required (null to clear)' });
    return;
  }
  const teamId = Number(req.params.id);
  const r = setTeamOrganization(teamId, req.body.organizationId);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  writeAudit(req.user!.username, 'team.organization_changed', 'team', teamId, { organizationId: r.value.organizationId });
  res.json({ ok: true, organizationId: r.value.organizationId });
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
