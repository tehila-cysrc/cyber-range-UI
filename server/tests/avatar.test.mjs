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
  for (const ok of ['open-peeps-01', 'thumbs-06', 'bottts-neutral-03', 'pixel-art-02']) assert.deepEqual(parseAvatar(ok), { ok: true, avatar: ok });
  for (const none of [undefined, null, '']) assert.deepEqual(parseAvatar(none), { ok: true, avatar: null });
  for (const bad of ['open-peeps-07', 'thumbs-00', 'bottts-1', 'people-01', 'bottts-neutral', '../x.svg', 'https://x/y.png', 3]) {
    assert.equal(parseAvatar(bad).ok, false, String(bad));
  }
});

test('setOwnAvatar sets and clears without a password, and rejects unknown keys', () => {
  assert.equal(setOwnAvatar(alice, 'bottts-03').ok, true);
  assert.equal(avatarOf(alice), 'bottts-03');
  assert.equal(setOwnAvatar(alice, 'nope').ok, false);
  assert.equal(avatarOf(alice), 'bottts-03');
  assert.equal(setOwnAvatar(alice, null).ok, true);
  assert.equal(avatarOf(alice), null);
});

test('profile save returns and keeps the avatar', () => {
  setOwnAvatar(alice, 'micah-05');
  const res = updateOwnProfile(alice, 't', { currentPassword: 'student123', displayName: 'Alice A' });
  assert.equal(res.ok, true);
  assert.equal(res.user.avatar, 'micah-05');
  assert.equal(avatarOf(alice), 'micah-05');
});
