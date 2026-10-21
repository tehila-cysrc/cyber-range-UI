import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-authz-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { PERMISSIONS, can, permissionsFor } = await import('../dist/authz/permissions.js');
const scope = await import('../dist/authz/scope.js');
const fx = await import('./fixtures/rbac.mjs');

let f;

before(() => {
  seed();
  f = fx.buildRbacFixture(db, getActiveEventRunId());
});

const ADMIN_ONLY = [
  'org.manage',
  'registration.manage',
  'account.manage',
  'assignment.manage',
  'scenario.create',
  'scenario.delete',
  'environment.manage',
  'script.write',
  'script.adhoc',
  'event.reset',
  'event.export',
  'remote_access.revoke_all',
  'ai_resources.manage',
  'certificate.manage',
];
const STUDENT_ONLY = ['team.self', 'documentation.write', 'canvas.write', 'help.request', 'access_session.self'];

test('admin may do everything except team-member-only actions', () => {
  for (const p of PERMISSIONS) assert.equal(can('admin', p), !STUDENT_ONLY.includes(p), p);
});

test('instructor never holds an admin-only or student-only permission', () => {
  for (const p of [...ADMIN_ONLY, ...STUDENT_ONLY]) assert.equal(can('instructor', p), false, p);
  // ...and every other permission is an instructor one (the staff UI depends on it).
  for (const p of PERMISSIONS.filter((x) => !ADMIN_ONLY.includes(x) && !STUDENT_ONLY.includes(x))) {
    assert.equal(can('instructor', p), true, p);
  }
});

test('student holds exactly the team-member and read permissions', () => {
  assert.deepEqual(permissionsFor('student').sort(), [
    ...STUDENT_ONLY,
    'documentation.read',
    'canvas.read',
    'history.read',
    'leaderboard.read',
    'scenario.read',
    'mitre.read',
    'profile.self',
  ].sort());
  assert.equal(can('nobody', 'team.read'), false);
});

test('pair scope: iAB sees A on S1 and B on S2 but never A on S2 or B on S1 (no cross product)', () => {
  const iAB = f.principal('iAB');
  assert.equal(scope.pairInScope(iAB, f.teamA, f.s1), true);
  assert.equal(scope.pairInScope(iAB, f.teamB, f.s2), true);
  assert.equal(scope.pairInScope(iAB, f.teamA, f.s2), false);
  assert.equal(scope.pairInScope(iAB, f.teamB, f.s1), false);
  const iA = f.principal('iA');
  assert.equal(scope.pairInScope(iA, f.teamA, f.s1), true);
  assert.equal(scope.pairInScope(iA, f.teamB, f.s2), false);
});

test('team and organization scope follow the assigned organizations', () => {
  const iA = f.principal('iA');
  assert.equal(scope.teamInScope(iA, f.teamA), true);
  assert.equal(scope.teamInScope(iA, f.teamB), false);
  assert.equal(scope.organizationInScope(iA, f.orgA), true);
  assert.equal(scope.organizationInScope(iA, f.orgB), false);
  assert.equal(scope.scenarioInScope(iA, f.s1), true);
  assert.equal(scope.scenarioInScope(iA, f.s2), false);
});

test('a team without an organization is admin-only', () => {
  assert.equal(scope.teamInScope(f.principal('iAB'), f.teamNoOrg), false);
  assert.equal(scope.pairInScope(f.principal('iAB'), f.teamNoOrg, f.s1), false);
  assert.equal(scope.teamInScope(f.admin, f.teamNoOrg), true);
  assert.equal(scope.pairInScope(f.admin, f.teamNoOrg, f.s1), true);
});

test('admin scope is everything; missing teams are never in scope', () => {
  assert.equal(scope.pairInScope(f.admin, f.teamB, f.s2), true);
  assert.equal(scope.scenarioInScope(f.admin, f.s2), true);
  assert.equal(scope.organizationInScope(f.admin, f.orgB), true);
  assert.equal(scope.teamInScope(f.admin, 999999), false);
  assert.equal(scope.pairInScope(f.principal('iA'), 999999, f.s1), false);
});

test('a student is in scope only for their own team', () => {
  const s = f.student(f.teamA);
  assert.equal(scope.teamInScope(s, f.teamA), true);
  assert.equal(scope.teamInScope(s, f.teamB), false);
  assert.equal(scope.pairInScope(s, f.teamA, f.s2), true);
  assert.equal(scope.pairInScope(s, f.teamB, f.s1), false);
  assert.equal(scope.scenarioInScope(s, f.s1), false);
  assert.equal(scope.organizationInScope(s, f.orgA), false);
  assert.equal(scope.teamInScope({ ...s, teamId: null }, f.teamA), false);
});

test('a disabled account loses its whole scope immediately', () => {
  const iA = f.principal('iA');
  db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run('2026-01-01', iA.accountId);
  try {
    assert.equal(scope.pairInScope(iA, f.teamA, f.s1), false);
    assert.equal(scope.scenarioInScope(iA, f.s1), false);
  } finally {
    db.prepare('UPDATE accounts SET disabled_at = NULL WHERE id = ?').run(iA.accountId);
  }
});

test('exclusivity: VM/occurrence actions only while every team on the scenario is in scope', () => {
  const iA = f.principal('iA');
  db.exec('DELETE FROM team_cyber_range_progress');
  const start = db.prepare(
    "INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status, started_at) VALUES (?, ?, ?, '2026-01-01')",
  );
  assert.equal(scope.scenarioExclusiveFor(iA, f.s1), true); // nobody on it
  start.run(f.teamA, f.s1, 'active');
  assert.equal(scope.scenarioExclusiveFor(iA, f.s1), true);
  start.run(f.teamB, f.s1, 'paused'); // organization B is on S1 too
  assert.equal(scope.scenarioExclusiveFor(iA, f.s1), false);
  assert.equal(scope.scenarioExclusiveFor(f.admin, f.s1), true);
  db.prepare("UPDATE team_cyber_range_progress SET status = 'completed' WHERE team_id = ?").run(f.teamB);
  assert.equal(scope.scenarioExclusiveFor(iA, f.s1), true); // finished teams don't block
  start.run(f.teamNoOrg, f.s1, 'active');
  assert.equal(scope.scenarioExclusiveFor(iA, f.s1), false); // an unassigned team blocks too
  assert.equal(scope.scenarioExclusiveFor(iA, f.s2), false); // not even assigned
  db.exec('DELETE FROM team_cyber_range_progress');
});

test('scopeWhere filters in SQL, with bound parameters', () => {
  const pairs = (p) => {
    const w = scope.scopeWhere(p, 't.organization_id', 'r.id');
    if (p.role === 'instructor') {
      assert.deepEqual(w.params, [p.accountId]); // bound, never concatenated into the SQL
      assert.ok(!w.sql.includes(`= ${p.accountId}`));
    }
    return db
      .prepare(`SELECT t.id AS team, r.id AS range FROM teams t CROSS JOIN cyber_ranges r WHERE r.id IN (?, ?) AND ${w.sql} ORDER BY t.id, r.id`)
      .all(f.s1, f.s2, ...w.params)
      .map((r) => `${r.team}:${r.range}`);
  };
  assert.deepEqual(pairs(f.principal('iAB')), [`${f.teamA}:${f.s1}`, `${f.teamB}:${f.s2}`]);
  assert.deepEqual(pairs(f.principal('iA')), [`${f.teamA}:${f.s1}`]);
  assert.equal(pairs(f.admin).length, db.prepare('SELECT COUNT(*) AS n FROM teams').get().n * 2);
  assert.deepEqual(pairs(f.student(f.teamA)), []);

  const orgs = (p) => {
    const w = scope.scopeWhere(p, 't.organization_id');
    return db.prepare(`SELECT t.id FROM teams t WHERE ${w.sql} ORDER BY t.id`).all(...w.params).map((r) => r.id);
  };
  assert.deepEqual(orgs(f.principal('iA')), [f.teamA]);
  assert.deepEqual(orgs(f.principal('iAB')), [f.teamA, f.teamB].sort((a, b) => a - b));

  const ranges = (p) => {
    const w = scope.scenarioWhere(p, 'r.id');
    return db.prepare(`SELECT r.id FROM cyber_ranges r WHERE r.id IN (?, ?) AND ${w.sql} ORDER BY r.id`).all(f.s1, f.s2, ...w.params).map((r) => r.id);
  };
  assert.deepEqual(ranges(f.principal('iA')), [f.s1]);
  assert.deepEqual(ranges(f.admin), [f.s1, f.s2]);
  assert.deepEqual(ranges(f.student(f.teamA)), []);
});

test('an instructor principal without an account id has no scope at all', () => {
  const ghost = { id: -1, accountId: null, role: 'instructor', teamId: null, username: 'ghost' };
  assert.equal(scope.pairInScope(ghost, f.teamA, f.s1), false);
  assert.equal(scope.scenarioInScope(ghost, f.s1), false);
  assert.equal(scope.scopeWhere(ghost, 't.organization_id').sql, '1 = 0');
  assert.equal(scope.scenarioWhere(ghost, 'r.id').sql, '1 = 0');
  assert.equal(scope.loadScope(f.student(f.teamA)).pairs.length, 0);
  assert.equal(scope.loadScope(f.admin).all, true);
});
