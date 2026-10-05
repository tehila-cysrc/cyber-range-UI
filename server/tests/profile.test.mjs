import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-profile-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const { updateOwnProfile } = await import('../dist/services/profile.service.js');

let alice;
const addToken = (userId, token) =>
  db
    .prepare('INSERT INTO auth_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, new Date().toISOString(), new Date(Date.now() + 3600_000).toISOString());
const tokens = (userId) => db.prepare('SELECT token FROM auth_tokens WHERE user_id = ? ORDER BY token').all(userId).map((r) => r.token);

before(() => {
  seed();
  alice = db.prepare("SELECT id FROM users WHERE username = 'alice'").get().id;
});

test('rejects a wrong or missing current password', () => {
  assert.deepEqual(updateOwnProfile(alice, 't', { displayName: 'X' }).status, 403);
  assert.deepEqual(updateOwnProfile(alice, 't', { currentPassword: 'nope', displayName: 'X' }).status, 403);
});

test('rejects a taken username, a short password and empty fields', () => {
  const pw = { currentPassword: 'student123' };
  assert.equal(updateOwnProfile(alice, 't', { ...pw, username: 'bob' }).status, 409);
  assert.equal(updateOwnProfile(alice, 't', { ...pw, newPassword: 'short' }).status, 400);
  assert.equal(updateOwnProfile(alice, 't', { ...pw, username: '  ' }).status, 400);
  assert.equal(updateOwnProfile(alice, 't', { ...pw, displayName: '' }).status, 400);
});

test('updates username and display name without touching sessions', () => {
  addToken(alice, 'a-current');
  addToken(alice, 'a-other');
  const r = updateOwnProfile(alice, 'a-current', { currentPassword: 'student123', username: ' alice2 ', displayName: 'Alice B' });
  assert.equal(r.ok, true);
  assert.equal(r.user.username, 'alice2');
  assert.equal(r.user.displayName, 'Alice B');
  assert.equal(r.passwordChanged, false);
  assert.deepEqual(tokens(alice), ['a-current', 'a-other']);
});

test('a password change keeps the current session and revokes the others', () => {
  const r = updateOwnProfile(alice, 'a-current', { currentPassword: 'student123', newPassword: 'newpass123' });
  assert.equal(r.ok, true);
  assert.equal(r.passwordChanged, true);
  assert.equal(db.prepare('SELECT password FROM users WHERE id = ?').get(alice).password, 'newpass123');
  assert.deepEqual(tokens(alice), ['a-current']);
  assert.equal(updateOwnProfile(alice, 'a-current', { currentPassword: 'student123' }).status, 403);
});
