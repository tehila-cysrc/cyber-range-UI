import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// AI assessment — Phase 4: the investigation snapshot. Isolated throwaway DB; no network.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-ai-snapshot-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { startCyberRangeForTeam } = await import('../dist/services/cyberRangeProgress.service.js');
const snap = await import('../dist/services/ai/assessmentSnapshot.service.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');

let f;
const ids = {};
const T0 = '2026-10-15T08:00:00.000Z';
const at = (min) => new Date(Date.parse(T0) + min * 60_000).toISOString();

function student(username, displayName, teamId) {
  return Number(
    db.prepare("INSERT INTO users (event_run_id, username, password, role, team_id, display_name) VALUES (?, ?, 'x', 'student', ?, ?)").run(getActiveEventRunId(), username, teamId, displayName).lastInsertRowid,
  );
}
function entry(teamId, rangeId, authorId, body, extra = {}) {
  return Number(
    db.prepare(
      `INSERT INTO documentation_entries (team_id, cyber_range_id, author_user_id, category_id, body, is_important_finding, created_at, image_data_url, after_time_limit)
       VALUES (?, ?, ?, (SELECT id FROM documentation_categories WHERE key = 'other'), ?, ?, ?, ?, ?)`,
    ).run(teamId, rangeId, authorId, body, extra.important ? 1 : 0, extra.at ?? at(5), extra.image ?? null, extra.after ? 1 : 0).lastInsertRowid,
  );
}
function node(teamId, rangeId, authorId, label, body = '') {
  return Number(
    db.prepare("INSERT INTO investigation_canvas_nodes (team_id, cyber_range_id, author_user_id, node_type, label, body, created_at, updated_at) VALUES (?, ?, ?, 'finding', ?, ?, ?, ?)").run(teamId, rangeId, authorId, label, body, at(7), at(7)).lastInsertRowid,
  );
}
const counts = () =>
  Object.fromEntries(
    ['documentation_entries', 'documentation_entry_ttps', 'investigation_canvas_nodes', 'investigation_canvas_edges', 'documentation_feedback', 'help_requests', 'scores', 'ai_assessments', 'team_cyber_range_progress', 'audit_log'].map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]),
  );

before(() => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  ids.alice = student('snap-alice', 'Alice Realname', f.teamA);
  ids.bob = student('snap-bob', 'Bob Realname', f.teamA);
  ids.carol = student('snap-carol', 'Carol OtherTeam', f.teamB);
  const staff = db.prepare("SELECT id FROM users WHERE role = 'instructor' LIMIT 1").get().id;

  // Team A on S1 — the target.
  ids.e1 = entry(f.teamA, f.s1, ids.alice, 'we saw someone log into the server with an admin acount and then run weird powershell', { important: true, at: at(10) });
  ids.e2 = entry(f.teamA, f.s1, ids.bob, 'screenshot of the zip', { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', at: at(20) });
  ids.eLong = entry(f.teamA, f.s1, ids.alice, 'L'.repeat(5000), { at: at(30), after: true });
  db.prepare("INSERT INTO documentation_entry_ttps (documentation_entry_id, team_id, cyber_range_id, technique_id, tagged_by_user_id, tagged_at) VALUES (?, ?, ?, 'T1059.001', ?, ?)").run(ids.e1, f.teamA, f.s1, ids.alice, at(11));
  db.prepare("INSERT INTO documentation_entry_ttps (documentation_entry_id, team_id, cyber_range_id, technique_id, tagged_by_user_id, tagged_at, removed_at) VALUES (?, ?, ?, 'T1078', ?, ?, ?)").run(ids.e1, f.teamA, f.s1, ids.alice, at(11), at(12));
  ids.n1 = node(f.teamA, f.s1, ids.bob, 'admin login on FS01', 'seen in logs');
  ids.n2 = node(f.teamA, f.s1, ids.alice, 'powershell');
  ids.edge = Number(db.prepare("INSERT INTO investigation_canvas_edges (team_id, cyber_range_id, from_node_id, to_node_id, label, author_user_id, created_at) VALUES (?, ?, ?, ?, 'then', ?, ?)").run(f.teamA, f.s1, ids.n1, ids.n2, ids.bob, at(8)).lastInsertRowid);
  db.prepare("INSERT INTO documentation_feedback (documentation_entry_id, team_id, author_user_id, verdict, body, created_at) VALUES (?, ?, ?, 'on_track', 'Good catch — which account?', ?)").run(ids.e1, f.teamA, staff, at(15));
  db.prepare("INSERT INTO help_requests (team_id, cyber_range_id, requested_by_user_id, status, created_at, message) VALUES (?, ?, ?, 'resolved', ?, 'we are stuck on the logs')").run(f.teamA, f.s1, ids.alice, at(25));
  db.prepare("INSERT INTO scores (team_id, documentation_entry_id, cyber_range_id, points, note, created_at, source) VALUES (?, ?, ?, 10, 'nice find', ?, 'manual')").run(f.teamA, ids.e1, f.s1, at(16));

  // Noise that must never appear: team A on S2, team B on S1.
  entry(f.teamA, f.s2, ids.alice, 'SENTINEL-OTHER-SCENARIO');
  entry(f.teamB, f.s1, ids.carol, 'SENTINEL-OTHER-TEAM');
  node(f.teamB, f.s1, ids.carol, 'SENTINEL-OTHER-TEAM-NODE');
  db.prepare("INSERT INTO help_requests (team_id, cyber_range_id, requested_by_user_id, status, created_at, message) VALUES (?, ?, ?, 'open', ?, 'SENTINEL-OTHER-HELP')").run(f.teamA, f.s2, ids.alice, at(3));
  db.prepare("INSERT INTO scores (team_id, cyber_range_id, points, note, created_at, source) VALUES (?, ?, 5, 'SENTINEL-OTHER-SCORE', ?, 'manual')").run(f.teamB, f.s1, at(3));

  // Answer key + one recorded occurrence for S1.
  const exp = Number(db.prepare("INSERT INTO cyber_range_expected_ttps (cyber_range_id, technique_id, tactic_id, points, description, is_active, sort_order, created_at, updated_at) VALUES (?, 'T1566.001', 'TA0001', 20, 'SENTINEL-ANSWER-KEY-NOTE', 1, 1, ?, ?)").run(f.s1, at(0), at(0)).lastInsertRowid);
  db.prepare("INSERT INTO cyber_range_expected_ttps (cyber_range_id, technique_id, tactic_id, points, is_active, sort_order, created_at, updated_at) VALUES (?, 'T1059.001', 'TA0002', 10, 1, 2, ?, ?)").run(f.s1, at(0), at(0));
  db.prepare("INSERT INTO ttp_occurrences (event_run_id, cyber_range_id, expected_ttp_id, occurred_at, source, created_at) VALUES (?, ?, ?, ?, 'manual', ?)").run(getActiveEventRunId(), f.s1, exp, at(2), at(2));
});

test('no session on the scenario -> SnapshotError no_progress (nothing assessed without a session)', () => {
  assert.throws(() => snap.buildSnapshot(f.teamA, f.s1), (e) => e.name === 'SnapshotError' && e.code === 'no_progress');
});

test('collects exactly this team on this scenario — ids preserved, nothing from other teams/scenarios', () => {
  startCyberRangeForTeam(f.teamA, f.s1);
  const { snapshot: s, json } = snap.buildSnapshot(f.teamA, f.s1, new Date(at(60)));
  const inv = s.untrustedStudentInvestigation;
  assert.deepEqual(inv.timelineEntries.map((e) => e.id), [ids.e1, ids.e2, ids.eLong]);
  assert.deepEqual(inv.canvas.nodes.map((n) => n.id).sort(), [ids.n1, ids.n2].sort());
  assert.deepEqual(inv.canvas.edges, [{ id: ids.edge, fromNodeId: ids.n1, toNodeId: ids.n2, label: 'then' }]);
  assert.equal(inv.instructorFeedback.length, 1);
  assert.equal(inv.instructorFeedback[0].entryId, ids.e1);
  assert.equal(inv.helpRequests.length, 1);
  assert.equal(inv.scores.length, 1);
  assert.equal(inv.timelineEntries[0].createdAt, at(10));
  assert.ok(!/SENTINEL/.test(json), 'no other team, scenario or answer-key text');
});

test('data minimisation: pseudonymous students, no images, no instructor names, no credited flags', () => {
  const { snapshot: s, json } = snap.buildSnapshot(f.teamA, f.s1, new Date(at(60)));
  const inv = s.untrustedStudentInvestigation;
  const staff = db.prepare("SELECT username, display_name AS d FROM users WHERE role = 'instructor' LIMIT 1").get();
  // Distinctive student names/usernames must not appear anywhere.
  for (const name of ['Realname', 'snap-alice', 'snap-bob']) assert.ok(!json.includes(name), `no real name or username: ${name}`);
  // Staff username/display name are common words ("instructor"), so check them as JSON values — where
  // an author/name field would put them.
  for (const name of [staff.username, staff.d]) assert.ok(!json.includes(`"${name}"`), `no staff identity: ${name}`);
  assert.deepEqual([...new Set(inv.timelineEntries.map((e) => e.author))], ['Student 1', 'Student 2']);
  assert.equal(inv.canvas.nodes.find((n) => n.id === ids.n1).author, 'Student 2', 'same pseudonym for the same student across timeline and canvas');
  assert.equal(inv.timelineEntries[1].hasImage, true);
  assert.ok(!json.includes('data:image'), 'image bytes never included');
  assert.deepEqual(inv.timelineEntries[0].ttps.map((t) => t.techniqueId), ['T1059.001'], 'removed tags excluded');
  assert.ok(!/credited/i.test(json));
  assert.ok(!('authorName' in inv.instructorFeedback[0]));
});

test('progress is never inferred: attack stage unknown; occurrences only as a labelled partial block', () => {
  const { snapshot: s } = snap.buildSnapshot(f.teamA, f.s1, new Date(at(60)));
  assert.deepEqual(s.attackProgress.attackStageProgress, 'unknown');
  assert.equal(s.recordedTechniqueOccurrences.reliability, 'partial');
  assert.equal(s.recordedTechniqueOccurrences.scope, 'scenario-wide, not per team');
  assert.match(s.recordedTechniqueOccurrences.meaning, /Absence means unknown/);
  assert.deepEqual(s.recordedTechniqueOccurrences.items, [{ techniqueId: 'T1566.001', occurredAt: at(2), source: 'manual' }]);
  assert.equal(s.exerciseState.status, 'active');
  assert.equal(s.exerciseState.entriesAfterTimeLimit, 1);
  // No occurrences recorded for S2 -> the block is null, not an empty "nothing happened" list.
  startCyberRangeForTeam(f.teamA, f.s2);
  assert.equal(snap.buildSnapshot(f.teamA, f.s2).snapshot.recordedTechniqueOccurrences, null);
  startCyberRangeForTeam(f.teamA, f.s1);
});

test('long text is capped with an explicit truncated flag', () => {
  const { snapshot: s } = snap.buildSnapshot(f.teamA, f.s1);
  const long = s.untrustedStudentInvestigation.timelineEntries.find((e) => e.id === ids.eLong);
  assert.equal(long.body.length, snap.SNAPSHOT_LIMITS.entryBody);
  assert.equal(long.bodyTruncated, true);
  assert.equal(s.untrustedStudentInvestigation.timelineEntries[0].bodyTruncated, false);
});

test('content hash is stable across time and changes when the investigation changes', () => {
  const a = snap.buildSnapshot(f.teamA, f.s1, new Date(at(60)));
  const b = snap.buildSnapshot(f.teamA, f.s1, new Date(at(95)));
  assert.equal(a.sha256, b.sha256);
  assert.notEqual(a.json, b.json, 'generatedAt / minutes differ');
  assert.equal(JSON.parse(a.json).generatedAt, at(60));
  const extra = entry(f.teamA, f.s1, ids.bob, 'one more note');
  assert.notEqual(snap.buildSnapshot(f.teamA, f.s1, new Date(at(60))).sha256, a.sha256);
  db.prepare('DELETE FROM documentation_entries WHERE id = ?').run(extra);
  assert.equal(snap.buildSnapshot(f.teamA, f.s1, new Date(at(60))).sha256, a.sha256);
});

test('building a snapshot never writes to the database', () => {
  const before = counts();
  const changesBefore = db.prepare('SELECT total_changes() AS n').get().n;
  snap.buildSnapshot(f.teamA, f.s1);
  snap.evidenceIndexFromSnapshot(snap.buildSnapshot(f.teamA, f.s1).snapshot);
  snap.leakScanContext(f.teamA, f.s1);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changesBefore);
  assert.deepEqual(counts(), before);
});

test('oversized investigation -> SnapshotError snapshot_too_large (never silently cut)', () => {
  startCyberRangeForTeam(f.teamNoOrg, f.s2);
  const author = student('snap-big', 'Big', f.teamNoOrg);
  for (let i = 0; i < 80; i++) entry(f.teamNoOrg, f.s2, author, 'x'.repeat(4000));
  assert.throws(() => snap.buildSnapshot(f.teamNoOrg, f.s2), (e) => e.code === 'snapshot_too_large');
});

test('evidence index is rebuilt from the stored JSON and matches what the agent saw', () => {
  const built = snap.buildSnapshot(f.teamA, f.s1);
  const index = snap.evidenceIndexFromSnapshot(JSON.parse(built.json));
  assert.equal(index.timeline_entry.get(ids.e1), 'we saw someone log into the server with an admin acount and then run weird powershell');
  assert.equal(index.timeline_entry.get(ids.eLong).length, snap.SNAPSHOT_LIMITS.entryBody);
  assert.equal(index.canvas_node.get(ids.n1), 'admin login on FS01\nseen in logs');
  assert.equal(index.canvas_edge.get(ids.edge), 'then');
  assert.equal(index.timeline_entry.size, 3);
});

test('leak-scan context: active expectations vs the team\'s own active tags', () => {
  assert.deepEqual(snap.leakScanContext(f.teamA, f.s1), { expectedTechniqueIds: ['T1059.001', 'T1566.001'], teamTaggedTechniqueIds: ['T1059.001'] });
});
