import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, beforeEach, test } from 'node:test';

// db/index.js opens DB_PATH at import time, so point it at a throwaway file BEFORE importing anything
// that touches the DB. Everything below runs against a freshly seeded database.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ttp-scoring-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const { startCyberRangeForTeam } = await import('../dist/services/cyberRangeProgress.service.js');
const svc = await import('../dist/services/ttpScoring.service.js');

let rangeId;
let alpha;
let bravo;
let aliceId;
let bobId;
let carolId;
let instructorId;

before(() => {
  seed();
  rangeId = db.prepare('SELECT id FROM cyber_ranges ORDER BY id LIMIT 1').get().id;
  alpha = db.prepare("SELECT id FROM teams WHERE name = 'Team Alpha'").get().id;
  bravo = db.prepare("SELECT id FROM teams WHERE name = 'Team Bravo'").get().id;
  aliceId = db.prepare("SELECT id FROM users WHERE username = 'alice'").get().id;
  bobId = db.prepare("SELECT id FROM users WHERE username = 'bob'").get().id;
  carolId = db.prepare("SELECT id FROM users WHERE username = 'carol'").get().id;
  instructorId = db.prepare("SELECT id FROM users WHERE username = 'instructor'").get().id;
});

// Each test starts from an empty ATT&CK state on the same seeded run.
beforeEach(() => {
  for (const table of ['ttp_detections', 'ttp_occurrences', 'documentation_entry_ttps']) db.exec(`DELETE FROM ${table}`);
  db.exec("DELETE FROM scores WHERE source = 'ttp'");
  db.exec('DELETE FROM documentation_entries');
  db.exec('DELETE FROM cyber_range_expected_ttps');
  db.exec('DELETE FROM team_cyber_range_progress');
  startCyberRangeForTeam(alpha, rangeId);
  startCyberRangeForTeam(bravo, rangeId);
});

const now = () => new Date().toISOString();

function expect(techniqueId, points, tacticId = 'TA0007') {
  const r = db
    .prepare(
      `INSERT INTO cyber_range_expected_ttps (cyber_range_id, technique_id, tactic_id, points, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(rangeId, techniqueId, tacticId, points, now(), now());
  return Number(r.lastInsertRowid);
}

function entry(teamId, authorId, body = 'Observed net user on DC01') {
  const r = db
    .prepare(
      `INSERT INTO documentation_entries (team_id, cyber_range_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(teamId, rangeId, authorId, body, now());
  return Number(r.lastInsertRowid);
}

function tag(entryId, teamId, userId, ids) {
  const result = svc.setEntryTtps(entryId, teamId, rangeId, userId, ids);
  assert.equal(result.ok, true, result.error);
  return svc.reconcileTeamTtps(teamId, rangeId);
}

const ttpPoints = (teamId) =>
  db.prepare("SELECT COALESCE(SUM(points), 0) AS n FROM scores WHERE team_id = ? AND source = 'ttp'").get(teamId).n;

test('a correct tag credits the expected points once, as a scores row', () => {
  expect('T1087', 10);
  const credits = tag(entry(alpha, aliceId), alpha, aliceId, ['T1087']);
  assert.equal(credits.length, 1);
  assert.equal(credits[0].points, 10);
  assert.equal(ttpPoints(alpha), 10);
  const score = db.prepare('SELECT student_user_id AS s, awarded_by_user_id AS a FROM scores WHERE id = ?').get(credits[0].scoreId);
  assert.equal(score.s, aliceId);
  assert.equal(score.a, null);
});

test('a sub-technique tag satisfies the expected parent', () => {
  expect('T1087', 10);
  assert.equal(tag(entry(alpha, aliceId), alpha, aliceId, ['T1087.001']).length, 1);
});

test('repeating the technique (another entry, another teammate) never awards again', () => {
  expect('T1087', 10);
  tag(entry(alpha, aliceId), alpha, aliceId, ['T1087']);
  assert.equal(tag(entry(alpha, bobId), alpha, bobId, ['T1087']).length, 0);
  assert.equal(tag(entry(alpha, bobId), alpha, bobId, ['T1087.002']).length, 0);
  assert.equal(svc.reconcileTeamTtps(alpha, rangeId).length, 0, 'reconcile is idempotent');
  assert.equal(ttpPoints(alpha), 10);
});

test('credit is per team — another team earns its own', () => {
  expect('T1087', 10);
  tag(entry(alpha, aliceId), alpha, aliceId, ['T1087']);
  assert.equal(tag(entry(bravo, carolId), bravo, carolId, ['T1087']).length, 1);
  assert.equal(ttpPoints(bravo), 10);
});

test('a wrong technique scores 0 and is reported as an incorrect association', () => {
  expect('T1087', 10);
  assert.equal(tag(entry(alpha, aliceId), alpha, aliceId, ['T1003']).length, 0);
  const report = svc.buildTeamTtpReport(alpha, rangeId, { includeInstructorNotes: true });
  assert.equal(report.totals.earnedPoints, 0);
  assert.equal(report.expected[0].status, 'missed');
  assert.deepEqual(report.incorrect.map((i) => i.techniqueId), ['T1003']);
  assert.equal(report.totals.precision, 0);
});

test('removing or changing the credited tag keeps the credit (locked) and keeps history', () => {
  expect('T1087', 10);
  const e = entry(alpha, aliceId);
  tag(e, alpha, aliceId, ['T1087']);
  tag(e, alpha, aliceId, ['T1059']);
  assert.equal(ttpPoints(alpha), 10);
  const report = svc.buildTeamTtpReport(alpha, rangeId, { includeInstructorNotes: true });
  assert.equal(report.expected[0].status, 'detected');
  assert.deepEqual(report.incorrect.map((i) => i.techniqueId), ['T1059']);
  assert.equal(report.totals.distinctTaggedCount, 2, 'the removed T1087 tag still counts in history');
});

test('replaying the same tag set is a no-op', () => {
  expect('T1087', 10);
  const e = entry(alpha, aliceId);
  tag(e, alpha, aliceId, ['T1087']);
  const again = svc.setEntryTtps(e, alpha, rangeId, aliceId, ['T1087']);
  assert.deepEqual(again, { ok: true, changed: false });
});

test('more than 3 techniques on one entry is refused', () => {
  const result = svc.setEntryTtps(entry(alpha, aliceId), alpha, rangeId, aliceId, ['T1087', 'T1003', 'T1021', 'T1560']);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test('the technique budget stops shotgun tagging (history counts, re-tagging is free)', () => {
  expect('T1087', 10); // budget = max(10, 3) = 10
  const pool = ['T1003', 'T1021', 'T1560', 'T1059', 'T1016', 'T1082', 'T1083', 'T1049', 'T1057', 'T1069', 'T1018'];
  for (let i = 0; i < 10; i += 1) tag(entry(alpha, aliceId), alpha, aliceId, [pool[i]]);
  const refused = svc.setEntryTtps(entry(alpha, aliceId), alpha, rangeId, aliceId, [pool[10]]);
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 409);
  assert.equal(svc.setEntryTtps(entry(alpha, aliceId), alpha, rangeId, aliceId, [pool[0]]).ok, true, 're-tagging a tried technique is free');
});

test('no expected techniques: tagging works, nothing scores, no budget', () => {
  assert.equal(tag(entry(alpha, aliceId), alpha, aliceId, ['T1087']).length, 0);
  assert.equal(svc.budgetFor(alpha, rangeId), null);
});

test('adding an expectation mid-run credits an earlier tag at the tag time', () => {
  const e = entry(alpha, aliceId);
  tag(e, alpha, aliceId, ['T1021']);
  const taggedAt = db.prepare('SELECT tagged_at AS t FROM documentation_entry_ttps WHERE documentation_entry_id = ?').get(e).t;
  expect('T1021', 20, 'TA0008');
  const credits = svc.reconcileTeamTtps(alpha, rangeId);
  assert.equal(credits.length, 1);
  const detection = db.prepare('SELECT detected_at AS d FROM ttp_detections WHERE id = ?').get(credits[0].detectionId);
  assert.equal(detection.d, taggedAt);
});

test('void removes the points and blocks auto re-credit; manual credit restores it', () => {
  const exp = expect('T1087', 10);
  const e = entry(alpha, aliceId);
  const [credit] = tag(e, alpha, aliceId, ['T1087']);
  assert.equal(svc.voidDetection(credit.detectionId, instructorId, 'guess').ok, true);
  assert.equal(ttpPoints(alpha), 0);
  assert.equal(svc.reconcileTeamTtps(alpha, rangeId).length, 0, 'the same tag must not re-credit after a void');
  assert.equal(tag(entry(alpha, bobId), alpha, bobId, ['T1087']).length, 0, 'nor a fresh re-tag of the voided technique');
  assert.equal(svc.voidDetection(credit.detectionId, instructorId, null).status, 409);

  const manual = svc.manualCredit(alpha, exp, e, instructorId, 'clear evidence in the entry');
  assert.equal(manual.ok, true);
  assert.equal(ttpPoints(alpha), 10);
  assert.equal(svc.manualCredit(alpha, exp, e, instructorId, null).status, 409, 'only one credit at a time');
});

test('recording an occurrence never changes credits or points — it only makes MTTD measurable', () => {
  const exp = expect('T1087', 10);
  tag(entry(alpha, aliceId), alpha, aliceId, ['T1087']);
  const before = svc.buildTeamTtpReport(alpha, rangeId, { includeInstructorNotes: true });
  assert.equal(before.expected[0].detection.mttd.measurable, false);
  assert.equal(before.expected[0].detection.mttd.reason, 'no_occurrence_recorded');
  assert.deepEqual(before.mttd, { meanSeconds: null, measuredCount: 0, detectedCount: 1 });

  const runId = db.prepare('SELECT id FROM event_runs WHERE is_active = 1').get().id;
  const detectedAt = before.expected[0].detection.detectedAt;
  const firstStarted = db.prepare('SELECT first_started_at AS f FROM team_cyber_range_progress WHERE team_id = ?').get(alpha).f;
  db.prepare(
    `INSERT INTO ttp_occurrences (event_run_id, cyber_range_id, expected_ttp_id, occurred_at, source, created_at)
     VALUES (?, ?, ?, ?, 'manual', ?)`,
  ).run(runId, rangeId, exp, firstStarted, now());
  assert.equal(svc.reconcileTeamTtps(alpha, rangeId).length, 0);

  const after = svc.buildTeamTtpReport(alpha, rangeId, { includeInstructorNotes: true });
  assert.equal(after.totals.earnedPoints, 10);
  assert.equal(after.expected[0].detection.mttd.measurable, true);
  assert.equal(after.expected[0].detection.mttd.mttdSeconds, Math.round((Date.parse(detectedAt) - Date.parse(firstStarted)) / 1000));
  assert.equal(after.mttd.measuredCount, 1);
});

test('a succeeded trigger-script run records an occurrence for its expected technique only', () => {
  const nodeId = Number(
    db.prepare(`INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type) VALUES (?, 'test-dc01', 'DC01', 'vm')`).run(rangeId)
      .lastInsertRowid,
  );
  const scriptId = Number(
    db.prepare(`INSERT INTO scripts (name, content, script_type, created_at) VALUES ('enumerate-local-users', 'net user', 'powershell', ?)`).run(now())
      .lastInsertRowid,
  );
  const exp = expect('T1087', 10);
  db.prepare('UPDATE cyber_range_expected_ttps SET trigger_script_id = ? WHERE id = ?').run(scriptId, exp);
  expect('T1003', 25, 'TA0006'); // no trigger -> no occurrence
  const startedAt = now();
  const insertExec = (status) =>
    Number(
      db
        .prepare(
          `INSERT INTO script_executions (topology_node_id, script_id, script_type, script_hash, actor_user_id, status, started_at)
           VALUES (?, ?, 'powershell', 'hash', ?, ?, ?)`,
        )
        .run(nodeId, scriptId, instructorId, status, startedAt).lastInsertRowid,
    );

  assert.equal(svc.recordScriptOccurrences(insertExec('failed')), null, 'a failed run records nothing');
  const recorded = svc.recordScriptOccurrences(insertExec('succeeded'));
  assert.deepEqual(recorded, { cyberRangeId: rangeId, expectedTtpIds: [exp] });
  const occurrences = svc.occurrencesForRange(rangeId);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].occurredAt, startedAt);
  assert.equal(occurrences[0].scriptName, 'enumerate-local-users');
  assert.equal(occurrences[0].nodeLabel, 'DC01');

  db.exec('DELETE FROM ttp_occurrences');
  db.exec('DELETE FROM script_executions');
  db.prepare('DELETE FROM topology_nodes WHERE id = ?').run(nodeId);
  db.prepare('UPDATE cyber_range_expected_ttps SET trigger_script_id = NULL').run();
  db.prepare('DELETE FROM scripts WHERE id = ?').run(scriptId);
});

test('first_started_at survives a pause/restart of the scenario', () => {
  const first = db.prepare('SELECT first_started_at AS f FROM team_cyber_range_progress WHERE team_id = ? AND cyber_range_id = ?').get(alpha, rangeId).f;
  const otherRange = db.prepare('SELECT id FROM cyber_ranges WHERE id != ? ORDER BY id LIMIT 1').get(rangeId).id;
  startCyberRangeForTeam(alpha, otherRange);
  startCyberRangeForTeam(alpha, rangeId);
  const row = db.prepare('SELECT first_started_at AS f, started_at AS s FROM team_cyber_range_progress WHERE team_id = ? AND cyber_range_id = ?').get(alpha, rangeId);
  assert.equal(row.f, first);
});

test('the student-safe entry tags never expose expected-but-undetected techniques', () => {
  expect('T1087', 10);
  expect('T1003', 25, 'TA0006');
  const e = entry(alpha, aliceId);
  tag(e, alpha, aliceId, ['T1087.001', 'T1059']);
  const tags = svc.tagsByEntry(alpha, rangeId).get(e);
  assert.deepEqual(
    tags.map((t) => [t.techniqueId, t.credited]),
    [['T1087.001', true], ['T1059', false]],
  );
  assert.ok(!JSON.stringify(tags).includes('T1003'));
});

test('the student report drops instructor notes', () => {
  db.prepare(
    `INSERT INTO cyber_range_expected_ttps (cyber_range_id, technique_id, tactic_id, points, description, created_at, updated_at)
     VALUES (?, 'T1087', 'TA0007', 10, 'agent runs net user on DC01', ?, ?)`,
  ).run(rangeId, now(), now());
  const report = svc.buildTeamTtpReport(alpha, rangeId, { includeInstructorNotes: false });
  assert.ok(!JSON.stringify(report).includes('agent runs net user'));
});
