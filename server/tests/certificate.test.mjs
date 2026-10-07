import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-certificate-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const { certificateStatus, grantCertificate, revokeCertificate, listCertificateGrants, listCompletedTeamIds } = await import('../dist/services/certificate.service.js');

let alice, bob, instructor, alpha, rangeId;
const user = (name) => db.prepare('SELECT id, team_id AS teamId FROM users WHERE username = ?').get(name);

before(() => {
  seed();
  alice = user('alice');
  bob = user('bob');
  instructor = user('instructor');
  alpha = alice.teamId;
  const day = db.prepare('SELECT id FROM days LIMIT 1').get().id;
  rangeId = Number(
    db.prepare("INSERT INTO cyber_ranges (day_id, name, difficulty, sort_order) VALUES (?, 'Cert test', 'intermediate', 99)").run(day).lastInsertRowid,
  );
});

test('not eligible without a completed scenario or a grant', () => {
  assert.deepEqual(certificateStatus(alice.id, alpha), { eligible: false, source: null });
  db.prepare("INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status) VALUES (?, ?, 'active')").run(alpha, rangeId);
  assert.equal(certificateStatus(alice.id, alpha).eligible, false);
});

test('an instructor grant makes only that student eligible, and revoking removes it', () => {
  assert.equal(grantCertificate(alice.id, instructor.id).ok, true);
  assert.equal(grantCertificate(alice.id, instructor.id).ok, true); // idempotent
  assert.deepEqual(certificateStatus(alice.id, alpha), { eligible: true, source: 'granted' });
  assert.equal(certificateStatus(bob.id, alpha).eligible, false);
  assert.deepEqual(listCertificateGrants().map((g) => g.userId), [alice.id]);
  assert.equal(revokeCertificate(alice.id).ok, true);
  assert.equal(certificateStatus(alice.id, alpha).eligible, false);
});

test('grants only target students of the active run', () => {
  assert.equal(grantCertificate(instructor.id, instructor.id).ok, false);
  assert.equal(grantCertificate(999999, instructor.id).ok, false);
});

test('a completed scenario makes the whole team eligible', () => {
  db.prepare("UPDATE team_cyber_range_progress SET status = 'completed', completed_at = ? WHERE team_id = ?").run(new Date().toISOString(), alpha);
  assert.deepEqual(certificateStatus(alice.id, alpha), { eligible: true, source: 'completed' });
  assert.deepEqual(certificateStatus(bob.id, alpha), { eligible: true, source: 'completed' });
  assert.deepEqual(listCompletedTeamIds(), [alpha]);
});
