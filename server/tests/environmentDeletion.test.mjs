import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'environment-deletion-')), 'test.db');
process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString('base64');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const envService = await import('../dist/services/environments.service.js');
const { storeCredential, readCredentialPlaintext } = await import('../dist/services/credential.service.js');
const { insertCyberRange } = await import('../dist/services/cyberRangeCatalog.service.js');
const { publishTopology, getPublishedTopology } = await import('../dist/services/topologyPublication.service.js');

const now = () => new Date().toISOString();
const count = (sql, ...params) => db.prepare(sql).get(...params).n;
const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid);

let alice;
let team;
let eventRun;
let dayId;

before(() => {
  seed();
  alice = db.prepare("SELECT id, team_id AS teamId FROM users WHERE username = 'alice'").get();
  team = alice.teamId;
  eventRun = db.prepare('SELECT id FROM event_runs ORDER BY id DESC LIMIT 1').get().id;
  dayId = db.prepare('SELECT id FROM days ORDER BY id LIMIT 1').get().id;
});

// A discovered environment with everything that can hang off its hosts: zone, two VMs, an edge, a
// saved VM login (local credential + Key Vault secret name), access-session and script history, an
// MTTD occurrence recorded by that script run, an expected technique pinned to a host, and a link to
// every given cyber range.
function buildEnvironment(name, cyberRangeIds) {
  const env = envService.createEnvironment(
    { provider: 'azure', name, externalAccountId: 'sub', externalScope: 'rg', tenantId: 't', clientId: 'c', clientSecret: `${name}-secret` },
    'instructor',
  );
  for (const rangeId of cyberRangeIds) envService.linkEnvironmentToCyberRange(rangeId, env.id, 'instructor');
  const rangeId = cyberRangeIds[0];
  const runId = insert(
    "INSERT INTO environment_discovery_runs (environment_id, status, started_at, finished_at) VALUES (?, 'succeeded', ?, ?)",
    env.id,
    now(),
    now(),
  );
  const zoneId = insert(
    'INSERT INTO topology_zones (cyber_range_id, external_key, name, environment_id, discovery_run_id) VALUES (?, ?, ?, ?, ?)',
    rangeId,
    `${name}/subnet`,
    `${name} subnet`,
    env.id,
    runId,
  );
  const node = (label) =>
    insert(
      `INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type, environment_id, discovery_run_id, zone_id)
       VALUES (?, ?, ?, 'vm', ?, ?, ?)`,
      rangeId,
      `${name}/${label}`,
      label,
      env.id,
      runId,
      zoneId,
    );
  const vm1 = node(`${name}-vm1`);
  const vm2 = node(`${name}-vm2`);
  insert(
    'INSERT INTO topology_edges (cyber_range_id, from_node_id, to_node_id, environment_id, discovery_run_id) VALUES (?, ?, ?, ?, ?)',
    rangeId,
    vm1,
    vm2,
    env.id,
    runId,
  );
  const vmCredentialId = storeCredential('vm_login', `${name}-vm-pass`, null, 'instructor');
  insert(
    "INSERT INTO access_targets (topology_node_id, protocol, host, port, credential_id, key_vault_secret_name) VALUES (?, 'rdp', '10.0.0.4', 3389, ?, ?)",
    vm1,
    vmCredentialId,
    `vm-login-node-${vm1}`,
  );
  insert(
    `INSERT INTO access_sessions (team_id, user_id, cyber_range_id, topology_node_id, protocol, requested_at, ended_at, expires_at, outcome)
     VALUES (?, ?, ?, ?, 'rdp', ?, ?, ?, 'completed')`,
    team,
    alice.id,
    rangeId,
    vm1,
    now(),
    now(),
    now(),
  );
  const executionId = insert(
    "INSERT INTO script_executions (topology_node_id, script_type, script_hash, actor_user_id, status, started_at) VALUES (?, 'bash', 'h', ?, 'succeeded', ?)",
    vm1,
    alice.id,
    now(),
  );
  const expectedTtpId = insert(
    `INSERT INTO cyber_range_expected_ttps (cyber_range_id, technique_id, tactic_id, points, topology_node_id, created_at, updated_at)
     VALUES (?, ?, 'TA0001', 10, ?, ?, ?)`,
    rangeId,
    `T${1000 + vm1}`,
    vm1,
    now(),
    now(),
  );
  insert(
    `INSERT INTO ttp_occurrences (event_run_id, cyber_range_id, expected_ttp_id, occurred_at, source, script_execution_id, created_at)
     VALUES (?, ?, ?, ?, 'script_execution', ?, ?)`,
    eventRun,
    rangeId,
    expectedTtpId,
    now(),
    executionId,
    now(),
  );
  return { envId: env.id, credentialId: db.prepare('SELECT credential_id AS c FROM cloud_environments WHERE id = ?').get(env.id).c, vmCredentialId, runId, zoneId, vm1, vm2, expectedTtpId };
}

// Everything another environment owns, so "B is untouched" is checked row for row.
function snapshotOf(e) {
  const nodes = [e.vm1, e.vm2];
  return {
    env: count('SELECT COUNT(*) AS n FROM cloud_environments WHERE id = ?', e.envId),
    links: count('SELECT COUNT(*) AS n FROM cyber_range_environments WHERE environment_id = ?', e.envId),
    runs: count('SELECT COUNT(*) AS n FROM environment_discovery_runs WHERE environment_id = ?', e.envId),
    zones: count('SELECT COUNT(*) AS n FROM topology_zones WHERE environment_id = ?', e.envId),
    nodes: count('SELECT COUNT(*) AS n FROM topology_nodes WHERE environment_id = ?', e.envId),
    edges: count('SELECT COUNT(*) AS n FROM topology_edges WHERE environment_id = ?', e.envId),
    targets: count('SELECT COUNT(*) AS n FROM access_targets WHERE topology_node_id IN (?, ?)', ...nodes),
    sessions: count('SELECT COUNT(*) AS n FROM access_sessions WHERE topology_node_id IN (?, ?)', ...nodes),
    scripts: count('SELECT COUNT(*) AS n FROM script_executions WHERE topology_node_id IN (?, ?)', ...nodes),
    occurrences: count(
      'SELECT COUNT(*) AS n FROM ttp_occurrences WHERE script_execution_id IN (SELECT id FROM script_executions WHERE topology_node_id IN (?, ?))',
      ...nodes,
    ),
    ttpHost: db.prepare('SELECT topology_node_id AS n FROM cyber_range_expected_ttps WHERE id = ?').get(e.expectedTtpId).n,
  };
}

const globalCounts = () => ({
  users: count('SELECT COUNT(*) AS n FROM users'),
  teams: count('SELECT COUNT(*) AS n FROM teams'),
  accounts: count('SELECT COUNT(*) AS n FROM accounts'),
  eventRuns: count('SELECT COUNT(*) AS n FROM event_runs'),
  cyberRanges: count('SELECT COUNT(*) AS n FROM cyber_ranges'),
});

test('deleting an environment removes its hosts and their history, and nothing of another environment', () => {
  const shared = insertCyberRange({ dayId, name: 'Shared range', difficulty: 'intermediate' });
  const onlyA = insertCyberRange({ dayId, name: 'A-only range', difficulty: 'intermediate' });
  const a = buildEnvironment('alpha', [shared, onlyA]);
  const b = buildEnvironment('bravo', [shared]);

  // Instructor-drawn content that touches A's hosts/zone but belongs to no environment.
  const handNode = insert(
    "INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type, zone_id) VALUES (?, 'manual/fw', 'Firewall', 'firewall', ?)",
    shared,
    a.zoneId,
  );
  insert('INSERT INTO topology_edges (cyber_range_id, from_node_id, to_node_id) VALUES (?, ?, ?)', shared, handNode, a.vm1);
  insert('INSERT INTO topology_edges (cyber_range_id, from_node_id, to_node_id) VALUES (?, ?, ?)', shared, handNode, b.vm1);
  // A manual MTTD occurrence (not script-backed) on the shared range — event data that must survive.
  const manualOccurrence = insert(
    `INSERT INTO ttp_occurrences (event_run_id, cyber_range_id, expected_ttp_id, occurred_at, source, created_at)
     VALUES (?, ?, ?, ?, 'manual', ?)`,
    eventRun,
    shared,
    b.expectedTtpId,
    now(),
    now(),
  );
  publishTopology(shared, 'instructor');

  const bBefore = snapshotOf(b);
  const globalBefore = globalCounts();

  const preview = envService.previewEnvironmentDeletion(a.envId);
  assert.deepEqual(
    { ...preview, linkedCyberRanges: undefined },
    {
      hosts: 2,
      zones: 1,
      edges: 2, // its discovered edge + the instructor-drawn edge to vm1
      discoveryRuns: 1,
      accessTargets: 1,
      accessSessions: 1,
      scriptExecutions: 1,
      ttpOccurrences: 1,
      expectedTtpsUnlinked: 1,
      publishedSnapshots: 1,
      linkedCyberRanges: undefined,
      keyVaultSecretsLeftInAzure: [`vm-login-node-${a.vm1}`],
      blockers: { activeAccessSessions: 0, runningScripts: 0, activeDiscoveryRuns: 0 },
    },
  );
  assert.deepEqual(
    preview.linkedCyberRanges.map((r) => [r.id, r.deactivated]).sort(),
    [
      [shared, false],
      [onlyA, true],
    ].sort(),
  );

  const result = envService.deleteEnvironment(a.envId, 'instructor');
  assert.equal(result.status, 'deleted');

  // A is gone entirely.
  assert.deepEqual(snapshotOf(a), {
    env: 0,
    links: 0,
    runs: 0,
    zones: 0,
    nodes: 0,
    edges: 0,
    targets: 0,
    sessions: 0,
    scripts: 0,
    occurrences: 0,
    ttpHost: null, // expected technique kept, host link cleared
  });
  assert.equal(count('SELECT COUNT(*) AS n FROM cyber_range_expected_ttps WHERE id = ?', a.expectedTtpId), 1);
  for (const id of [a.credentialId, a.vmCredentialId]) assert.equal(count('SELECT COUNT(*) AS n FROM credentials WHERE id = ?', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM topology_edges WHERE from_node_id = ? AND to_node_id = ?', handNode, a.vm1), 0);

  // B, accounts/users/teams and event data are untouched.
  assert.deepEqual(snapshotOf(b), bBefore);
  assert.equal(readCredentialPlaintext(b.credentialId), 'bravo-secret');
  assert.equal(readCredentialPlaintext(b.vmCredentialId), 'bravo-vm-pass');
  assert.deepEqual(globalCounts(), globalBefore);
  assert.equal(count('SELECT COUNT(*) AS n FROM ttp_occurrences WHERE id = ?', manualOccurrence), 1);

  // The hand-added node stays (unzoned) with its edge to B.
  assert.equal(db.prepare('SELECT zone_id AS z FROM topology_nodes WHERE id = ?').get(handNode).z, null);
  assert.equal(count('SELECT COUNT(*) AS n FROM topology_edges WHERE from_node_id = ? AND to_node_id = ?', handNode, b.vm1), 1);

  // Students' published view loses A's hosts/zone/edges but keeps B's.
  const published = getPublishedTopology(shared);
  const publishedIds = published.nodes.map((n) => n.id);
  assert.ok(!publishedIds.includes(a.vm1) && !publishedIds.includes(a.vm2));
  assert.ok(publishedIds.includes(b.vm1) && publishedIds.includes(b.vm2) && publishedIds.includes(handNode));
  assert.ok(!published.zones.some((z) => z.id === a.zoneId));
  assert.ok(!published.edges.some((e) => [a.vm1, a.vm2].includes(e.fromNodeId) || [a.vm1, a.vm2].includes(e.toNodeId)));

  // The range only A served is hidden, the shared one stays active.
  assert.equal(db.prepare('SELECT is_active AS a FROM cyber_ranges WHERE id = ?').get(onlyA).a, 0);
  assert.equal(db.prepare('SELECT is_active AS a FROM cyber_ranges WHERE id = ?').get(shared).a, 1);

  const audit = db
    .prepare("SELECT metadata_json AS m FROM audit_log WHERE action = 'environment.deleted' AND entity_id = ? ORDER BY id DESC LIMIT 1")
    .get(a.envId);
  const meta = JSON.parse(audit.m);
  assert.equal(meta.name, 'alpha');
  assert.equal(meta.accessSessions, 1);
  assert.equal(meta.scriptExecutions, 1);
});

test('a live session, running script or running discovery blocks the delete and nothing is removed', () => {
  const range = insertCyberRange({ dayId, name: 'Busy range', difficulty: 'intermediate' });
  const c = buildEnvironment('charlie', [range]);
  const expectBusy = (blocker) => {
    const before = snapshotOf(c);
    const result = envService.deleteEnvironment(c.envId, 'instructor');
    assert.equal(result.status, 'busy');
    assert.equal(result.blockers[blocker], 1);
    assert.deepEqual(snapshotOf(c), before);
  };

  const sessionId = insert(
    `INSERT INTO access_sessions (team_id, user_id, cyber_range_id, topology_node_id, protocol, requested_at, expires_at, outcome)
     VALUES (?, ?, ?, ?, 'rdp', ?, ?, 'active')`,
    team,
    alice.id,
    range,
    c.vm2,
    now(),
    now(),
  );
  expectBusy('activeAccessSessions');
  db.prepare("UPDATE access_sessions SET outcome = 'completed' WHERE id = ?").run(sessionId);

  const execId = insert(
    "INSERT INTO script_executions (topology_node_id, script_type, script_hash, actor_user_id, status, started_at) VALUES (?, 'bash', 'h', ?, 'running', ?)",
    c.vm2,
    alice.id,
    now(),
  );
  expectBusy('runningScripts');
  db.prepare("UPDATE script_executions SET status = 'failed' WHERE id = ?").run(execId);

  const runId = insert("INSERT INTO environment_discovery_runs (environment_id, status, started_at) VALUES (?, 'running', ?)", c.envId, now());
  expectBusy('activeDiscoveryRuns');
  db.prepare("UPDATE environment_discovery_runs SET status = 'failed' WHERE id = ?").run(runId);

  assert.equal(envService.deleteEnvironment(c.envId, 'instructor').status, 'deleted');
  assert.equal(snapshotOf(c).env, 0);
});

test('an unknown environment is not found and deletes nothing', () => {
  assert.equal(envService.previewEnvironmentDeletion(999999), null);
  assert.deepEqual(envService.deleteEnvironment(999999, 'instructor'), { status: 'not_found' });
});
