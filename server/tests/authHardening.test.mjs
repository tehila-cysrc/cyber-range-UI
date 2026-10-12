import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-auth-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, createFreshEventRun, getActiveEventRunId } = await import('../dist/db/seed.js');
const accounts = await import('../dist/services/accounts.service.js');
const throttle = await import('../dist/services/loginThrottle.service.js');

before(() => {
  seed();
});

test('a reset keeps staff accounts (own passwords) and never re-creates the default login', () => {
  const oldRun = getActiveEventRunId();
  db.prepare("UPDATE accounts SET password = 'changed-pass' WHERE username = 'instructor'").run();
  const leadId = accounts.insertAccount({ username: 'lead', password: 'lead-pass', role: 'admin', displayName: 'Lead', avatar: 'thumbs-01' }, null);
  accounts.ensureStaffMembership(accounts.getAccount(leadId));

  db.prepare('DELETE FROM event_runs WHERE id = ?').run(oldRun);
  const newRun = createFreshEventRun();

  // The new run starts with no users at all; the accounts are untouched.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE event_run_id = ?').get(newRun).n, 0);
  const rows = db.prepare('SELECT username, password, role FROM accounts ORDER BY username').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { username: 'instructor', password: 'changed-pass', role: 'admin' },
    { username: 'lead', password: 'lead-pass', role: 'admin' },
  ]);
  // Sign-in recreates the membership row in the new run, synced from the account.
  const memberId = accounts.ensureStaffMembership(accounts.getAccount(leadId));
  assert.deepEqual(
    { ...db.prepare('SELECT event_run_id AS run, username, password, role, avatar FROM users WHERE id = ?').get(memberId) },
    { run: newRun, username: 'lead', password: '', role: 'instructor', avatar: 'thumbs-01' },
  );
  // A second seed never adds a default admin while one is active.
  assert.equal(accounts.ensureInitialAdmin().created, false);
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
