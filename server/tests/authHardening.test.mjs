import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-auth-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, createFreshEventRun, activeInstructorAccounts, getActiveEventRunId } = await import('../dist/db/seed.js');
const throttle = await import('../dist/services/loginThrottle.service.js');

before(() => {
  seed();
});

test('a reset carries instructors over with their own passwords and never re-creates the default login', () => {
  const oldRun = getActiveEventRunId();
  db.prepare("UPDATE users SET password = 'changed-pass' WHERE username = 'instructor'").run();
  db.prepare(
    `INSERT INTO users (event_run_id, username, password, role, team_id, display_name, avatar)
     VALUES (?, 'lead', 'lead-pass', 'instructor', NULL, 'Lead', 'thumbs-01')`,
  ).run(oldRun);
  db.prepare(
    `INSERT INTO users (event_run_id, username, password, role, team_id, display_name, deactivated_at)
     VALUES (?, 'gone', 'x', 'instructor', NULL, 'Gone', '2026-01-01')`,
  ).run(oldRun);

  const carried = activeInstructorAccounts(oldRun);
  db.prepare('DELETE FROM event_runs WHERE id = ?').run(oldRun);
  const newRun = createFreshEventRun(carried);

  const users = db.prepare('SELECT username, password, role, display_name AS d, avatar FROM users WHERE event_run_id = ? ORDER BY username').all(newRun);
  assert.deepEqual(
    users.map((u) => ({ ...u })),
    [
      { username: 'instructor', password: 'changed-pass', role: 'instructor', d: 'Instructor', avatar: null },
      { username: 'lead', password: 'lead-pass', role: 'instructor', d: 'Lead', avatar: 'thumbs-01' },
    ],
  );
});

test('login throttle: 10 wrong passwords lock that account from that IP only, success clears it', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 9; i++) throttle.recordLoginFailure('1.1.1.1', 'Alice', t0);
  assert.equal(throttle.isLoginThrottled('1.1.1.1', 'alice', t0), false);
  throttle.recordLoginFailure('1.1.1.1', ' alice ', t0);
  assert.equal(throttle.isLoginThrottled('1.1.1.1', 'alice', t0), true);
  assert.equal(throttle.isLoginThrottled('2.2.2.2', 'alice', t0), false);
  assert.equal(throttle.isLoginThrottled('1.1.1.1', 'bob', t0), false);
  // The window passes.
  assert.equal(throttle.isLoginThrottled('1.1.1.1', 'alice', t0 + 10 * 60_000 + 1), false);

  for (let i = 0; i < 5; i++) throttle.recordLoginFailure('3.3.3.3', 'carol', t0);
  throttle.recordLoginSuccess('3.3.3.3', 'carol');
  for (let i = 0; i < 9; i++) throttle.recordLoginFailure('3.3.3.3', 'carol', t0);
  assert.equal(throttle.isLoginThrottled('3.3.3.3', 'carol', t0), false);
});

test('login throttle: an IP spraying many usernames is capped', () => {
  const t0 = 5_000_000;
  for (let i = 0; i < 100; i++) throttle.recordLoginFailure('4.4.4.4', `user${i}`, t0);
  assert.equal(throttle.isLoginThrottled('4.4.4.4', 'someone-new', t0), true);
  assert.equal(throttle.isLoginThrottled('5.5.5.5', 'someone-new', t0), false);
});
