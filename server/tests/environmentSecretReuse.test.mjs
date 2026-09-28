import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'environment-secret-reuse-')), 'test.db');
process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString('base64');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const env = await import('../dist/services/environments.service.js');
const { readCredentialPlaintext } = await import('../dist/services/credential.service.js');

const input = (name, extra = {}) => ({
  provider: 'azure',
  name,
  externalAccountId: 'sub',
  externalScope: 'rg',
  tenantId: 't',
  clientId: 'c',
  clientSecret: '',
  ...extra,
});
const credentialIdOf = (id) => db.prepare('SELECT credential_id AS c FROM cloud_environments WHERE id = ?').get(id).c;

before(() => seed());

test('copying an environment reuses its secret in a separate credentials row', () => {
  const a = env.createEnvironment(input('a', { clientSecret: 'shh' }), 'instructor');
  const b = env.createEnvironment(input('b', { copySecretFromEnvironmentId: a.id }), 'instructor');
  assert.notEqual(credentialIdOf(a.id), credentialIdOf(b.id));
  assert.equal(readCredentialPlaintext(credentialIdOf(b.id)), 'shh');

  // Each environment owns its row: deleting the source leaves the copy usable.
  assert.equal(env.deleteEnvironment(a.id, 'instructor'), true);
  assert.equal(readCredentialPlaintext(credentialIdOf(b.id)), 'shh');
});

test('copying from an unknown environment stores nothing', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n;
  assert.throws(() => env.createEnvironment(input('x', { copySecretFromEnvironmentId: 99999 }), 'instructor'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, before);
});
