import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';
import ExcelJS from 'exceljs';

// AI assessment — Phase 7: the "AI Assessment" worksheet of the team results workbook. Isolated DB, no
// Foundry at all (assessment rows are inserted directly). Guarantees: every pre-existing worksheet keeps
// its name, order and every cell value; the AI sheet is appended last; only APPROVED finals appear; the
// JSON archive and score totals are unchanged.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-ai-export-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { buildEventExport, buildEventExportXlsx } = await import('../dist/services/eventExport.service.js');
const { startCyberRangeForTeam } = await import('../dist/services/cyberRangeProgress.service.js');
const { AI_SHEET_NAME, AI_SHEET_NOTE } = await import('../dist/services/ai/aiAssessmentExport.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');

let f;
let t = 0;
const at = () => new Date(Date.UTC(2026, 9, 15, 9, 0, t++)).toISOString();

function finalResult(total, extra = {}) {
  return JSON.stringify({
    result: {
      investigationSummary: `Summary ${total}`,
      overallAssessment: { level: 'good', text: 't' },
      stages: [],
      incorrectConclusions: [],
      strengths: ['Found the logon'],
      areasForImprovement: ['Link the phishing mail'],
      score: { criteria: [], recommendedTotal: total, maxTotal: 100, explanation: 'e' },
      suggestedFinalFeedback: { instructorVersion: 'SECRET-INSTRUCTOR-VERSION', studentSafeVersion: `Well done ${total}.` },
      confidence: { level: 'high', reason: 'r' },
      warnings: [],
      instructorOnlyNotes: 'SECRET-NOTES',
      ...extra,
    },
    flags: { leakSuspected: false },
  });
}

function insertFinal(teamId, rangeId, { total = 70, status = 'succeeded', decision = null, decidedScore = null, note = null, mode = 'final' } = {}) {
  return Number(
    db
      .prepare(
        `INSERT INTO ai_assessments (team_id, cyber_range_id, mode, status, document_version, document_sha256, snapshot_json, snapshot_sha256,
           agent_name, agent_version, model, contract_version, requested_by_username, created_at, result_json, decision, decided_score,
           decision_note, decided_by_username, decided_at)
         VALUES (?, ?, ?, ?, 2, 'sha', '{}', 'h', 'cyber-range-assessor', '5', 'gpt-4.1', '1', 'admin', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(teamId, rangeId, mode, status, at(), status === 'succeeded' ? finalResult(total) : null, decision, decidedScore, note, decision ? 'instructor' : null, decision ? at() : null)
      .lastInsertRowid,
  );
}

async function readBook(teamId) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildEventExportXlsx(teamId));
  return wb;
}
const sheetValues = (ws) => {
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row) => rows.push(JSON.stringify(row.values)));
  return rows;
};
const aiRows = (wb) => {
  const ws = wb.getWorksheet(AI_SHEET_NAME);
  const cols = ws.getRow(2).cellCount;
  const header = Array.from({ length: cols }, (_, c) => ws.getRow(2).getCell(c + 1).value);
  const out = [];
  for (let i = 3; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    out.push(Object.fromEntries(header.map((h, c) => [h, row.getCell(c + 1).value ?? ''])));
  }
  return out;
};
const scoreState = () => db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS s FROM scores').get();

before(() => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  startCyberRangeForTeam(f.teamA, f.s1);
  startCyberRangeForTeam(f.teamA, f.s2); // pauses S1; both are sessions
  startCyberRangeForTeam(f.teamB, f.s2);
  startCyberRangeForTeam(f.teamNoOrg, f.s1);
  db.prepare("INSERT INTO scores (team_id, cyber_range_id, points, note, created_at, source) VALUES (?, ?, 15, 'official', ?, 'manual')").run(f.teamA, f.s1, at());
});

test('existing worksheets, the JSON archive and score totals are unchanged; the AI sheet is appended last', async () => {
  const beforeBook = await readBook();
  const beforeJson = buildEventExport({ includeImages: true });
  const beforeScores = scoreState();
  const names = beforeBook.worksheets.map((w) => w.name);
  assert.equal(names.at(-1), AI_SHEET_NAME);
  assert.deepEqual(names.slice(0, -1), ['Summary', 'Timeline', 'Scores', 'Students', 'Canvas', 'Help requests', 'ATT&CK credits']);

  // Approve a final with a score far above the team's points: nothing else in the workbook may move.
  insertFinal(f.teamA, f.s1, { total: 95, decision: 'approved', decidedScore: 95 });
  const afterBook = await readBook();
  assert.deepEqual(afterBook.worksheets.map((w) => w.name), names);
  for (const name of names.slice(0, -1)) {
    assert.deepEqual(sheetValues(afterBook.getWorksheet(name)), sheetValues(beforeBook.getWorksheet(name)), `sheet ${name} unchanged`);
  }
  const afterJson = buildEventExport({ includeImages: true });
  assert.deepEqual({ ...afterJson, exportedAt: null }, { ...beforeJson, exportedAt: null }, 'JSON archive unchanged');
  assert.ok(!JSON.stringify(afterJson).includes('Summary 95'), 'no AI data in the JSON archive');
  assert.deepEqual(scoreState(), beforeScores);
});

test('rows: Approved / Approved (edited score) / No approved AI assessment; latest approved wins; instructor-only text never exported', async () => {
  // teamA/S1 already has an approved 95 (previous test); a LATER rejected final does not hide it.
  insertFinal(f.teamA, f.s1, { total: 40, decision: 'rejected' });
  // teamA/S2: an older approved, then a newer edited -> the edited one.
  insertFinal(f.teamA, f.s2, { total: 70, decision: 'approved', decidedScore: 70 });
  const edited = insertFinal(f.teamA, f.s2, { total: 70, decision: 'edited', decidedScore: 55, note: 'Missed the mail server' });
  // teamB/S2: rejected only; plus an undecided final and a failed one -> none count.
  insertFinal(f.teamB, f.s2, { total: 30, decision: 'rejected' });
  insertFinal(f.teamB, f.s2, { total: 80 });
  insertFinal(f.teamB, f.s2, { status: 'failed' });

  const wb = await readBook();
  const ws = wb.getWorksheet(AI_SHEET_NAME);
  assert.equal(ws.getRow(1).getCell(1).value, AI_SHEET_NOTE);
  assert.equal(ws.getRow(2).getCell(1).value, 'Team');
  const rows = aiRows(wb);
  const row = (teamName, scenario) => rows.find((r) => r.Team === teamName && r.Scenario === scenario);
  const name = (id) => db.prepare('SELECT name FROM teams WHERE id = ?').get(id).name;
  const rname = (id) => db.prepare('SELECT name FROM cyber_ranges WHERE id = ?').get(id).name;

  const a1 = row(name(f.teamA), rname(f.s1));
  assert.equal(a1.Status, 'Approved');
  assert.equal(a1['Approved final score'], 95);
  assert.equal(a1['AI recommended score'], 95);
  assert.equal(a1['Max score'], 100);
  assert.equal(a1['Ground-truth version'], 2);
  assert.equal(a1['Student-safe final feedback'], 'Well done 95.');

  const a2 = row(name(f.teamA), rname(f.s2));
  assert.equal(a2.Status, 'Approved (edited score)');
  assert.equal(a2['Approved final score'], 55);
  assert.equal(a2['AI recommended score'], 70);
  assert.equal(a2['Instructor decision note'], 'Missed the mail server');
  assert.equal(a2['Assessment ID'], edited);
  assert.equal(a2['Decided by'], 'instructor');

  for (const r of [row(name(f.teamB), rname(f.s2)), row(name(f.teamNoOrg), rname(f.s1))]) {
    assert.equal(r.Status, 'No approved AI assessment');
    assert.equal(r['Approved final score'], '');
    assert.equal(r['Investigation summary'], '');
  }
  assert.equal(rows.length, 4, 'one row per team scenario session');

  const all = JSON.stringify(sheetValues(ws));
  assert.ok(!all.includes('SECRET-INSTRUCTOR-VERSION') && !all.includes('SECRET-NOTES'), 'instructor-only analysis is not exported');
});

test('teamId limits the AI sheet to that team, like the rest of the workbook', async () => {
  const wb = await readBook(f.teamB);
  const rows = aiRows(wb);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Status, 'No approved AI assessment');
  assert.equal(wb.worksheets.at(-1).name, AI_SHEET_NAME);
});
