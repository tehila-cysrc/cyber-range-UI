import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-certificate-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const { migrate } = await import('../dist/db/migrate.js');
const { certificateStatus, grantCertificate, revokeCertificate, listCertificateGrants, listCompletedTeamScenarios, studentCertificateOptions } =
  await import('../dist/services/certificate.service.js');
const T = await import('../dist/services/certificateTemplates.service.js');

let alice, bob, instructor, alpha, rangeA, rangeB, unassigned;
const user = (name) => db.prepare('SELECT id, team_id AS teamId FROM users WHERE username = ?').get(name);
const scenarios = (userId, teamId) => certificateStatus(userId, teamId).certificates.map((c) => [c.cyberRangeId, c.source, c.template.name]);

const TEMPLATE = {
  name: 'Cloud IR',
  label: 'Certificate of Completion',
  title: 'Cloud Incident\nResponse',
  body: 'For completing the cloud exercise.',
  skills: ['AWS Forensics', 'IAM Abuse'],
  program: 'Cloud SOC Training',
  programHighlight: 'Cyber Range',
  signerName: 'Someone',
  signerTitle: 'Trainer',
  statusText: 'Mission Complete',
};

before(() => {
  seed();
  alice = user('alice');
  bob = user('bob');
  instructor = user('instructor');
  alpha = alice.teamId;
  const day = db.prepare('SELECT id FROM days LIMIT 1').get().id;
  const insert = db.prepare("INSERT INTO cyber_ranges (day_id, name, difficulty, sort_order) VALUES (?, ?, 'intermediate', 99)");
  rangeA = Number(insert.run(day, 'Scenario A').lastInsertRowid);
  rangeB = Number(insert.run(day, 'Scenario B').lastInsertRowid);
  unassigned = Number(insert.run(day, 'Scenario C').lastInsertRowid);
  const progress = db.prepare("INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status) VALUES (?, ?, 'active')");
  progress.run(alpha, rangeA);
  progress.run(alpha, rangeB);
});

test('migration seeds exactly one default template with the original certificate text', () => {
  const templates = T.listCertificateTemplates();
  assert.equal(templates.length, 1);
  assert.equal(templates[0].isDefault, true);
  assert.equal(templates[0].title, T.ORIGINAL_CERTIFICATE.title);
  assert.deepEqual(templates[0].skills, T.ORIGINAL_CERTIFICATE.skills);
  migrate(); // re-running is a no-op
  assert.equal(T.listCertificateTemplates().length, 1);
});

test('not eligible without a completed scenario or a grant', () => {
  assert.deepEqual(certificateStatus(alice.id, alpha), { eligible: false, certificates: [] });
});

test('template validation keeps text inside the layout', () => {
  assert.equal(T.createCertificateTemplate({ ...TEMPLATE, name: '' }).ok, false);
  assert.equal(T.createCertificateTemplate({ ...TEMPLATE, title: 'a\nb\nc' }).ok, false);
  assert.equal(T.createCertificateTemplate({ ...TEMPLATE, skills: ['1', '2', '3', '4', '5', '6', '7'] }).ok, false);
  assert.equal(T.createCertificateTemplate({ ...TEMPLATE, body: 'x'.repeat(261) }).ok, false);
  const dup = T.createCertificateTemplate({ ...TEMPLATE, name: T.ORIGINAL_CERTIFICATE.name.toUpperCase() });
  assert.equal(dup.ok, false);
  assert.equal(dup.status, 409);
});

test('each completed scenario gives its own certificate with the scenario’s template', () => {
  const cloud = T.createCertificateTemplate(TEMPLATE);
  assert.equal(cloud.ok, true);
  db.prepare('UPDATE cyber_ranges SET certificate_template_id = ? WHERE id = ?').run(cloud.template.id, rangeB);

  db.prepare("UPDATE team_cyber_range_progress SET status = 'completed' WHERE team_id = ? AND cyber_range_id = ?").run(alpha, rangeA);
  assert.deepEqual(scenarios(bob.id, alpha), [[rangeA, 'completed', T.ORIGINAL_CERTIFICATE.name]]);

  db.prepare("UPDATE team_cyber_range_progress SET status = 'completed' WHERE team_id = ? AND cyber_range_id = ?").run(alpha, rangeB);
  assert.deepEqual(scenarios(bob.id, alpha), [
    [rangeA, 'completed', T.ORIGINAL_CERTIFICATE.name],
    [rangeB, 'completed', 'Cloud IR'],
  ]);
  assert.deepEqual(
    listCompletedTeamScenarios().map((c) => c.cyberRangeId).sort(),
    [rangeA, rangeB].sort(),
  );
  db.prepare("UPDATE team_cyber_range_progress SET status = 'active' WHERE team_id = ?").run(alpha);
});

test('a grant is per scenario, only for the granted student, and only for an assigned scenario', () => {
  assert.equal(grantCertificate(alice.id, rangeB, instructor.id).ok, true);
  assert.equal(grantCertificate(alice.id, rangeB, instructor.id).ok, true); // idempotent
  assert.equal(grantCertificate(alice.id, unassigned, instructor.id).status, 409);
  assert.deepEqual(scenarios(alice.id, alpha), [[rangeB, 'granted', 'Cloud IR']]);
  assert.deepEqual(scenarios(bob.id, alpha), []);
  assert.deepEqual(listCertificateGrants().map((g) => [g.userId, g.cyberRangeId]), [[alice.id, rangeB]]);

  const options = studentCertificateOptions(alice.id, alpha).map((o) => [o.scenarioName, o.earned, o.granted, o.template.name]);
  assert.deepEqual(options, [
    ['Scenario A', false, false, T.ORIGINAL_CERTIFICATE.name],
    ['Scenario B', false, true, 'Cloud IR'],
  ]);

  assert.equal(revokeCertificate(alice.id, rangeB).ok, true);
  assert.equal(certificateStatus(alice.id, alpha).eligible, false);
});

test('grants only target students of the active run', () => {
  assert.equal(grantCertificate(instructor.id, rangeA, instructor.id).ok, false);
  assert.equal(grantCertificate(999999, rangeA, instructor.id).ok, false);
});

test('completed and granted on the same scenario is listed once, as completed', () => {
  grantCertificate(alice.id, rangeA, instructor.id);
  db.prepare("UPDATE team_cyber_range_progress SET status = 'completed' WHERE team_id = ? AND cyber_range_id = ?").run(alpha, rangeA);
  assert.deepEqual(scenarios(alice.id, alpha), [[rangeA, 'completed', T.ORIGINAL_CERTIFICATE.name]]);
  revokeCertificate(alice.id, rangeA);
  db.prepare("UPDATE team_cyber_range_progress SET status = 'active' WHERE team_id = ?").run(alpha);
});

test('a legacy scenario-less grant prints the default certificate and can be revoked', () => {
  db.prepare('INSERT INTO certificate_grants (user_id, cyber_range_id, granted_at) VALUES (?, NULL, ?)').run(alice.id, new Date().toISOString());
  assert.deepEqual(scenarios(alice.id, alpha), [[null, 'granted', T.ORIGINAL_CERTIFICATE.name]]);
  assert.equal(studentCertificateOptions(alice.id, alpha).at(-1).cyberRangeId, null);
  revokeCertificate(alice.id, null);
  assert.equal(certificateStatus(alice.id, alpha).eligible, false);
});

test('default switching, and deleting a template falls back to the default', () => {
  const cloud = T.listCertificateTemplates().find((t) => t.name === 'Cloud IR');
  const original = T.listCertificateTemplates().find((t) => t.isDefault);
  assert.equal(T.deleteCertificateTemplate(original.id).status, 409); // the default can't go

  assert.equal(T.updateCertificateTemplate(cloud.id, { isDefault: true }).ok, true);
  assert.deepEqual(T.listCertificateTemplates().filter((t) => t.isDefault).map((t) => t.id), [cloud.id]);
  assert.equal(T.certificateTemplateForScenario(rangeA).name, 'Cloud IR'); // no own template → the default
  assert.equal(T.updateCertificateTemplate(original.id, { isDefault: true }).ok, true);

  const r = T.deleteCertificateTemplate(cloud.id);
  assert.equal(r.ok, true);
  assert.equal(r.scenariosReset, 1);
  assert.equal(db.prepare('SELECT certificate_template_id AS t FROM cyber_ranges WHERE id = ?').get(rangeB).t, null);
  assert.equal(T.certificateTemplateForScenario(rangeB).name, T.ORIGINAL_CERTIFICATE.name);
});

test('migration rebuilds an old (user_id UNIQUE) grants table once, keeping grants as scenario-less', () => {
  db.exec(`
    DROP TABLE certificate_grants;
    CREATE TABLE certificate_grants (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      granted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      granted_at TEXT NOT NULL
    );`);
  db.prepare('INSERT INTO certificate_grants (user_id, granted_at) VALUES (?, ?)').run(bob.id, '2026-10-07T00:00:00.000Z');
  migrate();
  migrate();
  assert.deepEqual(listCertificateGrants().map((g) => [g.userId, g.cyberRangeId]), [[bob.id, null]]);
  assert.equal(grantCertificate(bob.id, rangeA, instructor.id).ok, true); // no longer one grant per student
  assert.equal(grantCertificate(bob.id, rangeA, instructor.id).ok, true);
  assert.equal(listCertificateGrants().length, 2);
});
