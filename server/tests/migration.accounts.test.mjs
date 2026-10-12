import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-migration-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { migrate } = await import('../dist/db/migrate.js');

let runId;

// Rebuilds the pre-accounts shape: staff are users rows with role 'instructor', their own password and
// no account_id, and the accounts table is empty.
function makeLegacyDatabase() {
  db.exec('DROP TRIGGER IF EXISTS trg_users_account_insert');
  db.exec('DROP TRIGGER IF EXISTS trg_users_account_update');
  db.exec('DROP INDEX IF EXISTS idx_users_run_account');
  db.exec("UPDATE users SET account_id = NULL, password = 'legacy-pass' WHERE role = 'instructor'");
  db.prepare(
    `INSERT INTO users (event_run_id, username, password, role, team_id, display_name)
     VALUES (?, 'second', 'second-pass', 'instructor', NULL, 'Second')`,
  ).run(runId);
  db.exec('DELETE FROM instructor_assignments');
  db.exec('DELETE FROM accounts');
}

before(() => {
  seed();
  runId = getActiveEventRunId();
  // A score awarded by the instructor, to prove FKs to the staff users row survive the backfill.
  const team = db.prepare("SELECT id FROM teams WHERE name = 'Team Alpha'").get().id;
  const staffId = db.prepare("SELECT id FROM users WHERE username = 'instructor'").get().id;
  db.prepare(
    `INSERT INTO scores (team_id, points, awarded_by_user_id, created_at) VALUES (?, 5, ?, '2026-01-01')`,
  ).run(team, staffId);
  makeLegacyDatabase();
});

test('every legacy instructor becomes an admin account, keeps its users id and FKs', () => {
  const before = db.prepare("SELECT id, username FROM users WHERE role = 'instructor' ORDER BY id").all().map((r) => ({ ...r }));
  migrate();
  const accounts = db.prepare('SELECT username, password, role FROM accounts ORDER BY username').all().map((r) => ({ ...r }));
  assert.deepEqual(accounts, [
    { username: 'instructor', password: 'legacy-pass', role: 'admin' },
    { username: 'second', password: 'second-pass', role: 'admin' },
  ]);
  const after = db.prepare("SELECT id, username, password, account_id AS accountId FROM users WHERE role = 'instructor' ORDER BY id").all();
  assert.deepEqual(after.map((r) => ({ id: r.id, username: r.username })), before);
  assert.ok(after.every((r) => r.accountId !== null && r.password === ''));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scores WHERE awarded_by_user_id = ?').get(before[0].id).n, 1);
});

test('migrate() is safe to run again', () => {
  const snapshot = () => db.prepare('SELECT id, username, role FROM accounts ORDER BY id').all().map((r) => ({ ...r }));
  const first = snapshot();
  migrate();
  migrate();
  assert.deepEqual(snapshot(), first);
});

test('the guards reject a staff row without an account and a student row with one', () => {
  assert.throws(() =>
    db.prepare(
      `INSERT INTO users (event_run_id, username, password, role, team_id, display_name) VALUES (?, 'x1', '', 'instructor', NULL, 'X')`,
    ).run(runId),
  );
  const accountId = db.prepare("SELECT id FROM accounts WHERE username = 'second'").get().id;
  const team = db.prepare("SELECT id FROM teams WHERE name = 'Team Alpha'").get().id;
  assert.throws(() =>
    db.prepare(
      `INSERT INTO users (event_run_id, username, password, role, team_id, display_name, account_id) VALUES (?, 'x2', 'p', 'student', ?, 'X', ?)`,
    ).run(runId, team, accountId),
  );
  // One membership row per account per run.
  assert.throws(() =>
    db.prepare(
      `INSERT INTO users (event_run_id, username, password, role, team_id, display_name, account_id) VALUES (?, 'x3', '', 'instructor', NULL, 'X', ?)`,
    ).run(runId, accountId),
  );
});

test('assignments only attach to instructor accounts', () => {
  const org = Number(db.prepare("INSERT INTO organizations (name, created_at) VALUES ('Org', '2026-01-01')").run().lastInsertRowid);
  const day = db.prepare('SELECT id FROM days LIMIT 1').get().id;
  const range = Number(
    db.prepare("INSERT INTO cyber_ranges (day_id, name, difficulty, sort_order) VALUES (?, 'R', 'intermediate', 1)").run(day).lastInsertRowid,
  );
  const admin = db.prepare("SELECT id FROM accounts WHERE username = 'second'").get().id;
  const insert = db.prepare(
    "INSERT INTO instructor_assignments (account_id, organization_id, cyber_range_id, created_at) VALUES (?, ?, ?, '2026-01-01')",
  );
  assert.throws(() => insert.run(admin, org, range));
  const instructor = Number(
    db.prepare(
      "INSERT INTO accounts (username, password, role, display_name, created_at) VALUES ('ins', 'p', 'instructor', 'Ins', '2026-01-01')",
    ).run().lastInsertRowid,
  );
  insert.run(instructor, org, range);
  assert.throws(() => insert.run(instructor, org, range)); // one row per pair
  // Deleting the organization removes the pair (fail-closed), never the account.
  db.prepare('DELETE FROM organizations WHERE id = ?').run(org);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM instructor_assignments WHERE account_id = ?').get(instructor).n, 0);
  assert.ok(db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(instructor));
});
