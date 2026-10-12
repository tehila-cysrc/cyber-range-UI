import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { assertOrganizationInScope, assertTeamInScope } from '../../authz/resolve.js';
import { scopeWhere, teamOrganization, teamWorkCoveredBy } from '../../authz/scope.js';
import { isAdmin } from '../../authz/roles.js';
import { getActiveEventRunId } from '../../db/seed.js';
import { endActiveSessions } from '../../services/accessBroker/accessBroker.service.js';
import { generateUniqueJoinCode, getActiveRunRegistration, setRegistrationCode } from '../../services/registration.service.js';
import { writeAudit } from '../../services/audit.service.js';
import { setTeamOrganization } from '../../services/organizations.service.js';
import { emitLeaderboardUpdate } from '../../sockets/emitters.js';
import { kickRevokedSockets } from '../../sockets/index.js';

const router = Router();

router.use(requireAuth);

// Admin: every team; instructor: the teams of their assigned organizations (filtered in SQL).
router.get('/teams', requirePermission('team.read'), (req, res) => {
  const scoped = scopeWhere(req.user!, 't.organization_id');
  const teams = db
    .prepare(
      `SELECT t.id, t.name, t.organization_id AS organizationId, o.name AS organizationName
       FROM teams t LEFT JOIN organizations o ON o.id = t.organization_id
       WHERE ${scoped.sql}
       ORDER BY t.sort_order`,
    )
    .all(...scoped.params) as { id: number; name: string; organizationId: number | null; organizationName: string | null }[];

  const membersStmt = db.prepare(
    'SELECT id, username, display_name AS displayName, avatar FROM users WHERE team_id = ? AND deactivated_at IS NULL ORDER BY display_name',
  );

  const result = teams.map((team) => ({
    ...team,
    members: membersStmt.all(team.id),
  }));

  res.json({ teams: result });
});

// Student self-registration control (Roster page). Closed by default; opening it issues a fresh random
// join code, and "regenerate" invalidates the old one (e.g. if it was shared too widely).
router.get('/registration', requirePermission('registration.manage'), (_req, res) => {
  const reg = getActiveRunRegistration();
  res.json({ open: !!reg?.code, joinCode: reg?.code ?? null });
});

router.put('/registration', requirePermission('registration.manage'), (req, res) => {
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
router.post('/teams', requirePermission('team.manage'), (req, res) => {
  const { name, organizationId } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  // A team without an organization is admin-only — an instructor's new team must land in their scope.
  const hasOrg = organizationId !== null && organizationId !== undefined && organizationId !== '';
  if (!hasOrg && !isAdmin(req.user!.role)) {
    res.status(400).json({ error: 'organizationId is required' });
    return;
  }
  if (hasOrg && !isAdmin(req.user!.role) && !assertOrganizationInScope(req, res, Number(organizationId))) return;

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

  writeAudit(req.user!.username, 'team.created', 'team', teamId, { name: name.trim() }, { organizationId: org.value.organizationId });
  // Students' boards are scoped by organization, so team membership changes move them too.
  emitLeaderboardUpdate();
  res.status(201).json({ team: { id: teamId, name: name.trim(), organizationId: org.value.organizationId } });
});

// Assign a team to an organization, or clear it with {organizationId: null}.
// Moving a team between organizations moves its whole history with it, so both ends must be in scope
// (RBAC PE-5); clearing the organization (admin-only territory) is admin-only.
router.patch('/teams/:id', requirePermission('team.manage'), (req, res) => {
  if (!req.body || !('organizationId' in req.body)) {
    res.status(400).json({ error: 'organizationId is required (null to clear)' });
    return;
  }
  const teamId = Number(req.params.id);
  if (!assertTeamInScope(req, res, teamId)) return;
  const target = req.body.organizationId;
  const clearing = target === null || target === undefined || target === '';
  if (clearing && !isAdmin(req.user!.role)) {
    res.status(403).json({ error: 'only an admin can remove a team from its organization' });
    return;
  }
  if (!clearing && !isAdmin(req.user!.role) && !assertOrganizationInScope(req, res, Number(target))) return;
  const from = teamOrganization(teamId)?.orgId ?? null;
  // The team's whole history moves with it: every scenario it has work on must be in the caller's
  // pairs under BOTH organizations, or the move would expose (or hide) another pair's data.
  if (!clearing && !(teamWorkCoveredBy(req.user!, teamId, from) && teamWorkCoveredBy(req.user!, teamId, Number(target)))) {
    res.status(403).json({ error: "this team has work on scenarios outside your assignments in one of the organizations — ask an admin to move it" });
    return;
  }
  const r = setTeamOrganization(teamId, target);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  writeAudit(req.user!.username, 'team.organization_changed', 'team', teamId, { from, organizationId: r.value.organizationId }, { organizationId: r.value.organizationId });
  emitLeaderboardUpdate();
  res.json({ ok: true, organizationId: r.value.organizationId });
});

router.delete('/teams/:id', requirePermission('team.manage'), (req, res) => {
  const teamId = Number(req.params.id);
  if (!assertTeamInScope(req, res, teamId)) return;
  const orgId = teamOrganization(teamId)?.orgId ?? null;
  // Deleting cascades every scenario's work — never another pair's.
  if (!teamWorkCoveredBy(req.user!, teamId, orgId)) {
    res.status(403).json({ error: 'this team has work on scenarios outside your assignments — ask an admin to delete it' });
    return;
  }
  // Cascades to that team's users/progress/documentation/scores/help_requests too — deliberate:
  // an instructor removing a team they just created by mistake should not leave orphaned rows.
  // The cascade would delete the session rows but not their Bastion links — end them properly first.
  endActiveSessions({ teamId: Number(req.params.id) }, 'force_closed', req.user!.username, 'team_deleted');
  const result = db.prepare('DELETE FROM teams WHERE id = ?').run(Number(req.params.id));
  if (result.changes === 0) {
    res.status(404).json({ error: 'team not found' });
    return;
  }
  writeAudit(req.user!.username, 'team.deleted', 'team', teamId, null, { organizationId: orgId });
  kickRevokedSockets();
  emitLeaderboardUpdate();
  res.json({ ok: true });
});

export default router;
