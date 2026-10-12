import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// Cross-tenant authorization over real HTTP (RBAC design review §6): IDOR on every kind of client id,
// the (organization × scenario) cross product, privilege escalation, shared-scenario exclusivity and
// the kill switch. Fixture: orgs A/B, scenarios S1/S2, iA on (A,S1), iAB on (A,S1)+(B,S2), a team in
// each organization plus one without; teams A and B each work on BOTH scenarios.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-authz-http-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { createApp } = await import('../dist/app.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');
const { issueTokens } = await import('./fixtures/tokens.mjs');
const { Server: SocketServer } = await import('socket.io');
const { setIo } = await import('../dist/sockets/io.js');
const { setupSockets } = await import('../dist/sockets/index.js');

let server;
let base;
let f;
let t;
const ids = {};
const now = '2026-01-01T00:00:00.000Z';

function insert(sql, ...params) {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

before(async () => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  t = issueTokens(db, f);
  const progress = (team, range, status) =>
    insert("INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status, started_at) VALUES (?, ?, ?, ?)", team, range, status, now);
  // A works S1 now (S2 earlier, completed); B works S2 now (S1 earlier, completed).
  progress(f.teamA, f.s1, 'active');
  progress(f.teamA, f.s2, 'completed');
  progress(f.teamB, f.s2, 'active');
  progress(f.teamB, f.s1, 'completed');
  const entry = (team, range, user) =>
    insert('INSERT INTO documentation_entries (team_id, cyber_range_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)', team, range, user, 'x', now);
  ids.entryA1 = entry(f.teamA, f.s1, t.ids.studentA);
  ids.entryA2 = entry(f.teamA, f.s2, t.ids.studentA);
  ids.entryB2 = entry(f.teamB, f.s2, t.ids.studentB);
  const score = (team, range, pts) =>
    insert("INSERT INTO scores (team_id, cyber_range_id, points, created_at, source) VALUES (?, ?, ?, ?, 'manual')", team, range, pts, now);
  score(f.teamA, f.s1, 10);
  score(f.teamA, f.s2, 20);
  const help = (team, range, user) =>
    insert("INSERT INTO help_requests (team_id, cyber_range_id, requested_by_user_id, status, created_at) VALUES (?, ?, ?, 'open', ?)", team, range, user, now);
  ids.helpA1 = help(f.teamA, f.s1, t.ids.studentA);
  ids.helpB2 = help(f.teamB, f.s2, t.ids.studentB);
  const node = (range, label) =>
    insert("INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type) VALUES (?, ?, ?, 'vm')", range, `${label}-key`, label);
  ids.nodeS1 = node(f.s1, 'web-s1');
  ids.nodeS2 = node(f.s2, 'web-s2');
  const expected = (range) =>
    insert(
      "INSERT INTO cyber_range_expected_ttps (cyber_range_id, technique_id, tactic_id, points, created_at, updated_at) VALUES (?, 'T1087', 'TA0007', 50, ?, ?)",
      range,
      now,
      now,
    );
  ids.expS1 = expected(f.s1);
  ids.expS2 = expected(f.s2);
  ids.script = insert(
    "INSERT INTO scripts (name, content, script_type, created_at) VALUES ('probe', 'Write-Output secret-token', 'powershell', ?)",
    now,
  );
  ids.otherStudentA = insert(
    "INSERT INTO users (event_run_id, username, password, role, team_id, display_name) VALUES (?, 'mover', 'p', 'student', ?, 'Mover')",
    getActiveEventRunId(),
    f.teamA,
  );

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  // Allowed requests emit socket events, exactly as in production.
  const io = new SocketServer(server);
  setIo(io);
  setupSockets(io);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
});

async function api(method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // empty body
  }
  return { status: res.status, body: json };
}
const status = async (...args) => (await api(...args)).status;

test('timeline/canvas/debrief: pair scope, never the organization × scenario cross product', async () => {
  for (const kind of ['documentation', 'investigation-canvas']) {
    assert.equal(await status('GET', `/api/cyber-ranges/${f.s1}/${kind}?teamId=${f.teamA}`, t.iA), 200, kind);
    assert.equal(await status('GET', `/api/cyber-ranges/${f.s1}/${kind}?teamId=${f.teamB}`, t.iA), 404, kind);
    assert.equal(await status('GET', `/api/cyber-ranges/${f.s2}/${kind}?teamId=${f.teamA}`, t.iAB), 404, kind); // A × S2
    assert.equal(await status('GET', `/api/cyber-ranges/${f.s1}/${kind}?teamId=${f.teamB}`, t.iAB), 404, kind); // B × S1
    assert.equal(await status('GET', `/api/cyber-ranges/${f.s2}/${kind}?teamId=${f.teamB}`, t.iAB), 200, kind);
    assert.equal(await status('GET', `/api/cyber-ranges/${f.s1}/${kind}?teamId=${f.teamNoOrg}`, t.iAB), 404, kind);
    assert.equal(await status('GET', `/api/cyber-ranges/${f.s1}/${kind}?teamId=${f.teamNoOrg}`, t.admin), 200, kind);
  }
  assert.equal(await status('GET', `/api/history/${f.s2}?teamId=${f.teamA}`, t.iAB), 404);
  // The team-level list only names the team's in-scope scenarios.
  const history = await api('GET', `/api/history?teamId=${f.teamA}`, t.iAB);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.scenarios.map((s) => s.cyberRangeId), []); // A's only past scenario is S2
  const adminHistory = await api('GET', `/api/history?teamId=${f.teamA}`, t.admin);
  assert.deepEqual(adminHistory.body.scenarios.map((s) => s.cyberRangeId), [f.s2]);
  // A student's ?teamId= is ignored — always their own team.
  const own = await api('GET', `/api/cyber-ranges/${f.s2}/documentation?teamId=${f.teamB}`, t.studentA);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.entries.map((e) => e.id), [ids.entryA2]);
});

test('lists and aggregates contain no row of another organization or pair', async () => {
  const teams = await api('GET', '/api/admin/teams', t.iA);
  assert.deepEqual(teams.body.teams.map((x) => x.id), [f.teamA]);
  const dash = await api('GET', '/api/admin/dashboard', t.iAB);
  const byTeam = Object.fromEntries(dash.body.teams.map((x) => [x.teamId, x]));
  assert.deepEqual(Object.keys(byTeam).map(Number).sort(), [f.teamA, f.teamB].sort((a, b) => a - b));
  assert.equal(byTeam[f.teamA].active.cyberRangeId, f.s1);
  assert.equal(byTeam[f.teamB].active.cyberRangeId, f.s2);
  const dashA = await api('GET', '/api/admin/dashboard', t.iA);
  assert.deepEqual(dashA.body.teams.map((x) => x.teamId), [f.teamA]);

  const board = await api('GET', '/api/leaderboard', t.iA);
  assert.deepEqual(board.body.teams.map((x) => x.teamId), [f.teamA]);
  const orgs = await api('GET', '/api/admin/organizations', t.iA);
  assert.deepEqual(orgs.body.organizations.map((o) => [o.id, o.joinCode]), [[f.orgA, null]]);

  const help = await api('GET', '/api/admin/help-requests', t.iA);
  assert.deepEqual(help.body.helpRequests.map((h) => h.id), [ids.helpA1]);
  const scores = await api('GET', `/api/admin/scores?teamId=${f.teamA}`, t.iAB);
  assert.deepEqual(scores.body.entries.map((s) => s.cyberRangeId), [f.s1]); // the S2 award is hidden
  const ranges = await api('GET', '/api/cyber-ranges', t.iA);
  assert.deepEqual(ranges.body.cyberRanges.map((r) => r.id), [f.s1]);
  const report = await api('GET', `/api/admin/cyber-ranges/${f.s1}/ttp-report`, t.iAB);
  assert.deepEqual(report.body.teams.map((r) => r.teamId), [f.teamA]);
  assert.equal(await status('GET', `/api/admin/cyber-ranges/${f.s2}/ttp-report?teamId=${f.teamA}`, t.iAB), 404);
  assert.equal(await status('GET', `/api/admin/cyber-ranges/${f.s2}/expected-ttps`, t.iA), 404);
});

test('ids in the body or of child rows are checked on the row, not trusted', async () => {
  // Body ids
  assert.equal(await status('POST', '/api/admin/users', t.iA, { username: 'x1', password: 'longpass1', teamId: f.teamB }), 404);
  assert.equal(await status('POST', '/api/admin/scores', t.iA, { teamId: f.teamB, points: 5 }), 404);
  assert.equal(await status('POST', '/api/admin/scores', t.iAB, { teamId: f.teamA, points: 5, documentationEntryId: ids.entryA2 }), 404);
  assert.equal(await status('POST', '/api/admin/ttp-detections', t.iAB, { teamId: f.teamA, expectedTtpId: ids.expS2, documentationEntryId: ids.entryA2 }), 404);
  // Child ids under an in-scope URL scenario
  assert.equal(await status('PATCH', `/api/admin/cyber-ranges/${f.s1}/topology/nodes/${ids.nodeS2}`, t.iA, { label: 'pwn' }), 404);
  assert.equal(await status('POST', `/api/admin/cyber-ranges/${f.s1}/topology/edges`, t.iA, { fromNodeId: ids.nodeS1, toNodeId: ids.nodeS2 }), 400);
  assert.equal(await status('PATCH', `/api/admin/expected-ttps/${ids.expS2}`, t.iA, { points: 1 }), 404);
  assert.equal(await status('POST', `/api/cyber-ranges/${f.s2}/documentation/${ids.entryB2}/feedback`, t.iA, { verdict: 'on_track' }), 404);
  assert.equal(await status('POST', `/api/admin/help-requests/${ids.helpB2}/resolve`, t.iA), 404);
  assert.equal(await status('GET', `/api/admin/topology/nodes/${ids.nodeS2}/access-target`, t.iA), 404);
  // Unchanged after all of the above
  assert.equal(db.prepare('SELECT label FROM topology_nodes WHERE id = ?').get(ids.nodeS2).label, 'web-s2');
  assert.equal(db.prepare('SELECT status FROM help_requests WHERE id = ?').get(ids.helpB2).status, 'open');
});

test('moving a team or student needs both ends in scope; assigning a scenario needs the pair', async () => {
  assert.equal(await status('PATCH', `/api/admin/teams/${f.teamB}`, t.iA, { organizationId: f.orgA }), 404); // steal B
  assert.equal(await status('PATCH', `/api/admin/teams/${f.teamA}`, t.iA, { organizationId: f.orgB }), 404); // push out
  assert.equal(await status('PATCH', `/api/admin/teams/${f.teamA}`, t.iA, { organizationId: null }), 403);
  assert.equal(await status('PATCH', `/api/admin/users/${ids.otherStudentA}`, t.iA, { teamId: f.teamB }), 404);
  assert.equal(await status('POST', `/api/admin/teams/${f.teamA}/cyber-ranges/${f.s2}/start`, t.iAB), 404); // PE-6
  assert.equal(await status('POST', '/api/admin/teams', t.iA, { name: 'no-org' }), 400);
  assert.equal(await status('POST', '/api/admin/teams', t.iA, { name: 'b-team', organizationId: f.orgB }), 404);
  const created = await api('POST', '/api/admin/teams', t.iA, { name: 'a-team', organizationId: f.orgA });
  assert.equal(created.status, 201);
  assert.equal(db.prepare('SELECT organization_id AS o FROM teams WHERE id = ?').get(f.teamB).o, f.orgB);
});

test('privilege escalation attempts fail', async () => {
  assert.equal(await status('POST', '/api/admin/users', t.iA, { username: 'boss', password: 'longpass1', role: 'admin', teamId: f.teamA }), 400);
  assert.equal(await status('POST', '/api/admin/accounts', t.iA, { username: 'boss', password: 'longpass1', role: 'admin' }), 403);
  assert.equal(await status('PUT', `/api/admin/accounts/${f.accounts.iA}/assignments`, t.iA, { pairs: [{ organizationId: f.orgB, cyberRangeId: f.s2 }] }), 403);
  assert.equal(await status('PATCH', `/api/admin/accounts/${f.admin.accountId}`, t.iA, { disabled: true }), 403);
  assert.equal(await status('DELETE', `/api/admin/users/${t.ids.admin}`, t.iA), 404); // a staff row is not a student
  // PATCH /auth/me never touches the role.
  const me = await api('PATCH', '/api/auth/me', t.iA, { currentPassword: 'pass12345', role: 'admin', displayName: 'iA2' });
  assert.equal(me.status, 200);
  assert.equal(db.prepare('SELECT role FROM accounts WHERE id = ?').get(f.accounts.iA).role, 'instructor');
  // Admins can't demote or disable themselves.
  assert.equal(await status('PATCH', `/api/admin/accounts/${f.admin.accountId}`, t.admin, { role: 'instructor' }), 400);
  // Script content stays admin-only.
  const script = await api('GET', `/api/admin/scripts/${ids.script}`, t.iA);
  assert.equal(script.status, 200);
  assert.equal(script.body.script.content, undefined);
});

test('shared scenario: VM actions and occurrences need every team on it in scope; ad-hoc scripts are admin-only', async () => {
  // Team B is still on S1? Make it so (paused counts too).
  db.prepare("UPDATE team_cyber_range_progress SET status = 'paused' WHERE team_id = ? AND cyber_range_id = ?").run(f.teamB, f.s1);
  const shared = await api('POST', `/api/admin/topology/nodes/${ids.nodeS1}/power`, t.iA, { action: 'start' });
  assert.equal(shared.status, 409);
  assert.equal(shared.body.reason, 'scenario_shared');
  assert.equal(await status('POST', `/api/admin/expected-ttps/${ids.expS1}/occurrences`, t.iA, {}), 409);
  db.prepare("UPDATE team_cyber_range_progress SET status = 'completed' WHERE team_id = ? AND cyber_range_id = ?").run(f.teamB, f.s1);
  const adhoc = await api('POST', `/api/admin/topology/nodes/${ids.nodeS1}/run-script`, t.iA, { content: 'whoami', scriptType: 'powershell' });
  assert.equal(adhoc.status, 403);
  assert.equal(await status('POST', `/api/admin/expected-ttps/${ids.expS1}/occurrences`, t.iA, {}), 201);
  assert.equal(await status('POST', `/api/admin/topology/nodes/${ids.nodeS2}/power`, t.iA, { action: 'start' }), 404);
});

test('audit trail: an instructor reads only rows of their pairs; admin-only rows stay hidden', async () => {
  db.exec('DELETE FROM audit_log');
  const add = (action, org, range) =>
    insert('INSERT INTO audit_log (actor_username, action, entity_type, created_at, organization_id, cyber_range_id) VALUES (?, ?, ?, ?, ?, ?)', 'x', action, 'x', now, org, range);
  add('pair.A.S1', f.orgA, f.s1);
  add('pair.A.S2', f.orgA, f.s2);
  add('org.A', f.orgA, null);
  add('org.B', f.orgB, null);
  add('scenario.S1', null, f.s1);
  add('system', null, null);
  const rows = await api('GET', '/api/admin/audit-log', t.iA);
  assert.deepEqual(rows.body.entries.map((e) => e.action).sort(), ['org.A', 'pair.A.S1', 'scenario.S1']);
  const all = await api('GET', '/api/admin/audit-log', t.admin);
  assert.equal(all.body.entries.length, 6);
});

test('removing an assignment or disabling the account takes effect on the next request', async () => {
  assert.equal(await status('GET', `/api/cyber-ranges/${f.s2}/documentation?teamId=${f.teamB}`, t.iAB), 200);
  const put = await api('PUT', `/api/admin/accounts/${f.accounts.iAB}/assignments`, t.admin, {
    pairs: [{ organizationId: f.orgA, cyberRangeId: f.s1 }],
  });
  assert.equal(put.status, 200);
  assert.equal(await status('GET', `/api/cyber-ranges/${f.s2}/documentation?teamId=${f.teamB}`, t.iAB), 404);
  assert.equal(await status('PATCH', `/api/admin/accounts/${f.accounts.iAB}`, t.admin, { disabled: true }), 200);
  assert.equal(await status('GET', '/api/auth/me', t.iAB), 401);
});

test('kill switch: ENABLE_SCOPED_INSTRUCTORS=false refuses instructors only (fail-closed)', async () => {
  process.env.ENABLE_SCOPED_INSTRUCTORS = 'false';
  try {
    assert.equal(await status('GET', '/api/auth/me', t.iA), 401);
    assert.equal(await status('GET', '/api/auth/me', t.admin), 200);
    assert.equal(await status('GET', '/api/auth/me', t.studentA), 200);
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'iA', password: 'pass12345' }),
    });
    assert.equal(login.status, 401);
  } finally {
    delete process.env.ENABLE_SCOPED_INSTRUCTORS;
  }
  assert.equal(await status('GET', '/api/auth/me', t.iA), 200);
});
