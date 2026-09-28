import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-lifecycle-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const { registerEnvironmentWithCyberRange } = await import('../dist/services/environments.service.js');
const { deleteCyberRange, insertCyberRange } = await import('../dist/services/cyberRangeCatalog.service.js');
const { masterKeyProblem } = await import('../dist/services/credential.service.js');

let dayId;
const rangeCount = () => Number(db.prepare('SELECT COUNT(*) AS n FROM cyber_ranges').get().n);
const envInput = (name) => ({
  provider: 'azure',
  name,
  externalAccountId: '00000000-0000-0000-0000-000000000000',
  externalScope: null,
  tenantId: 't',
  clientId: 'c',
  clientSecret: 's',
});
const rangeInput = (name) => ({ dayId, name, difficulty: 'intermediate' });

before(() => {
  seed();
  dayId = db.prepare("SELECT id FROM days WHERE key = 'azure'").get().id;
});

test('a failed registration leaves no orphaned Cyber Range behind', () => {
  delete process.env.CREDENTIAL_MASTER_KEY;
  assert.match(masterKeyProblem(), /CREDENTIAL_MASTER_KEY is not set/);
  const before = rangeCount();
  assert.throws(() => registerEnvironmentWithCyberRange(envInput('no-key'), rangeInput('no-key'), 'instructor'));
  assert.equal(rangeCount(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, 0);
});

test('a successful registration creates and links the range and environment together', () => {
  process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString('base64');
  assert.equal(masterKeyProblem(), null);
  const { environment, cyberRangeId } = registerEnvironmentWithCyberRange(envInput('ok'), rangeInput('ok'), 'instructor');
  const link = db
    .prepare('SELECT 1 FROM cyber_range_environments WHERE cyber_range_id = ? AND environment_id = ?')
    .get(cyberRangeId, environment.id);
  assert.ok(link);

  const blocked = deleteCyberRange(cyberRangeId, 'instructor');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 409);
  assert.match(blocked.error, /backed by the environment "ok"/);
});

test('an unused scenario is deleted with its own config rows', () => {
  const id = insertCyberRange(rangeInput('orphan'));
  db.prepare("INSERT INTO topology_zones (cyber_range_id, external_key, name, sort_order) VALUES (?, 'manual:z', 'Z', 0)").run(id);
  assert.deepEqual(deleteCyberRange(id, 'instructor'), { ok: true });
  assert.equal(db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(id), undefined);
  assert.equal(db.prepare('SELECT 1 FROM topology_zones WHERE cyber_range_id = ?').get(id), undefined);
  assert.equal(deleteCyberRange(id, 'instructor').status, 404);
});

test('a scenario assigned to a team is not deleted', () => {
  const id = insertCyberRange(rangeInput('assigned'));
  const teamId = db.prepare('SELECT id FROM teams LIMIT 1').get().id;
  db.prepare("INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status) VALUES (?, ?, 'active')").run(teamId, id);
  const result = deleteCyberRange(id, 'instructor');
  assert.equal(result.status, 409);
  assert.ok(db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(id));
});
