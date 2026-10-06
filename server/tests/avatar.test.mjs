import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-avatar-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const { parseAvatar, setOwnAvatar } = await import('../dist/services/avatar.service.js');
const { updateOwnProfile } = await import('../dist/services/profile.service.js');

let alice;
const avatarOf = (id) => db.prepare('SELECT avatar FROM users WHERE id = ?').get(id).avatar;

before(() => {
  seed();
  alice = db.prepare("SELECT id FROM users WHERE username = 'alice'").get().id;
});

test('seeded users start with no avatar (initials)', () => {
  assert.equal(avatarOf(alice), null);
});

test('accepts only the shipped preset keys; empty means none', () => {
  for (const ok of ['people-01', 'people-16', 'robot-01', 'robot-08']) assert.deepEqual(parseAvatar(ok), { ok: true, avatar: ok });
  for (const none of [undefined, null, '']) assert.deepEqual(parseAvatar(none), { ok: true, avatar: null });
  for (const bad of ['people-17', 'people-00', 'robot-09', 'robot-1', '../x.svg', 'https://x/y.png', 3]) {
    assert.equal(parseAvatar(bad).ok, false, String(bad));
  }
});

test('setOwnAvatar sets and clears without a password, and rejects unknown keys', () => {
  assert.equal(setOwnAvatar(alice, 'robot-03').ok, true);
  assert.equal(avatarOf(alice), 'robot-03');
  assert.equal(setOwnAvatar(alice, 'nope').ok, false);
  assert.equal(avatarOf(alice), 'robot-03');
  assert.equal(setOwnAvatar(alice, null).ok, true);
  assert.equal(avatarOf(alice), null);
});

test('profile save returns and keeps the avatar', () => {
  setOwnAvatar(alice, 'people-05');
  const res = updateOwnProfile(alice, 't', { currentPassword: 'student123', displayName: 'Alice A' });
  assert.equal(res.ok, true);
  assert.equal(res.user.avatar, 'people-05');
  assert.equal(avatarOf(alice), 'people-05');
});
