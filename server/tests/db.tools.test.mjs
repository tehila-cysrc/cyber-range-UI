import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Platform P5 (2026-10-18): backup and migration-check tooling, exercised ONLY on temporary databases.
const dir = mkdtempSync(join(tmpdir(), 'cyber-range-db-tools-'));
process.env.DB_PATH = join(dir, 'source.db');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { db } = await import('../dist/db/index.js');
const { backupDatabase } = await import('../scripts/db/backup.mjs');
const { migrationCheck } = await import('../scripts/db/migration-check.mjs');
const { dbStats, sha256File } = await import('../scripts/db/dbStats.mjs');

seed();
const run = getActiveEventRunId();
const team = db.prepare('SELECT id FROM teams WHERE event_run_id = ? LIMIT 1').get(run).id;
db.prepare("INSERT INTO scores (team_id, points, note, created_at, source) VALUES (?, 25, 'official', ?, 'manual')").run(team, new Date().toISOString());
db.prepare("INSERT INTO scores (team_id, points, note, created_at, source) VALUES (?, 17, 'official', ?, 'manual')").run(team, new Date().toISOString());

test('backup: consistent copy, source untouched, manifest with integrity, row counts and score total; never overwrites', () => {
  const before = sha256File(process.env.DB_PATH);
  const out = join(dir, 'backup-1.db');
  const m = backupDatabase(process.env.DB_PATH, out);
  assert.equal(m.integrity, 'ok');
  assert.equal(m.scoresTotal, 42);
  assert.equal(m.generation.rbac, true);
  assert.equal(m.generation.aiAssessment, true);
  assert.equal(m.rows.scores, 2);
  assert.ok(existsSync(`${out}.manifest.json`));
  assert.equal(JSON.parse(readFileSync(`${out}.manifest.json`, 'utf8')).sha256, sha256File(out));
  assert.equal(sha256File(process.env.DB_PATH), before, 'source unchanged');
  assert.throws(() => backupDatabase(process.env.DB_PATH, out), /refusing to overwrite/);
});

test('migration check on a current-schema copy: passes, input unchanged, scores unchanged, nothing created', () => {
  const r = migrationCheck(join(dir, 'backup-1.db'), join(dir, 'work-1'));
  assert.equal(r.passed, true, JSON.stringify(r.findings));
  assert.equal(r.inputUnchanged, true);
  assert.equal(r.after.scoresTotal, 42);
  assert.ok(!r.findings.some((f) => f.level === 'WARN'), JSON.stringify(r.findings));
  assert.ok(existsSync(join(dir, 'work-1', 'migration-check.md')));
});

test('migration check flags a first start that would create an admin with the dev password and a demo run', () => {
  const copy = join(dir, 'no-admin.db');
  backupDatabase(process.env.DB_PATH, copy);
  const c = new DatabaseSync(copy);
  c.exec("UPDATE accounts SET role = 'instructor' WHERE role = 'admin'; UPDATE event_runs SET is_active = 0;");
  c.close();
  const r = migrationCheck(copy, join(dir, 'work-2'));
  assert.equal(r.passed, true, JSON.stringify(r.findings)); // warnings, not failures
  assert.ok(r.findings.some((f) => f.level === 'WARN' && /DOCUMENTED DEV PASSWORD/.test(f.text)));
  assert.ok(r.findings.some((f) => f.level === 'WARN' && /demo event run/.test(f.text)));
  const r2 = migrationCheck(copy, join(dir, 'work-3'), { initialAdminPasswordSet: true });
  assert.ok(r2.findings.some((f) => f.level === 'WARN' && /INITIAL_ADMIN_PASSWORD/.test(f.text) && !/DEV PASSWORD/.test(f.text)));
});

test('migration check refuses a non-empty work dir and never accepts the real dev database', () => {
  assert.throws(() => migrationCheck(join(dir, 'backup-1.db'), join(dir, 'work-1')), /empty directory/);
  const real = join(process.cwd(), 'data', 'cyber-range.db');
  assert.throws(() => migrationCheck(real, join(dir, 'work-real')), /refusing the real development database|input not found/);
  assert.equal(dbStats(join(dir, 'backup-1.db')).integrity, 'ok');
});

test('the real-dev-DB guard also catches another spelling of the same path', async () => {
  const { isRealDevDb } = await import('../scripts/db/dbStats.mjs');
  const repo = join(process.cwd(), '..');
  const real = join(repo, 'server', 'data', 'cyber-range.db');
  assert.equal(isRealDevDb(real, repo), true);
  assert.equal(isRealDevDb(join(repo, 'server', 'data', '..', 'data', 'cyber-range.db'), repo), true);
  if (process.platform === 'win32') assert.equal(isRealDevDb(real.toUpperCase(), repo), true);
  assert.equal(isRealDevDb(join(dir, 'backup-1.db'), repo), false);
});
