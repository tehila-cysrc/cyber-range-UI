import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// Instructor-entered IP on topology nodes: set when adding a node, editable afterwards — but only on
// manually added nodes (a discovered VM's IP comes from Azure).
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'topology-node-ip-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { createApp } = await import('../dist/app.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');
const { issueTokens } = await import('./fixtures/tokens.mjs');

let server;
let base;
let f;
let t;

before(async () => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  t = issueTokens(db, f);
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
});

async function api(method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.admin}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const ipOf = (nodeId) => JSON.parse(db.prepare('SELECT metadata_json AS m FROM topology_nodes WHERE id = ?').get(nodeId).m ?? '{}').privateIpAddress;

test('a new node can be added with an IP, and the IP can be edited and cleared', async () => {
  const created = await api('POST', `/admin/cyber-ranges/${f.s1}/topology/nodes`, { label: 'DC01', nodeType: 'host', privateIpAddress: ' 10.0.1.4 ' });
  assert.equal(created.status, 201);
  const nodeId = created.body.node.id;
  assert.equal(ipOf(nodeId), '10.0.1.4');

  assert.equal((await api('PATCH', `/admin/cyber-ranges/${f.s1}/topology/nodes/${nodeId}`, { privateIpAddress: '10.0.1.5' })).status, 200);
  assert.equal(ipOf(nodeId), '10.0.1.5');

  assert.equal((await api('PATCH', `/admin/cyber-ranges/${f.s1}/topology/nodes/${nodeId}`, { privateIpAddress: 'not-an-ip' })).status, 400);
  assert.equal(ipOf(nodeId), '10.0.1.5');

  assert.equal((await api('PATCH', `/admin/cyber-ranges/${f.s1}/topology/nodes/${nodeId}`, { privateIpAddress: '' })).status, 200);
  assert.equal(ipOf(nodeId), undefined);
});

test('an invalid IP on a new node is rejected', async () => {
  const res = await api('POST', `/admin/cyber-ranges/${f.s1}/topology/nodes`, { label: 'X', nodeType: 'host', privateIpAddress: '10.0.1' });
  assert.equal(res.status, 400);
});

test("a discovered node's IP can't be edited", async () => {
  const credentialId = Number(
    db
      .prepare("INSERT INTO credentials (kind, secret_ciphertext, secret_iv, secret_auth_tag, created_at) VALUES ('service_principal', x'00', x'00', x'00', ?)")
      .run(new Date().toISOString()).lastInsertRowid,
  );
  const environmentId = Number(
    db
      .prepare(
        "INSERT INTO cloud_environments (provider, name, external_account_id, credential_id, discovery_mode, created_at) VALUES ('azure', 'env', 'sub', ?, 'on_demand', ?)",
      )
      .run(credentialId, new Date().toISOString()).lastInsertRowid,
  );
  const nodeId = Number(
    db
      .prepare(
        `INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type, metadata_json, environment_id)
         VALUES (?, 'vm-1', 'vm-1', 'vm', '{"privateIpAddress":"10.0.0.4"}', ?)`,
      )
      .run(f.s1, environmentId).lastInsertRowid,
  );
  assert.equal((await api('PATCH', `/admin/cyber-ranges/${f.s1}/topology/nodes/${nodeId}`, { privateIpAddress: '10.9.9.9' })).status, 400);
  assert.equal(ipOf(nodeId), '10.0.0.4');
});
