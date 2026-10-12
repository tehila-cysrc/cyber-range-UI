import { Router } from 'express';
import { isAdmin, isInstructor } from '../../authz/roles.js';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { MIN_PASSWORD_LENGTH } from '../auth.routes.js';
import { parseAvatar } from '../../services/avatar.service.js';
import { writeAudit } from '../../services/audit.service.js';
import { endActiveSessions } from '../../services/accessBroker/accessBroker.service.js';
import {
  activeAdminCount,
  getAccount,
  insertAccount,
  revokeAccountTokens,
  scopedInstructorsEnabled,
  syncMembership,
  usernameTaken,
  type StaffRole,
} from '../../services/accounts.service.js';
import { kickRevokedSockets } from '../../sockets/index.js';

// Staff accounts and instructor scope — admin only (account.manage / assignment.manage). An
// instructor can never create, promote or scope an account, including their own (RBAC PE-2/PE-4).
const router = Router();

router.use(requireAuth);

const STAFF_ROLES: StaffRole[] = ['admin', 'instructor'];

interface AssignmentRow {
  organizationId: number;
  organizationName: string;
  cyberRangeId: number;
  cyberRangeName: string;
}

function assignmentsOf(accountId: number): AssignmentRow[] {
  return db
    .prepare(
      `SELECT ia.organization_id AS organizationId, o.name AS organizationName,
              ia.cyber_range_id AS cyberRangeId, cr.name AS cyberRangeName
       FROM instructor_assignments ia
       JOIN organizations o ON o.id = ia.organization_id
       JOIN cyber_ranges cr ON cr.id = ia.cyber_range_id
       WHERE ia.account_id = ?
       ORDER BY o.name COLLATE NOCASE, cr.name COLLATE NOCASE`,
    )
    .all(accountId) as unknown as AssignmentRow[];
}

function accountDTO(id: number) {
  const a = getAccount(id);
  if (!a) return null;
  return {
    id: a.id,
    username: a.username,
    role: a.role,
    displayName: a.displayName,
    avatar: a.avatar,
    createdAt: a.createdAt,
    disabledAt: a.disabledAt,
    assignments: isInstructor(a.role) ? assignmentsOf(a.id) : [],
  };
}

// Signs the account out everywhere and cuts its live sessions/sockets — after any change to what it
// may do (role, disable, password reset by an admin).
function cutAccount(accountId: number, actor: string, reason: string) {
  const members = db.prepare('SELECT id FROM users WHERE account_id = ?').all(accountId) as { id: number }[];
  for (const m of members) endActiveSessions({ userId: m.id }, 'force_closed', actor, reason);
  revokeAccountTokens(accountId);
  kickRevokedSockets();
}

router.get('/accounts', requirePermission('account.manage'), (_req, res) => {
  const ids = db.prepare('SELECT id FROM accounts ORDER BY disabled_at IS NOT NULL, display_name COLLATE NOCASE').all() as { id: number }[];
  res.json({ accounts: ids.map((r) => accountDTO(r.id)), scopedInstructorsEnabled: scopedInstructorsEnabled() });
});

router.post('/accounts', requirePermission('account.manage'), (req, res) => {
  const { username, password, role, displayName } = req.body ?? {};
  if (typeof username !== 'string' || !username.trim()) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    return;
  }
  if (!STAFF_ROLES.includes(role)) {
    res.status(400).json({ error: "role must be 'admin' or 'instructor'" });
    return;
  }
  if (isInstructor(role) && !scopedInstructorsEnabled()) {
    res.status(409).json({ error: 'instructor accounts are switched off on this deployment (ENABLE_SCOPED_INSTRUCTORS=false)' });
    return;
  }
  const avatar = parseAvatar(req.body?.avatar);
  if (!avatar.ok) {
    res.status(400).json({ error: avatar.error });
    return;
  }
  if (usernameTaken(username.trim())) {
    res.status(409).json({ error: `username "${username}" is already taken` });
    return;
  }
  const id = insertAccount(
    { username: username.trim(), password, role, displayName: (typeof displayName === 'string' && displayName.trim()) || username.trim(), avatar: avatar.avatar },
    req.user!.accountId,
  );
  writeAudit(req.user!.username, 'account.created', 'account', id, { username: username.trim(), role });
  res.status(201).json({ account: accountDTO(id) });
});

// {displayName?, password?, role?, disabled?: boolean}. Never on yourself for role/disable; never
// leaves the system without an active admin.
router.patch('/accounts/:id', requirePermission('account.manage'), (req, res) => {
  const id = Number(req.params.id);
  const account = getAccount(id);
  if (!account) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  const { displayName, password, role, disabled } = req.body ?? {};
  const self = id === req.user!.accountId;
  if (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim())) {
    res.status(400).json({ error: 'displayName cannot be empty' });
    return;
  }
  if (password !== undefined && (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)) {
    res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    return;
  }
  if (role !== undefined && !STAFF_ROLES.includes(role)) {
    res.status(400).json({ error: "role must be 'admin' or 'instructor'" });
    return;
  }
  if (disabled !== undefined && typeof disabled !== 'boolean') {
    res.status(400).json({ error: 'disabled must be true or false' });
    return;
  }
  const roleChanges = role !== undefined && role !== account.role;
  const disabling = disabled === true && !account.disabledAt;
  const enabling = disabled === false && !!account.disabledAt;
  if (self && (roleChanges || disabling)) {
    res.status(400).json({ error: "you can't change your own role or disable your own account" });
    return;
  }
  if (roleChanges && isInstructor(role) && !scopedInstructorsEnabled()) {
    res.status(409).json({ error: 'instructor accounts are switched off on this deployment (ENABLE_SCOPED_INSTRUCTORS=false)' });
    return;
  }
  const losesAdmin = isAdmin(account.role) && !account.disabledAt && ((roleChanges && !isAdmin(role)) || disabling);
  if (losesAdmin && activeAdminCount() <= 1) {
    res.status(409).json({ error: 'this is the last active admin account' });
    return;
  }
  if (enabling && usernameTaken(account.username, { accountId: id })) {
    res.status(409).json({ error: `username "${account.username}" is now taken — rename the other account first` });
    return;
  }

  db.exec('BEGIN');
  try {
    if (displayName !== undefined) db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(displayName.trim(), id);
    if (password !== undefined) db.prepare('UPDATE accounts SET password = ? WHERE id = ?').run(password, id);
    if (roleChanges) {
      db.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role, id);
      // An admin holds no assignments; a demoted admin starts with an empty scope.
      db.prepare('DELETE FROM instructor_assignments WHERE account_id = ?').run(id);
    }
    if (disabling) db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    if (enabling) db.prepare('UPDATE accounts SET disabled_at = NULL WHERE id = ?').run(id);
    syncMembership(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const changes = Object.keys(req.body ?? {}).filter((k) => ['displayName', 'password', 'role', 'disabled'].includes(k));
  writeAudit(req.user!.username, roleChanges ? 'account.role_changed' : disabling ? 'account.disabled' : 'account.updated', 'account', id, {
    username: account.username,
    changes,
    ...(roleChanges ? { from: account.role, to: role } : {}),
  });
  if (roleChanges || disabling || password !== undefined) cutAccount(id, req.user!.username, roleChanges ? 'account_role_changed' : 'account_changed');
  res.json({ account: accountDTO(id) });
});

// Disables (never hard-deletes: the account's work stays attributed). Same guards as PATCH.
router.delete('/accounts/:id', requirePermission('account.manage'), (req, res) => {
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
  if (isAdmin(account.role) && activeAdminCount() <= 1) {
    res.status(409).json({ error: 'this is the last active admin account' });
    return;
  }
  db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  writeAudit(req.user!.username, 'account.disabled', 'account', id, { username: account.username, role: account.role });
  cutAccount(id, req.user!.username, 'account_disabled');
  res.json({ ok: true });
});

router.get('/accounts/:id/assignments', requirePermission('assignment.manage'), (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  res.json({ assignments: isInstructor(account.role) ? assignmentsOf(account.id) : [] });
});

// Replaces the instructor's whole scope with {pairs: [{organizationId, cyberRangeId}]} — explicit
// pairs only, no wildcard. Every added/removed pair is audited. Scope is read fresh per request (HTTP
// and socket delivery), so the change applies immediately without signing the instructor out.
router.put('/accounts/:id/assignments', requirePermission('assignment.manage'), (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  if (!isInstructor(account.role)) {
    res.status(400).json({ error: 'only instructor accounts have assignments — admins already see everything' });
    return;
  }
  const raw = req.body?.pairs;
  if (!Array.isArray(raw) || raw.length > 500) {
    res.status(400).json({ error: 'pairs must be an array of {organizationId, cyberRangeId}' });
    return;
  }
  const wanted = new Map<string, { orgId: number; rangeId: number }>();
  for (const item of raw) {
    const orgId = Number(item?.organizationId);
    const rangeId = Number(item?.cyberRangeId);
    if (!Number.isInteger(orgId) || !Number.isInteger(rangeId)) {
      res.status(400).json({ error: 'pairs must be an array of {organizationId, cyberRangeId}' });
      return;
    }
    if (!db.prepare('SELECT 1 FROM organizations WHERE id = ?').get(orgId)) {
      res.status(400).json({ error: `unknown organization ${orgId}` });
      return;
    }
    if (!db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(rangeId)) {
      res.status(400).json({ error: `unknown cyber range ${rangeId}` });
      return;
    }
    wanted.set(`${orgId}:${rangeId}`, { orgId, rangeId });
  }
  const current = db
    .prepare('SELECT organization_id AS orgId, cyber_range_id AS rangeId FROM instructor_assignments WHERE account_id = ?')
    .all(account.id) as { orgId: number; rangeId: number }[];
  const currentKeys = new Set(current.map((c) => `${c.orgId}:${c.rangeId}`));
  const removed = current.filter((c) => !wanted.has(`${c.orgId}:${c.rangeId}`));
  const added = [...wanted.values()].filter((w) => !currentKeys.has(`${w.orgId}:${w.rangeId}`));

  db.exec('BEGIN');
  try {
    const del = db.prepare('DELETE FROM instructor_assignments WHERE account_id = ? AND organization_id = ? AND cyber_range_id = ?');
    for (const r of removed) del.run(account.id, r.orgId, r.rangeId);
    const ins = db.prepare(
      'INSERT INTO instructor_assignments (account_id, organization_id, cyber_range_id, created_at, created_by_account_id) VALUES (?, ?, ?, ?, ?)',
    );
    const now = new Date().toISOString();
    for (const a of added) ins.run(account.id, a.orgId, a.rangeId, now, req.user!.accountId);
    for (const r of removed) {
      writeAudit(req.user!.username, 'assignment.removed', 'account', account.id, { username: account.username }, { organizationId: r.orgId, cyberRangeId: r.rangeId });
    }
    for (const a of added) {
      writeAudit(req.user!.username, 'assignment.added', 'account', account.id, { username: account.username }, { organizationId: a.orgId, cyberRangeId: a.rangeId });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  // A narrowed scope must also end the instructor's remote sessions on VMs that left it.
  if (removed.length > 0) {
    const members = db.prepare('SELECT id FROM users WHERE account_id = ?').all(account.id) as { id: number }[];
    for (const m of members) endActiveSessions({ userId: m.id }, 'force_closed', req.user!.username, 'assignment_removed');
  }
  res.json({ assignments: assignmentsOf(account.id) });
});

export default router;
