import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import ExcelJS from 'exceljs';

// Scoped results export (user decision 2026-10-18): instructors export only their assigned
// (organization, scenario) pairs; the global export stays admin-only. Isolated DB.
// Fixture: iA holds (A,S1); iAB holds (A,S1) and (B,S2). Team A works on S1 AND S2, Team B on S2,
// Team NoOrg on S1. iAB must NOT receive A's work on S2 (the cross product).
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-scoped-export-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { createApp } = await import('../dist/app.js');
const { startCyberRangeForTeam } = await import('../dist/services/cyberRangeProgress.service.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');
const { issueTokens } = await import('./fixtures/tokens.mjs');

let f, tok, server, base;
const at = () => new Date().toISOString();

async function get(path, token) {
  const res = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    /* xlsx */
  }
  return { status: res.status, buf, json, disposition: res.headers.get('content-disposition') };
}

function entry(teamId, rangeId, userId, body) {
  db.prepare('INSERT INTO documentation_entries (team_id, cyber_range_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(teamId, rangeId, userId, body, at());
}
function score(teamId, rangeId, studentId, points, note) {
  db.prepare("INSERT INTO scores (team_id, cyber_range_id, student_user_id, points, note, created_at, source) VALUES (?, ?, ?, ?, ?, ?, 'manual')").run(teamId, rangeId, studentId, points, note, at());
}
function approvedFinal(teamId, rangeId, total) {
  db.prepare(
    `INSERT INTO ai_assessments (team_id, cyber_range_id, mode, status, document_version, document_sha256, snapshot_json, snapshot_sha256,
       agent_name, contract_version, requested_by_username, created_at, result_json, decision, decided_score, decided_by_username, decided_at)
     VALUES (?, ?, 'final', 'succeeded', 1, 'sha', '{}', 'h', 'agent', '1', 'admin', ?, ?, 'approved', ?, 'admin', ?)`,
  ).run(teamId, rangeId, at(), JSON.stringify({ result: { investigationSummary: `AI-${teamId}-${rangeId}`, score: { recommendedTotal: total, maxTotal: 100 } } }), total, at());
}

before(async () => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  tok = issueTokens(db, f);
  startCyberRangeForTeam(f.teamA, f.s2);
  startCyberRangeForTeam(f.teamA, f.s1); // A has sessions on S1 (active) and S2 (paused)
  startCyberRangeForTeam(f.teamB, f.s2);
  startCyberRangeForTeam(f.teamNoOrg, f.s1);
  const { studentA, studentB } = tok.ids;
  entry(f.teamA, f.s1, studentA, 'SECRET-A-S1 entry');
  entry(f.teamA, f.s2, studentA, 'SECRET-A-S2 entry');
  entry(f.teamB, f.s2, studentB, 'SECRET-B-S2 entry');
  score(f.teamA, f.s1, studentA, 10, 'A on S1');
  score(f.teamA, f.s2, studentA, 7, 'A on S2');
  score(f.teamA, null, studentA, 3, 'A unscoped bonus');
  score(f.teamB, f.s2, studentB, 5, 'B on S2');
  approvedFinal(f.teamA, f.s1, 70);
  approvedFinal(f.teamA, f.s2, 60);
  approvedFinal(f.teamB, f.s2, 50);
  await new Promise((resolve) => (server = createApp().listen(0, '127.0.0.1', resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

const teamNames = (json) => json.teams.map((t) => t.name).sort();
const scenarioNames = (json, team) => json.teams.find((t) => t.name === team).scenarios.map((s) => s.name).sort();

test('the global export stays admin-only; the scoped route needs results.export', async () => {
  assert.equal((await get('/api/admin/event/export', tok.iA)).status, 403);
  assert.equal((await get('/api/admin/event/export', tok.iAB)).status, 403);
  assert.equal((await get('/api/admin/event/export', tok.admin)).status, 200);
  assert.equal((await get('/api/admin/results/export', tok.studentA)).status, 403);
  assert.equal((await get('/api/admin/results/export')).status, 401);
});

test('iA (A,S1): only Team A, only S1; no S2 work, no unscoped score; totals and student points count S1 only', async () => {
  const r = await get('/api/admin/results/export', tok.iA);
  assert.equal(r.status, 200);
  assert.match(r.disposition, /cyber-range-results-assigned-/);
  assert.equal(r.json.scope, 'assigned');
  assert.deepEqual(teamNames(r.json), ['Team A']);
  assert.deepEqual(scenarioNames(r.json, 'Team A'), ['S1']);
  const text = JSON.stringify(r.json);
  for (const leak of ['SECRET-A-S2', 'SECRET-B-S2', 'A on S2', 'A unscoped bonus', 'Team B', 'Team NoOrg']) assert.ok(!text.includes(leak), `must not contain ${leak}`);
  const a = r.json.teams[0];
  assert.equal(a.totalPoints, 10);
  assert.deepEqual(a.otherScores, []);
  assert.equal(a.members.find((m) => m.username === 'stu-a').points, 10, 'student points only from in-scope scenarios');
});

test('iAB (A,S1)+(B,S2): Team A on S1 and Team B on S2 — never A on S2 (cross product)', async () => {
  const r = await get('/api/admin/results/export', tok.iAB);
  assert.equal(r.status, 200);
  assert.deepEqual(teamNames(r.json), ['Team A', 'Team B']);
  assert.deepEqual(scenarioNames(r.json, 'Team A'), ['S1']);
  assert.deepEqual(scenarioNames(r.json, 'Team B'), ['S2']);
  const text = JSON.stringify(r.json);
  assert.ok(!text.includes('SECRET-A-S2') && text.includes('SECRET-B-S2') && text.includes('SECRET-A-S1'));
  assert.ok(!text.includes('Team NoOrg'));
});

test('?teamId= must be a team of an assigned organization (404 + audit), and narrows to it', async () => {
  assert.equal((await get(`/api/admin/results/export?teamId=${f.teamB}`, tok.iA)).status, 404);
  assert.equal((await get(`/api/admin/results/export?teamId=${f.teamNoOrg}`, tok.iAB)).status, 404);
  assert.equal((await get('/api/admin/results/export?teamId=999999', tok.iA)).status, 404);
  assert.equal((await get('/api/admin/results/export?teamId=abc', tok.iA)).status, 400);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'authz.denied' AND metadata_json LIKE '%out_of_scope%'").get());
  const r = await get(`/api/admin/results/export?teamId=${f.teamB}`, tok.iAB);
  assert.deepEqual(teamNames(r.json), ['Team B']);
});

test('xlsx: same 8 sheets; Summary, Timeline, Scores, Students and the AI sheet are filtered to the pairs', async () => {
  const r = await get('/api/admin/results/export?format=xlsx', tok.iA);
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Timeline', 'Scores', 'Students', 'Canvas', 'Help requests', 'ATT&CK credits', 'AI Assessment']);
  const values = (name) => {
    const out = [];
    wb.getWorksheet(name).eachRow((row) => out.push(JSON.stringify(row.values)));
    return out.join('\n');
  };
  const all = wb.worksheets.map((w) => values(w.name)).join('\n');
  for (const leak of ['SECRET-A-S2', 'SECRET-B-S2', 'A on S2', 'A unscoped bonus', 'Team B', 'Team NoOrg', 'AI-' + f.teamA + '-' + f.s2]) assert.ok(!all.includes(leak), `xlsx must not contain ${leak}`);
  assert.ok(values('Timeline').includes('SECRET-A-S1'));
  assert.ok(values('AI Assessment').includes(`AI-${f.teamA}-${f.s1}`));
  assert.equal(r.disposition.includes('-assigned-'), true);
});

test('admin on the scoped route gets everything (same teams as the global export); nothing is written', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS s FROM scores').get();
  const scoped = await get('/api/admin/results/export', tok.admin);
  const global = await get('/api/admin/event/export', tok.admin);
  assert.equal(scoped.json.scope, undefined);
  assert.deepEqual(teamNames(scoped.json), teamNames(global.json));
  assert.deepEqual({ ...scoped.json, exportedAt: null }, { ...global.json, exportedAt: null });
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS s FROM scores').get(), before);
});
