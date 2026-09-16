import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { restoreDemoSnapshot } from '../dist/db/demoSnapshot.js';

const keys = ['DEMO_SNAPSHOT_PATH', 'DB_PATH', 'CREDENTIAL_MASTER_KEY'];
const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => {
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function fixture({ credentials = false, invalidForeignKey = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'demo-snapshot-test-'));
  const path = join(directory, 'source.db');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE credentials (id INTEGER PRIMARY KEY);
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE auth_tokens (token TEXT, user_id INTEGER REFERENCES users(id));
    INSERT INTO users VALUES (1, 'Original');
    INSERT INTO auth_tokens VALUES ('local-session', 1);
  `);
  if (credentials) db.exec('INSERT INTO credentials VALUES (1)');
  if (invalidForeignKey) {
    db.exec("PRAGMA foreign_keys = OFF; INSERT INTO auth_tokens VALUES ('invalid', 99)");
  }
  db.close();
  const bytes = readFileSync(path);
  const snapshot = {
    version: 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    databaseGzipBase64: gzipSync(bytes).toString('base64'),
  };
  const snapshotPath = join(directory, 'snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  process.env.DEMO_SNAPSHOT_PATH = snapshotPath;
  process.env.DB_PATH = path;
  return { path, snapshotPath, snapshot };
}

test('normal startup leaves DB_PATH alone', () => {
  delete process.env.DEMO_SNAPSHOT_PATH;
  process.env.DB_PATH = 'normal-storage.db';
  restoreDemoSnapshot();
  assert.equal(process.env.DB_PATH, 'normal-storage.db');
});

test('every startup restores original data and excludes previous sessions', () => {
  const { path, snapshotPath } = fixture();
  const originalSnapshot = readFileSync(snapshotPath);
  restoreDemoSnapshot();
  const firstPath = process.env.DB_PATH;
  assert.notEqual(firstPath, path);
  const first = new DatabaseSync(firstPath);
  assert.equal(first.prepare('SELECT COUNT(*) AS n FROM auth_tokens').get().n, 0);
  first.exec("UPDATE users SET name = 'Edited'; INSERT INTO auth_tokens VALUES ('new-session', 1)");
  first.close();
  restoreDemoSnapshot();
  assert.notEqual(process.env.DB_PATH, firstPath);
  const second = new DatabaseSync(process.env.DB_PATH);
  assert.equal(second.prepare('SELECT name FROM users').get().name, 'Original');
  assert.equal(second.prepare('SELECT COUNT(*) AS n FROM auth_tokens').get().n, 0);
  second.close();
  assert.deepEqual(readFileSync(snapshotPath), originalSnapshot);
  const source = new DatabaseSync(path, { readOnly: true });
  assert.equal(source.prepare('SELECT COUNT(*) AS n FROM auth_tokens').get().n, 1);
  source.close();
});

test('invalid checksum fails before selecting a database', () => {
  const { path, snapshot, snapshotPath } = fixture();
  writeFileSync(snapshotPath, JSON.stringify({ ...snapshot, sha256: 'invalid' }));
  assert.throws(restoreDemoSnapshot, /checksum/);
  assert.equal(process.env.DB_PATH, path);
});

test('broken foreign keys fail before removing old sessions', () => {
  const { path } = fixture({ invalidForeignKey: true });
  assert.throws(restoreDemoSnapshot, /integrity/);
  assert.equal(process.env.DB_PATH, path);
});

test('encrypted credentials require a configured key', () => {
  const { path } = fixture({ credentials: true });
  delete process.env.CREDENTIAL_MASTER_KEY;
  assert.throws(restoreDemoSnapshot, /CREDENTIAL_MASTER_KEY/);
  assert.equal(process.env.DB_PATH, path);
  process.env.CREDENTIAL_MASTER_KEY = Buffer.alloc(32).toString('base64');
  restoreDemoSnapshot();
  assert.notEqual(process.env.DB_PATH, path);
});
