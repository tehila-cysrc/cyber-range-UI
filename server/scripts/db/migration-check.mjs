// Migration dry run on a COPY of a database (platform P5, 2026-10-18).
//
//   node scripts/db/migration-check.mjs --db <backup-or-copy.db> --work <empty dir> [--initial-admin-password-set]
//
// Never touches the input: it copies it (VACUUM INTO) into --work and runs the app's real startup
// sequence on that copy in a child process — exactly what a container start does: seed() (migrate +
// reference data + initial admin + demo run when none is active), importScriptLibraryIfEmpty(),
// recoverInterruptedAiWork(). Needs `npm run build -w server` first.
//
// Checks (exit 1 on any FAIL):
//   FAIL  integrity_check not ok, or new foreign-key violations
//   FAIL  a table that existed is gone, or any pre-existing table lost rows
//   FAIL  the official score total SUM(scores.points) changed
//   WARN  an admin account was created (on a real server this uses INITIAL_ADMIN_PASSWORD, or the
//         documented dev password if that is unset — set it before deploying)
//   WARN  a demo event run with demo students was created (the copy had no active run)
//   INFO  tables added (e.g. RBAC / AI tables) and row increases (reference data)
// Writes migration-check.json and migration-check.md into --work.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { REAL_DEV_DB, dbStats, sha256File } from './dbStats.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');

const STARTUP = `
const dist = (p) => import(${JSON.stringify(pathToFileURL(join(repo, 'server', 'dist')).href)} + '/' + p);
const { seed } = await dist('db/seed.js');
const { importScriptLibraryIfEmpty } = await dist('db/importScriptLibrary.js');
const { recoverInterruptedAiWork } = await dist('services/ai/scenarioAiDocuments.service.js');
seed();
try { importScriptLibraryIfEmpty(); } catch (e) { console.log('[check] importScriptLibraryIfEmpty failed: ' + (e && e.message)); }
console.log('[check] recovered ' + JSON.stringify(recoverInterruptedAiWork()));
`;

export function migrationCheck(input, workDir, { initialAdminPasswordSet = false } = {}) {
  const src = resolve(input);
  const work = resolve(workDir);
  if (!existsSync(src)) throw new Error(`input not found: ${src}`);
  if (src === REAL_DEV_DB(repo)) throw new Error('refusing the real development database — back it up first and check the backup');
  mkdirSync(work, { recursive: true });
  if (readdirSync(work).length) throw new Error(`--work must be an empty directory: ${work}`);
  const copy = join(work, 'check.db');
  const inputSha = sha256File(src);
  const s = new DatabaseSync(src, { readOnly: true });
  try {
    s.prepare('VACUUM INTO ?').run(copy);
  } finally {
    s.close();
  }
  const before = dbStats(copy);

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', STARTUP], {
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      DB_PATH: copy,
      // Never inherit real secrets or AI settings: AI stays off, no credentials, placeholder admin password.
      INITIAL_ADMIN_PASSWORD: initialAdminPasswordSet ? 'migration-check-placeholder' : '',
      AI_ASSESSMENT_ENABLED: 'false',
      NODE_NO_WARNINGS: '1',
    },
    cwd: join(repo, 'server'),
    encoding: 'utf8',
    timeout: 120_000,
  });
  const after = existsSync(copy) ? dbStats(copy) : null;
  const findings = [];
  const add = (level, text) => findings.push({ level, text });
  if (child.status !== 0) add('FAIL', `startup sequence failed (exit ${child.status}): ${(child.stderr || '').split('\n').slice(-5).join(' ')}`);
  if (after) {
    if (after.integrity !== 'ok') add('FAIL', `integrity_check: ${after.integrity}`);
    if (after.foreignKeyViolations > before.foreignKeyViolations) add('FAIL', `foreign-key violations rose from ${before.foreignKeyViolations} to ${after.foreignKeyViolations}`);
    for (const t of before.tables) {
      if (!after.tables.includes(t)) add('FAIL', `table ${t} disappeared`);
      else if (after.rows[t] < before.rows[t]) add('FAIL', `table ${t} lost rows: ${before.rows[t]} -> ${after.rows[t]}`);
      else if (after.rows[t] > before.rows[t]) add('INFO', `table ${t}: ${before.rows[t]} -> ${after.rows[t]} rows`);
    }
    const added = after.tables.filter((t) => !before.tables.includes(t));
    if (added.length) add('INFO', `tables added: ${added.join(', ')}`);
    if (before.scoresTotal !== null && after.scoresTotal !== before.scoresTotal) add('FAIL', `official score total changed: ${before.scoresTotal} -> ${after.scoresTotal}`);
    if (after.generation.adminAccounts > before.generation.adminAccounts) {
      add('WARN', initialAdminPasswordSet
        ? 'an admin account was created with INITIAL_ADMIN_PASSWORD (set it in the server environment before deploying)'
        : 'an admin account was created with the DOCUMENTED DEV PASSWORD — set INITIAL_ADMIN_PASSWORD in the server environment before deploying');
    }
    if (after.generation.activeEventRuns > before.generation.activeEventRuns) add('WARN', 'a demo event run with demo teams and student logins was created (the database had no active event run)');
  } else add('FAIL', 'the working copy disappeared');
  const result = {
    kind: 'cyber-range-migration-check',
    at: new Date().toISOString(),
    input: src,
    inputSha256: inputSha,
    inputUnchanged: sha256File(src) === inputSha,
    passed: !findings.some((f) => f.level === 'FAIL'),
    findings,
    before,
    after,
    startupLog: (child.stdout || '').split('\n').filter(Boolean).slice(-20),
  };
  if (!result.inputUnchanged) {
    result.passed = false;
    result.findings.push({ level: 'FAIL', text: 'the input file changed during the check' });
  }
  writeFileSync(join(work, 'migration-check.json'), JSON.stringify(result, null, 2));
  const md = [
    `# Migration check — ${result.passed ? 'PASSED' : 'FAILED'}`,
    '',
    `Input: \`${src}\` (sha256 ${inputSha.slice(0, 16)}…, unchanged: ${result.inputUnchanged})`,
    `Before: RBAC schema ${before.generation.rbac}, AI tables ${before.generation.aiAssessment}, official score total ${before.scoresTotal}`,
    after ? `After: RBAC schema ${after.generation.rbac}, AI tables ${after.generation.aiAssessment}, official score total ${after.scoresTotal}, integrity ${after.integrity}` : '',
    '',
    '| Level | Finding |',
    '|---|---|',
    ...findings.map((f) => `| ${f.level} | ${f.text} |`),
    '',
  ].join('\n');
  writeFileSync(join(work, 'migration-check.md'), md);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  if (!opt('--db') || !opt('--work')) {
    console.error('usage: node scripts/db/migration-check.mjs --db <backup-or-copy.db> --work <empty dir> [--initial-admin-password-set]');
    process.exit(2);
  }
  const r = migrationCheck(opt('--db'), opt('--work'), { initialAdminPasswordSet: args.includes('--initial-admin-password-set') });
  for (const f of r.findings) console.log(`${f.level.padEnd(4)} ${f.text}`);
  console.log(r.passed ? 'PASSED' : 'FAILED', `— report: ${join(resolve(opt('--work')), 'migration-check.md')}`);
  process.exit(r.passed ? 0 : 1);
}
