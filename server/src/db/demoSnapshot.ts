import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';

// Opt-in demo mode: the uploaded snapshot remains immutable. Each process gets
// its own writable copy, so a restart always returns to the same demo data.
export function restoreDemoSnapshot(): void {
  const snapshotPath = process.env.DEMO_SNAPSHOT_PATH;
  if (!snapshotPath) return;

  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  if (snapshot.version !== 1 || typeof snapshot.sha256 !== 'string' ||
      typeof snapshot.databaseGzipBase64 !== 'string') {
    throw new Error('Invalid demo snapshot format');
  }
  const database = gunzipSync(Buffer.from(snapshot.databaseGzipBase64, 'base64'), {
    maxOutputLength: 64 * 1024 * 1024,
  });
  if (createHash('sha256').update(database).digest('hex') !== snapshot.sha256 ||
      database.subarray(0, 16).toString() !== 'SQLite format 3\0') {
    throw new Error('Demo snapshot checksum or SQLite header is invalid');
  }

  const databasePath = join(mkdtempSync(join(tmpdir(), 'cyber-range-demo-')), 'demo.db');
  writeFileSync(databasePath, database, { mode: 0o600, flag: 'wx' });
  const validation = new DatabaseSync(databasePath);
  try {
    const integrity = validation.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' ||
        validation.prepare('PRAGMA foreign_key_check').all().length !== 0) {
      throw new Error('Demo snapshot database integrity check failed');
    }
    const credentials = validation.prepare('SELECT COUNT(*) AS n FROM credentials').get();
    if (Number(credentials?.n) > 0 &&
        Buffer.from(process.env.CREDENTIAL_MASTER_KEY ?? '', 'base64').length !== 32) {
      throw new Error('Demo snapshot requires CREDENTIAL_MASTER_KEY');
    }
    // Local browser sessions must not become valid sessions on the public demo.
    validation.exec('DELETE FROM auth_tokens');
  } finally {
    validation.close();
  }
  process.env.DB_PATH = databasePath;
  console.log('[demo] restored snapshot; changes reset when the server restarts');
}
