import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { config } from 'dotenv';

config({ path: '../.env' });
const destination = process.argv[2];
if (!destination) throw new Error('Usage: npm run snapshot-demo -- <private-output-file>');
const source = new DatabaseSync(process.env.DB_PATH ?? './data/cyber-range.db', { readOnly: true });
const snapshotPath = join(mkdtempSync(join(tmpdir(), 'cyber-range-export-')), 'snapshot.db');
try {
  await backup(source, snapshotPath);
} finally {
  source.close();
}
const snapshot = new DatabaseSync(snapshotPath);
try {
  snapshot.exec('DELETE FROM auth_tokens; VACUUM;');
  const integrity = snapshot.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' ||
      snapshot.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new Error('Source database integrity check failed');
  }
} finally {
  snapshot.close();
}
const database = readFileSync(snapshotPath);
const content = JSON.stringify({
  version: 1,
  sha256: createHash('sha256').update(database).digest('hex'),
  databaseGzipBase64: gzipSync(database).toString('base64'),
});
if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('Snapshot exceeds Render secret file limit');
writeFileSync(resolve(destination), content, { mode: 0o600, flag: 'wx' });
console.log(`Demo snapshot written (${Buffer.byteLength(content)} bytes); existing sessions excluded.`);
