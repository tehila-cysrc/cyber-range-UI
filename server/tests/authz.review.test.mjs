import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// Regression tests for the security review of the RBAC work (2026-10-12): each test pins one finding.
// Same fixture as authz.http (orgs A/B, scenarios S1/S2, iA on (A,S1), iAB on (A,S1)+(B,S2)).
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-authz-review-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { createApp } = await import('../dist/app.js');
const { Server: SocketServer } = await import('socket.io');
const { setIo } = await import('../dist/sockets/io.js');
const { setupSockets } = await import('../dist/sockets/index.js');
const scope = await import('../dist/authz/scope.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');
const { issueTokens } = await import('./fixtures/tokens.mjs');

let server;
let base;
let f;
let t;
const ids = {};
const now = '2026-01-01T00:00:00.000Z';
const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid);

before(async () => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  t = issueTokens(db, f);
  const progress = (team, range, status) =>
    insert('INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status, started_at) VALUES (?, ?, ?, ?)', team, range, status, now);
  progress(f.teamA, f.s1, 'active');
  progress(f.teamA, f.s2, 'completed'); // A has work on S2, which iA does not hold
  ids.nodeS1 = insert("INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type) VALUES (?, 'vm-1', 'vm1', 'vm')", f.s1);
  ids.expS1 = insert(
    "INSERT INTO cyber_range_expected_ttps (cyber_range_id, technique_id, tactic_id, points, created_at, updated_at) VALUES (?, 'T1087', 'TA0007', 50, ?, ?)",
    f.s1,
    now,
    now,
  );
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
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
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('#1 run-script: scriptId 0 (or any falsy id) with content is still a custom script — admin only', async () => {
  for (const scriptId of [0, -1, 1.5, '1']) {
    const r = await api('POST', `/api/admin/topology/nodes/${ids.nodeS1}/run-script`, t.iA, { scriptId, content: 'whoami', scriptType: 'powershell' });
    assert.equal(r.status, 403, `scriptId ${JSON.stringify(scriptId)}`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM script_executions').get().n, 0);
});

test('#2/#5 moving or deleting a team needs every scenario it has work on, under both organizations', async () => {
  // iA also gets (B,S1): both organizations are in scope, but team A's S2 work is not.
  assert.equal((await api('PUT', `/api/admin/accounts/${f.accounts.iA}/assignments`, t.admin, {
    pairs: [{ organizationId: f.orgA, cyberRangeId: f.s1 }, { organizationId: f.orgB, cyberRangeId: f.s1 }],
  })).status, 200);
  assert.equal((await api('PATCH', `/api/admin/teams/${f.teamA}`, t.iA, { organizationId: f.orgB })).status, 403);
  assert.equal((await api('DELETE', `/api/admin/teams/${f.teamA}`, t.iA)).status, 403);
  assert.equal(db.prepare('SELECT organization_id AS o FROM teams WHERE id = ?').get(f.teamA).o, f.orgA);
  // A team whose work is all inside the caller's pairs can move.
  const fresh = insert('INSERT INTO teams (event_run_id, name, sort_order, organization_id) VALUES (?, ?, 99, ?)', getActiveEventRunId(), 'Fresh', f.orgA);
  insert("INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status, started_at) VALUES (?, ?, 'completed', ?)", fresh, f.s1, now);
  assert.equal((await api('PATCH', `/api/admin/teams/${fresh}`, t.iA, { organizationId: f.orgB })).status, 200);
});

test('#4 an instructor cannot switch away from (or complete into) another pair', async () => {
  db.prepare("UPDATE team_cyber_range_progress SET status = 'active' WHERE team_id = ? AND cyber_range_id = ?").run(f.teamA, f.s2);
  db.prepare("UPDATE team_cyber_range_progress SET status = 'paused' WHERE team_id = ? AND cyber_range_id = ?").run(f.teamA, f.s1);
  const r = await api('POST', `/api/admin/teams/${f.teamA}/cyber-ranges/${f.s1}/start`, t.iA);
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'scenario_out_of_scope');
  assert.equal(db.prepare("SELECT status FROM team_cyber_range_progress WHERE team_id = ? AND cyber_range_id = ?").get(f.teamA, f.s2).status, 'active');
  // Completing S1 (paused) leaves the live S2's open help request alone.
  const help = insert("INSERT INTO help_requests (team_id, cyber_range_id, requested_by_user_id, status, created_at) VALUES (?, ?, ?, 'open', ?)", f.teamA, f.s2, t.ids.studentA, now);
  assert.equal((await api('POST', `/api/admin/teams/${f.teamA}/cyber-ranges/${f.s1}/complete`, t.iA)).status, 200);
  assert.equal(db.prepare('SELECT status FROM help_requests WHERE id = ?').get(help).status, 'open');
});

test('#6 removing an expected technique may not void credits of teams outside the caller\'s pairs', async () => {
  // Team B (organization B) was credited on S1; iA holds (B,S1) since #2 — take it away again.
  await api('PUT', `/api/admin/accounts/${f.accounts.iA}/assignments`, t.admin, { pairs: [{ organizationId: f.orgA, cyberRangeId: f.s1 }] });
  insert(
    "INSERT INTO ttp_detections (team_id, cyber_range_id, expected_ttp_id, detected_at, points_awarded, source, status, created_at) VALUES (?, ?, ?, ?, 50, 'auto', 'credited', ?)",
    f.teamB,
    f.s1,
    ids.expS1,
    now,
    now,
  );
  const r = await api('DELETE', `/api/admin/expected-ttps/${ids.expS1}?voidDetections=true`, t.iA);
  assert.equal(r.status, 409);
  assert.equal(db.prepare('SELECT is_active AS a FROM cyber_range_expected_ttps WHERE id = ?').get(ids.expS1).a, 1);
});

test('#7 VM exclusivity covers every scenario that reaches the same machine', () => {
  db.exec('PRAGMA foreign_keys = OFF');
  const env = insert("INSERT INTO cloud_environments (provider, name, external_account_id, credential_id, created_at) VALUES ('azure', 'e', 'sub', 999, ?)", now);
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare('UPDATE topology_nodes SET environment_id = ? WHERE id = ?').run(env, ids.nodeS1);
  insert('INSERT INTO cyber_range_environments (cyber_range_id, environment_id) VALUES (?, ?)', f.s1, env);
  insert('INSERT INTO cyber_range_environments (cyber_range_id, environment_id) VALUES (?, ?)', f.s2, env);
  const iA = f.principal('iA');
  db.prepare("UPDATE team_cyber_range_progress SET status = 'completed' WHERE team_id = ?").run(f.teamA);
  assert.deepEqual(scope.scenariosSharingNode(ids.nodeS1).sort(), [f.s1, f.s2].sort());
  assert.equal(scope.vmExclusiveFor(iA, ids.nodeS1), true); // nobody live on either scenario
  insert("INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status, started_at) VALUES (?, ?, 'active', ?)", f.teamB, f.s2, now);
  assert.equal(scope.vmExclusiveFor(iA, ids.nodeS1), false); // org B is live on S2, same environment
  assert.equal(scope.vmExclusiveFor(f.admin, ids.nodeS1), true);
});

test('#13 the kill switch accepts any common "off" spelling', async () => {
  for (const value of ['FALSE', '0', 'off', ' No ']) {
    process.env.ENABLE_SCOPED_INSTRUCTORS = value;
    assert.equal((await api('GET', '/api/auth/me', t.iA)).status, 401, value);
  }
  delete process.env.ENABLE_SCOPED_INSTRUCTORS;
  assert.equal((await api('GET', '/api/auth/me', t.iA)).status, 200);
});
