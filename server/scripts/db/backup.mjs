// Online, consistent backup of a Cyber Range SQLite database (platform P5, 2026-10-18).
//
//   node scripts/db/backup.mjs --db <source.db> --out <new-backup.db>
//
// - Uses `VACUUM INTO` on a READ-ONLY connection: the source file is never modified and the app may keep
//   running (a consistent snapshot of the last committed state, WAL included).
// - Refuses to overwrite an existing file.
// - Writes <out>.manifest.json: sha256 of the backup, integrity check, row count per table, official
//   score total (SUM(scores.points)) and the schema generation — the numbers to compare after a restore
//   or a migration.
// Procedure and approvals: docs/runbooks/production-deploy-backup-and-rollback.md. Run against a real
// database only as part of an approved runbook step.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dbStats, sha256File } from './dbStats.mjs';

export function backupDatabase(source, out) {
  const src = resolve(source);
  const dst = resolve(out);
  if (!existsSync(src)) throw new Error(`source not found: ${src}`);
  if (existsSync(dst)) throw new Error(`refusing to overwrite ${dst}`);
  const db = new DatabaseSync(src, { readOnly: true });
  try {
    db.prepare('VACUUM INTO ?').run(dst);
  } finally {
    db.close();
  }
  const stats = dbStats(dst);
  const manifest = { kind: 'cyber-range-db-backup', createdAt: new Date().toISOString(), source: src, backup: dst, sha256: sha256File(dst), ...stats };
  writeFileSync(`${dst}.manifest.json`, JSON.stringify(manifest, null, 2));
  if (stats.integrity !== 'ok') throw new Error(`backup written but integrity_check reported: ${stats.integrity}`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  if (!opt('--db') || !opt('--out')) {
    console.error('usage: node scripts/db/backup.mjs --db <source.db> --out <new-backup.db>');
    process.exit(2);
  }
  const m = backupDatabase(opt('--db'), opt('--out'));
  console.log(`backup: ${m.backup} (${m.sizeBytes} bytes, sha256 ${m.sha256.slice(0, 16)}…)`);
  console.log(`integrity: ${m.integrity}; tables: ${m.tables.length}; official score total: ${m.scoresTotal}; RBAC schema: ${m.generation.rbac}; AI tables: ${m.generation.aiAssessment}`);
  console.log(`manifest: ${m.backup}.manifest.json`);
}
