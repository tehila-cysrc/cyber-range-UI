import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import ExcelJS from 'exceljs';

// AI assessment — platform P6 (2026-10-18): the whole lifecycle end to end over HTTP with a FAKE
// Foundry (no network, no Azure, no model): upload -> pin -> live review -> post feedback (Posted) ->
// final -> decision -> scoped Excel export -> reset preview -> event reset -> replace document ->
// cleanup candidate -> approved (mock) cleanup -> rebuild. Official scores and the leaderboard are
// checked to be identical at every step.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-ai-e2e-')), 'test.db');
Object.assign(process.env, {
  AI_ASSESSMENT_ENABLED: 'true',
  FOUNDRY_PROJECT_ENDPOINT: 'https://fake-res.services.ai.azure.com/api/projects/fake',
  FOUNDRY_AGENT_NAME: 'cyber-range-assessor',
  FOUNDRY_AGENT_VERSION: '7',
  FOUNDRY_AGENT_CONTRACT_VERSION: '3',
  AZURE_TENANT_ID: '11111111-2222-3333-4444-555555555555',
  AZURE_CLIENT_ID: '66666666-7777-8888-9999-000000000000',
  AZURE_CLIENT_SECRET: 'fake-secret-value-for-tests-only',
});

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { createApp } = await import('../dist/app.js');
const { setFoundryClientForTests } = await import('../dist/services/ai/foundryClient.js');
const docs = await import('../dist/services/ai/scenarioAiDocuments.service.js');
const runner = await import('../dist/services/ai/assessmentRunner.service.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');
const { issueTokens } = await import('./fixtures/tokens.mjs');

let n = 0;
const ops = [];
const requests = [];
const fake = {
  async uploadFile({ filename }) { ops.push('uploadFile'); return { fileId: `assistant-E${++n}-${filename.length}` }; },
  async createVectorStore() { ops.push('createVectorStore'); return { vectorStoreId: `vs_E${++n}` }; },
  async waitForVectorStore() { return { ok: true, storeStatus: 'completed', fileStatus: 'completed', errorCode: null, usageBytes: 1 }; },
  async deleteVectorStore(id) { ops.push(`deleteVectorStore:${id}`); },
  async deleteFile(id) { ops.push(`deleteFile:${id}`); },
  async listInventory() { return { vectorStores: [], files: [], agentVersions: [], truncated: { vectorStores: false, files: false, agentVersions: false } }; },
  async invokeAssessment({ vectorStoreId, input }) {
    const req = JSON.parse(input);
    requests.push({ vectorStoreId, req });
    const entries = req.untrustedStudentInvestigation.timelineEntries;
    const e = entries[0];
    const result = req.mode === 'live'
      ? {
          status: 'partially_on_track', summary: 's', correctlyIdentified: [{ concept: 'Logon', judgement: 'correct', evidence: [{ type: 'timeline_entry', id: e.id, quote: null }], interpretation: 'i' }],
          partiallyUnderstood: [], missingOrUnclear: [], direction: { assessment: 'right_direction', explanation: 'x' }, instructorOnlyNotes: 'n',
          studentSafeFeedback: { teamLevel: 'Good start.', entryFeedback: [{ entryId: e.id, verdict: 'on_track', text: 'Which account?' }], guidingQuestion: null },
          suggestedEntryScores: [], confidence: { level: 'medium', reason: 'r' }, instructionLikeRecords: [], warnings: [],
        }
      : {
          investigationSummary: 's', overallAssessment: { level: 'fair', text: 't' },
          stages: [{ stage: 'Logon', judgement: 'correct', evidence: [{ type: 'timeline_entry', id: e.id, quote: null }], interpretation: 'i' }, { stage: 'Email', judgement: 'hypothesis', evidence: [{ type: 'timeline_entry', id: e.id, quote: null }], interpretation: 'i' }],
          incorrectConclusions: [], strengths: ['a'], areasForImprovement: ['b'],
          score: { criteria: req.rubric.criteria.map((c) => ({ key: c.key, maxPoints: c.maxPoints, awardedPoints: Math.round(c.maxPoints * 0.75), rationale: 'r' })), recommendedTotal: 75, maxTotal: 100, explanation: 'e' },
          suggestedFinalFeedback: { instructorVersion: 'iv', studentSafeVersion: 'Well done.' }, confidence: { level: 'high', reason: 'r' }, instructionLikeRecords: [], warnings: [],
        };
    return { outputText: JSON.stringify({ contractVersion: '3', mode: req.mode, result }), responseId: 'r', responseStatus: 'completed', incompleteReason: null, model: 'gpt-4.1', agentName: 'cyber-range-assessor', agentVersion: '7', usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 }, fileSearchCalls: 1 };
  },
};

let f, tok, server, base;
async function call(method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* binary */ }
  return { status: res.status, body: parsed, text };
}
const official = () => ({
  total: db.prepare('SELECT COALESCE(SUM(points), 0) AS s FROM scores').get().s,
  rows: db.prepare('SELECT COUNT(*) AS c FROM scores').get().c,
});

before(async () => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  tok = issueTokens(db, f);
  setFoundryClientForTests(fake);
  await new Promise((resolve) => (server = createApp().listen(0, '127.0.0.1', resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  setFoundryClientForTests(null);
  server?.close();
});

test('AI assessment lifecycle end to end (mocked Foundry); official scores never change', async () => {
  const pdf = (s) => ({ filename: `ref-${s}.pdf`, contentBase64: Buffer.from(`%PDF-1.4 ${s}`).toString('base64') });
  // 1. The scoped instructor uploads the reference document for their scenario.
  assert.equal((await call('POST', `/api/admin/cyber-ranges/${f.s1}/ai-documents`, tok.iA, pdf('v1'))).status, 202);
  await docs.waitForAiIndexingIdle();
  const v1 = db.prepare('SELECT id, foundry_vector_store_id AS vs FROM scenario_ai_documents WHERE cyber_range_id = ? AND version = 1').get(f.s1);

  // 2. Team A starts (admin action) -> pinned to v1; a student writes; an official score exists.
  assert.equal((await call('POST', `/api/admin/teams/${f.teamA}/cyber-ranges/${f.s1}/start`, tok.admin)).status, 200);
  assert.equal(db.prepare('SELECT ai_document_id AS d FROM team_cyber_range_progress WHERE team_id = ? AND cyber_range_id = ?').get(f.teamA, f.s1).d, v1.id);
  const entry = await call('POST', `/api/cyber-ranges/${f.s1}/documentation`, tok.studentA, { body: 'someone logged in to FS01 with an admin account' });
  assert.equal(entry.status, 201, entry.text);
  const entryId = entry.body.entry.id;
  assert.equal((await call('POST', '/api/admin/scores', tok.admin, { teamId: f.teamA, cyberRangeId: f.s1, points: 15, note: 'official' })).status, 201);
  const before = official();

  // 3. Live review (request carries contract "3" from FOUNDRY_AGENT_CONTRACT_VERSION, v1's store).
  const live = await call('POST', '/api/admin/ai-assessments', tok.iA, { teamId: f.teamA, cyberRangeId: f.s1, mode: 'live' });
  assert.equal(live.status, 202, live.text);
  await runner.waitForAiAssessmentsIdle();
  assert.equal(requests.at(-1).req.contractVersion, '3');
  assert.equal(requests.at(-1).vectorStoreId, v1.vs);
  let d = (await call('GET', `/api/admin/ai-assessments/${live.body.assessment.id}`, tok.iA)).body.assessment;
  assert.equal(d.status, 'succeeded');
  assert.equal(d.contractVersion, '3');

  // 4. The instructor posts the suggestion through the existing form -> "Posted" from saved feedback.
  assert.equal((await call('POST', `/api/cyber-ranges/${f.s1}/documentation/${entryId}/feedback`, tok.iA, { verdict: 'on_track', body: 'Which account was it?', sourceAiAssessmentId: d.id })).status, 201);
  d = (await call('GET', `/api/admin/ai-assessments/${d.id}`, tok.iA)).body.assessment;
  assert.deepEqual(d.postedEntryIds, [entryId]);

  // 5. Final + approval (recorded only).
  const fin = await call('POST', '/api/admin/ai-assessments', tok.iA, { teamId: f.teamA, cyberRangeId: f.s1, mode: 'final' });
  assert.equal(fin.status, 202, fin.text);
  await runner.waitForAiAssessmentsIdle();
  const finalId = fin.body.assessment.id;
  assert.equal((await call('POST', `/api/admin/ai-assessments/${finalId}/decision`, tok.iA, { decision: 'edited', score: 70, note: 'Fair, a bit generous.' })).status, 200);
  assert.deepEqual(official(), before);

  // 6. Scoped Excel export carries the approved AI assessment on its own sheet.
  const xlsx = await fetch(`${base}/api/admin/results/export?format=xlsx`, { headers: { Authorization: `Bearer ${tok.iA}` } });
  assert.equal(xlsx.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
  const sheet = wb.getWorksheet('AI Assessment');
  assert.ok(sheet, 'AI Assessment sheet');
  const cells = [];
  sheet.eachRow((row) => cells.push(row.values.join('|')));
  assert.ok(cells.some((c) => c.includes('Approved (edited score)') && c.includes('70')), cells.join('\n'));

  // 7. Reset preview warns; the reset wipes RUN data (assessments, pins) and keeps the documents.
  const preview = await call('GET', '/api/admin/event/reset-preview', tok.admin);
  assert.deepEqual(preview.body.aiAssessments, { total: 2, approvedFinals: 1 });
  const reset = await call('POST', '/api/admin/event/reset', tok.admin, { confirm: 'RESET EVENT' });
  assert.equal(reset.status, 202, reset.text);
  for (let i = 0; i < 100; i++) {
    const job = (await call('GET', `/api/event-reset-jobs/${reset.body.jobId}`)).body.job;
    if (job.state !== 'running') {
      assert.equal(job.state, 'done', JSON.stringify(job));
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM ai_assessments').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM scenario_ai_documents WHERE cyber_range_id = ?').get(f.s1).c, 1);

  // 8. Replacing the document makes v1 an unpinned, superseded candidate; nothing is deleted on its own.
  const admin2 = (await call('POST', '/api/auth/login', null, { username: 'instructor', password: 'instructor123' })).body.token;
  assert.ok(admin2, 'admin can still sign in after the reset');
  assert.equal((await call('POST', `/api/admin/cyber-ranges/${f.s1}/ai-documents`, admin2, pdf('v2'))).status, 202);
  await docs.waitForAiIndexingIdle();
  assert.ok(!ops.some((o) => o.startsWith('delete')), 'no automatic deletion');
  const candidates = (await call('GET', '/api/admin/ai/foundry-resources', admin2)).body.resources.filter((r) => r.documentId === v1.id);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((r) => r.cleanupReason === 'superseded_unpinned'));

  // 9. Approved cleanup (mock), then rebuild of that version from the stored bytes.
  const clean = await call('POST', '/api/admin/ai/foundry-resources/cleanup', admin2, { resourceIds: candidates.map((r) => r.id) });
  assert.equal(clean.status, 200);
  assert.equal(clean.body.deleted.length, 2);
  assert.ok(db.prepare('SELECT foundry_deleted_at AS d FROM scenario_ai_documents WHERE id = ?').get(v1.id).d);
  assert.equal((await call('POST', `/api/admin/cyber-ranges/${f.s1}/ai-documents/${v1.id}/rebuild`, admin2)).status, 202);
  await docs.waitForAiIndexingIdle();
  assert.equal(db.prepare('SELECT foundry_deleted_at AS d FROM scenario_ai_documents WHERE id = ?').get(v1.id).d, null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
