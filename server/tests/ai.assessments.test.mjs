import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// AI assessment — Phase 5: jobs + routes. Isolated DB, FAKE Foundry (scripted invokeAssessment). No
// network, no Azure resources, no model calls. Central guarantees checked: pair-scoped access, the
// session's PINNED store is used, failures store no result, nothing touches official scores or
// student-visible feedback.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-ai-assess-')), 'test.db');
Object.assign(process.env, {
  AI_ASSESSMENT_ENABLED: 'true',
  FOUNDRY_PROJECT_ENDPOINT: 'https://fake-res.services.ai.azure.com/api/projects/fake',
  FOUNDRY_AGENT_NAME: 'cyber-range-assessor',
  FOUNDRY_AGENT_VERSION: '5',
  AZURE_TENANT_ID: '11111111-2222-3333-4444-555555555555',
  AZURE_CLIENT_ID: '66666666-7777-8888-9999-000000000000',
  AZURE_CLIENT_SECRET: 'fake-secret-value-for-tests-only',
  AI_MAX_CONCURRENT: '3',
});

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { createApp } = await import('../dist/app.js');
const { setFoundryClientForTests, FoundryError } = await import('../dist/services/ai/foundryClient.js');
const docs = await import('../dist/services/ai/scenarioAiDocuments.service.js');
const runner = await import('../dist/services/ai/assessmentRunner.service.js');
const { startCyberRangeForTeam } = await import('../dist/services/cyberRangeProgress.service.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');
const { issueTokens } = await import('./fixtures/tokens.mjs');

// ---------------------------------------------------------------------------------------------
// Fake Foundry. invokeAssessment pops scripted replies; a reply may be a function (gets the request)
// or a FoundryError to throw; `hold` makes the next call wait until released.
let n = 0;
const fake = {
  calls: [],
  script: [],
  hold: null,
  async uploadFile() { return { fileId: `assistant-F${++n}` }; },
  async createVectorStore() { return { vectorStoreId: `vs_V${++n}` }; },
  async waitForVectorStore() { return { ok: true, storeStatus: 'completed', fileStatus: 'completed', errorCode: null, usageBytes: 1 }; },
  async deleteVectorStore(id) { this.calls.push({ op: 'deleteVectorStore', id }); },
  async deleteFile(id) { this.calls.push({ op: 'deleteFile', id }); },
  async invokeAssessment(req) {
    this.calls.push({ op: 'invoke', ...req });
    if (this.hold) await this.hold.promise;
    const next = this.script.shift();
    if (!next) throw new Error('unexpected invoke');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(req) : next;
  },
};
const invokes = () => fake.calls.filter((c) => c.op === 'invoke');
function holdNext() {
  let release;
  const promise = new Promise((r) => (release = r));
  fake.hold = { promise };
  return () => {
    fake.hold = null;
    release();
  };
}
const reply = (body, { fileSearchCalls = 1, raw } = {}) => ({
  outputText: raw ?? JSON.stringify(body),
  responseId: 'resp_x',
  responseStatus: 'completed',
  incompleteReason: null,
  model: 'gpt-4.1',
  agentName: 'cyber-range-assessor',
  agentVersion: '5',
  usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 200 },
  fileSearchCalls,
});

let f, tok, server, base, E = {};
const ev = (id, quote = null) => ({ type: 'timeline_entry', id, quote });
function liveBody(over = {}) {
  return {
    contractVersion: '2', mode: 'live',
    result: {
      status: 'partially_on_track',
      summary: 'Spotted the admin logon.',
      correctlyIdentified: [{ concept: 'Privileged logon', judgement: 'correct', evidence: [ev(E.e1, 'admin acount')], interpretation: 'ok' }],
      partiallyUnderstood: [],
      missingOrUnclear: [{ topic: 'Initial access', expectedByNow: 'unknown', whyItMatters: 'x', evidence: [] }],
      direction: { assessment: 'right_direction', explanation: 'x' },
      instructorOnlyNotes: 'Step 1 (T1566.001) not found yet.',
      studentSafeFeedback: { teamLevel: 'Good start.', entryFeedback: [{ entryId: E.e1, verdict: 'on_track', text: 'Which account?' }], guidingQuestion: null },
      suggestedEntryScores: [],
      confidence: { level: 'medium', reason: 'x' },
      warnings: [],
      ...over,
    },
  };
}
function finalBody(total = 70) {
  return {
    contractVersion: '2', mode: 'final',
    result: {
      investigationSummary: 's', overallAssessment: { level: 'good', text: 't' },
      stages: [{ stage: 'Logon', judgement: 'correct', evidence: [ev(E.e1)], interpretation: 'i' }],
      incorrectConclusions: [], strengths: ['a'], areasForImprovement: ['b'],
      score: {
        criteria: [
          { key: 'identification', maxPoints: 40, awardedPoints: 28, rationale: 'r' },
          { key: 'understanding', maxPoints: 30, awardedPoints: 22, rationale: 'r' },
          { key: 'connections', maxPoints: 20, awardedPoints: 12, rationale: 'r' },
          { key: 'clarity', maxPoints: 10, awardedPoints: 8, rationale: 'r' },
        ],
        recommendedTotal: total, maxTotal: 100, explanation: 'e',
      },
      suggestedFinalFeedback: { instructorVersion: 'iv', studentSafeVersion: 'Well done.' },
      confidence: { level: 'high', reason: 'r' }, warnings: [],
    },
  };
}

async function call(method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}
const request = (token, teamId, cyberRangeId, mode, extra = {}) => call('POST', '/api/admin/ai-assessments', token, { teamId, cyberRangeId, mode, ...extra });
const detail = (id, token = tok.admin) => call('GET', `/api/admin/ai-assessments/${id}`, token);
const settle = () => runner.waitForAiAssessmentsIdle();
const officialState = () => ({
  scores: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS s FROM scores').get(),
  feedback: db.prepare('SELECT COUNT(*) AS n FROM documentation_feedback').get().n,
});
let officialBefore;

before(async () => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  tok = issueTokens(db, f);
  setFoundryClientForTests(fake);
  await new Promise((resolve) => (server = createApp().listen(0, '127.0.0.1', resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
  const pdf = (s) => ({ filename: 'ref.pdf', contentBase64: Buffer.from(`%PDF-1.4 ${s}`).toString('base64') });
  // Ground truth v1 for S1 and S2; sessions start AFTER, so they pin v1.
  for (const r of [f.s1, f.s2]) await call('POST', `/api/admin/cyber-ranges/${r}/ai-documents`, tok.admin, pdf(`v1-${r}`));
  await docs.waitForAiIndexingIdle();
  startCyberRangeForTeam(f.teamA, f.s1);
  startCyberRangeForTeam(f.teamB, f.s2);
  startCyberRangeForTeam(f.teamNoOrg, f.s1);
  const studentA = tok.ids.studentA;
  E.e1 = Number(db.prepare("INSERT INTO documentation_entries (team_id, cyber_range_id, author_user_id, body, created_at) VALUES (?, ?, ?, 'someone used an admin acount then weird powershell', ?)").run(f.teamA, f.s1, studentA, new Date().toISOString()).lastInsertRowid);
  db.prepare("INSERT INTO scores (team_id, cyber_range_id, points, note, created_at, source) VALUES (?, ?, 15, 'official', ?, 'manual')").run(f.teamA, f.s1, new Date().toISOString());
  // v2 of S1 replaces v1 — teamA's session must keep v1.
  await call('POST', `/api/admin/cyber-ranges/${f.s1}/ai-documents`, tok.admin, pdf('v2-s1'));
  await docs.waitForAiIndexingIdle();
  officialBefore = officialState();
});

after(() => {
  setFoundryClientForTests(null);
  server?.close();
});

// ---------------------------------------------------------------------------------------------

test('request validation: strict body, ids must be positive integers', async () => {
  for (const body of [{}, { teamId: '1', cyberRangeId: 1, mode: 'live' }, { teamId: 1, cyberRangeId: 1, mode: 'weekly' }, { teamId: f.teamA, cyberRangeId: f.s1, mode: 'live', vectorStoreId: 'vs_evil' }]) {
    const r = await call('POST', '/api/admin/ai-assessments', tok.admin, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.reason, 'invalid_request');
  }
  assert.equal((await call('GET', '/api/admin/ai-assessments?teamId=x&cyberRangeId=1', tok.admin)).status, 400);
  assert.equal(invokes().length, 0);
});

test('pair scope: only (organization, scenario) pairs the instructor holds; no cross product; no-org teams admin-only', async () => {
  // iA holds (A,S1) only. Team B (org B) on S2 -> 404, audited.
  assert.equal((await request(tok.iA, f.teamB, f.s2, 'live')).status, 404);
  // iAB holds (A,S1) and (B,S2): A's work on S2 is NOT in scope (cross product).
  startCyberRangeForTeam(f.teamA, f.s2);
  assert.equal((await request(tok.iAB, f.teamA, f.s2, 'live')).status, 404);
  startCyberRangeForTeam(f.teamA, f.s1);
  // A team without an organization is admin-only.
  assert.equal((await request(tok.iA, f.teamNoOrg, f.s1, 'live')).status, 404);
  assert.equal((await call('GET', `/api/admin/ai-assessments?teamId=${f.teamB}&cyberRangeId=${f.s2}`, tok.iA)).status, 404);
  // Unknown team -> the same 404.
  assert.equal((await request(tok.admin, 999999, f.s1, 'live')).status, 404);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'authz.denied' AND metadata_json LIKE '%out_of_scope%'").get());
  assert.equal(invokes().length, 0);
});

test('live assessment: 202 -> succeeded; uses the session\'s PINNED store; pseudonyms only to Foundry; real names only in the staff detail', async () => {
  fake.script.push(reply(liveBody()));
  const r = await request(tok.iA, f.teamA, f.s1, 'live');
  assert.equal(r.status, 202, r.text);
  assert.equal(r.body.reused, false);
  assert.equal(r.body.assessment.status, 'pending');
  await settle();
  const [inv] = invokes();
  const v1 = db.prepare('SELECT foundry_vector_store_id AS v FROM scenario_ai_documents WHERE cyber_range_id = ? AND version = 1').get(f.s1).v;
  assert.equal(inv.vectorStoreId, v1, 'pinned v1, not the current v2');
  const sent = JSON.parse(inv.input);
  assert.equal(sent.mode, 'live');
  assert.equal(sent.scenario.groundTruthVersion, 1);
  assert.equal(sent.rubric, null);
  assert.equal(sent.attackProgress.attackStageProgress, 'unknown');
  assert.equal(sent.untrustedStudentInvestigation.timelineEntries[0].author, 'Student 1');
  assert.ok(!inv.input.includes('stu-a'), 'no real usernames sent');
  assert.ok(!('instructions' in sent) && !('text' in sent));

  const d = (await detail(r.body.assessment.id, tok.iA)).body.assessment;
  assert.equal(d.status, 'succeeded');
  assert.equal(d.agentVersion, '5');
  assert.equal(d.documentVersion, 1);
  assert.equal(d.result.result.status, 'partially_on_track');
  assert.equal(d.result.flags.leakSuspected, false);
  assert.equal(d.evidenceIndex.timeline_entry[E.e1].author, 'stu-a', 'staff UI maps the record id back to the real student');
  assert.ok(!('snapshotJson' in d) && !('rawOutputExcerpt' in d));
});

test('unchanged work is reused (no new model call); force runs again', async () => {
  const before = invokes().length;
  const again = await request(tok.iA, f.teamA, f.s1, 'live');
  assert.equal(again.status, 200);
  assert.equal(again.body.reused, true);
  assert.equal(invokes().length, before);
  fake.script.push(reply(liveBody()));
  const forced = await request(tok.iA, f.teamA, f.s1, 'live', { force: true });
  assert.equal(forced.status, 202);
  await settle();
  assert.equal(invokes().length, before + 1);
});

test('one job at a time per team/scenario/mode; global concurrency cap', async () => {
  const release = holdNext();
  fake.script.push(reply(liveBody()));
  const first = await request(tok.admin, f.teamA, f.s1, 'live', { force: true });
  assert.equal(first.status, 202);
  const second = await request(tok.admin, f.teamA, f.s1, 'live', { force: true });
  assert.deepEqual([second.status, second.body.reason], [409, 'assessment_in_progress']);
  process.env.AI_MAX_CONCURRENT = '1';
  const other = await request(tok.admin, f.teamB, f.s2, 'live');
  assert.deepEqual([other.status, other.body.reason], [429, 'ai_busy']);
  process.env.AI_MAX_CONCURRENT = '3';
  release();
  await settle();
});

test('a retryable invalid reply is retried once; a second failure stores NO result and nothing is returned', async () => {
  fake.script.push(reply(null, { raw: 'Sure! Here is my assessment...' }), reply(liveBody()));
  const ok = await request(tok.admin, f.teamA, f.s1, 'live', { force: true });
  await settle();
  assert.equal((await detail(ok.body.assessment.id)).body.assessment.status, 'succeeded');

  const before = invokes().length;
  fake.script.push(reply(null, { raw: 'not json SECRET-GROUND-TRUTH-ECHO' }), reply(null, { raw: '{"also": "bad"}' }));
  const bad = await request(tok.admin, f.teamA, f.s1, 'live', { force: true });
  await settle();
  assert.equal(invokes().length, before + 2);
  const d = (await detail(bad.body.assessment.id)).body;
  assert.equal(d.assessment.status, 'failed');
  assert.equal(d.assessment.errorCode, 'invalid_response');
  assert.equal(d.assessment.result, null);
  assert.ok(!JSON.stringify(d).includes('SECRET-GROUND-TRUTH-ECHO'), 'raw model output is never returned by the API');
});

test('no retrieval, contract change and Prompt Shields blocks fail safely (no result)', async () => {
  fake.script.push(reply(liveBody(), { fileSearchCalls: 0 }), reply(liveBody(), { fileSearchCalls: 0 }));
  const a = await request(tok.admin, f.teamA, f.s1, 'live', { force: true });
  await settle();
  assert.equal((await detail(a.body.assessment.id)).body.assessment.errorCode, 'ai_no_retrieval');

  const before = invokes().length;
  fake.script.push(reply({ ...liveBody(), contractVersion: '1' }) /* the previous contract, e.g. agent v5 */);
  const b = await request(tok.admin, f.teamA, f.s1, 'live', { force: true });
  await settle();
  assert.equal(invokes().length, before + 1, 'contract_mismatch is not retried');
  assert.equal((await detail(b.body.assessment.id)).body.assessment.errorCode, 'contract_mismatch');

  fake.script.push(new FoundryError('ai_content_filtered', { httpStatus: 400, filterCategories: ['jailbreak'] }));
  const c = await request(tok.admin, f.teamA, f.s1, 'live', { force: true });
  await settle();
  const dc = (await detail(c.body.assessment.id)).body.assessment;
  assert.deepEqual([dc.status, dc.errorCode, dc.result], ['failed', 'ai_content_filtered', null]);
  const audit = db.prepare("SELECT metadata_json AS m FROM audit_log WHERE action = 'ai_assessment.failed' AND entity_id = ?").get(c.body.assessment.id);
  assert.deepEqual(JSON.parse(audit.m).filterCategories, ['jailbreak']);
});

test('a reply cut off at the output cap (whitespace runaway) is retried once, then fails as ai_output_runaway with no result', async () => {
  const runaway = () => ({ ...reply(null, { raw: JSON.stringify(liveBody()).slice(0, -1) + '\n'.repeat(500) }), incompleteReason: 'max_output_tokens' });
  const before = invokes().length;
  fake.script.push(runaway(), runaway());
  const r = await request(tok.admin, f.teamA, f.s1, 'live', { force: true });
  await settle();
  assert.equal(invokes().length, before + 2, 'one retry');
  assert.equal(invokes().at(-1).maxOutputTokens, 1500, 'live output cap');
  const d = (await detail(r.body.assessment.id)).body.assessment;
  assert.deepEqual([d.status, d.errorCode, d.result], ['failed', 'ai_output_runaway', null]);
});

test('suspected answer leak is stored and surfaced (never published by the server)', async () => {
  db.prepare("INSERT INTO cyber_range_expected_ttps (cyber_range_id, technique_id, tactic_id, points, is_active, sort_order, created_at, updated_at) VALUES (?, 'T1566.001', 'TA0001', 10, 1, 1, ?, ?)").run(f.s1, '2026-01-01', '2026-01-01');
  fake.script.push(reply(liveBody({ studentSafeFeedback: { teamLevel: 'Look for T1566.001!', entryFeedback: [], guidingQuestion: null } })));
  const r = await request(tok.admin, f.teamA, f.s1, 'live', { force: true });
  await settle();
  const d = (await detail(r.body.assessment.id)).body.assessment;
  assert.equal(d.leakSuspected, true);
  assert.deepEqual(d.result.flags.leakedTechniqueIds, ['T1566.001']);
  const list = (await call('GET', `/api/admin/ai-assessments?teamId=${f.teamA}&cyberRangeId=${f.s1}&mode=live`, tok.iA)).body.assessments;
  assert.ok(list.some((x) => x.id === r.body.assessment.id && x.leakSuspected));
});

test('mode rules and readiness: live needs a running session; no pinned version -> ground_truth_not_ready; AI off -> 503', async () => {
  const r3 = Number(db.prepare("INSERT INTO cyber_ranges (day_id, name, difficulty, sort_order) VALUES ((SELECT id FROM days LIMIT 1), 'No doc', 'intermediate', 70)").run().lastInsertRowid);
  startCyberRangeForTeam(f.teamNoOrg, r3);
  assert.equal((await request(tok.admin, f.teamNoOrg, r3, 'live')).body.reason, 'ground_truth_not_ready');
  assert.equal((await request(tok.admin, f.teamNoOrg, f.s2, 'final')).body.reason, 'no_progress');
  // The list carries the session's readiness for the review screen: pinned v1 while v2 is the latest; no Foundry ids.
  const listed = (await call('GET', `/api/admin/ai-assessments?teamId=${f.teamA}&cyberRangeId=${f.s1}`, tok.iA)).body;
  assert.deepEqual(listed.session, { sessionStatus: 'active', pinnedVersion: 1, pinnedAvailable: true, latestReadyVersion: 2 });
  assert.ok(!JSON.stringify(listed).includes('vs_'), 'no vector store ids');
  const none = (await call('GET', `/api/admin/ai-assessments?teamId=${f.teamNoOrg}&cyberRangeId=${r3}`, tok.admin)).body.session;
  assert.deepEqual(none, { sessionStatus: 'active', pinnedVersion: null, pinnedAvailable: false, latestReadyVersion: null });
  db.prepare("UPDATE team_cyber_range_progress SET status = 'completed', completed_at = ? WHERE team_id = ? AND cyber_range_id = ?").run(new Date().toISOString(), f.teamB, f.s2);
  assert.equal((await request(tok.admin, f.teamB, f.s2, 'live')).body.reason, 'scenario_not_running');
  process.env.AI_ASSESSMENT_ENABLED = 'false';
  const off = await request(tok.admin, f.teamA, f.s1, 'live', { force: true });
  process.env.AI_ASSESSMENT_ENABLED = 'true';
  assert.deepEqual([off.status, off.body.reason], [503, 'ai_disabled']);
  assert.equal((await call('GET', '/api/admin/ai/status', tok.iA)).body.enabled, true);
});

test('final assessment: rubric sent; decisions recorded on the assessment only — official scores untouched', async () => {
  fake.script.push(reply(finalBody(70)));
  const r = await request(tok.iA, f.teamA, f.s1, 'final');
  assert.equal(r.status, 202);
  await settle();
  const sent = JSON.parse(invokes().at(-1).input);
  assert.deepEqual(sent.rubric.criteria.map((c) => c.maxPoints), [40, 30, 20, 10]);
  const id = r.body.assessment.id;
  const decide = (body, token = tok.iA) => call('POST', `/api/admin/ai-assessments/${id}/decision`, token, body);

  const liveId = db.prepare("SELECT id FROM ai_assessments WHERE mode = 'live' AND status = 'succeeded' LIMIT 1").get().id;
  assert.equal((await call('POST', `/api/admin/ai-assessments/${liveId}/decision`, tok.iA, { decision: 'approved' })).body.reason, 'not_final');
  const failedId = db.prepare("SELECT id FROM ai_assessments WHERE status = 'failed' LIMIT 1").get().id;
  assert.equal((await call('POST', `/api/admin/ai-assessments/${failedId}/decision`, tok.admin, { decision: 'approved' })).body.reason, 'not_final');
  assert.equal((await decide({ decision: 'edited', score: 55 })).body.reason, 'note_required');
  assert.equal((await decide({ decision: 'edited', note: 'x' })).body.reason, 'score_required');
  assert.equal((await decide({ decision: 'rejected', score: 10 })).body.reason, 'score_not_allowed');
  assert.equal((await decide({ decision: 'edited', score: 101, note: 'x' })).status, 400);
  assert.equal((await decide({ decision: 'approved' }, tok.studentA)).status, 403);

  const approved = await decide({ decision: 'approved' });
  assert.equal(approved.status, 200);
  assert.deepEqual([approved.body.assessment.decision, approved.body.assessment.decidedScore], ['approved', 70]);
  assert.equal((await decide({ decision: 'rejected' })).body.reason, 'already_decided');
  const edited = await decide({ decision: 'edited', score: 64, note: 'Clarity was better than judged.', override: true });
  assert.deepEqual([edited.body.assessment.decision, edited.body.assessment.decidedScore], ['edited', 64]);
  assert.equal(edited.body.assessment.recommendedTotal, 70, 'the AI recommendation stays visible next to the decision');
  const listed = (await call('GET', `/api/admin/ai-assessments?teamId=${f.teamA}&cyberRangeId=${f.s1}`, tok.iA)).body.assessments;
  assert.ok(listed.filter((a) => a.mode === 'live').every((a) => a.recommendedTotal === null), 'live reviews carry no total');
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'ai_assessment.decided' AND metadata_json LIKE '%\"previousDecision\":\"approved\"%'").get());
  // Out-of-scope instructor can't read or decide it.
  const iB = await call('POST', `/api/admin/ai-assessments/${id}/decision`, tok.iAB, { decision: 'rejected', override: true });
  assert.equal(iB.status, 200, 'iAB holds (A,S1) — same pair, allowed');
});

test('per-account rate limit (30/hour) counts only new jobs', async () => {
  runner.resetAiRateLimitsForTests();
  for (let i = 0; i < runner.RATE_LIMIT_PER_HOUR; i++) {
    fake.script.push(reply(liveBody()));
    const r = await request(tok.iA, f.teamA, f.s1, 'live', { force: true });
    assert.equal(r.status, 202, `#${i}: ${r.text}`);
    await settle();
  }
  const over = await request(tok.iA, f.teamA, f.s1, 'live', { force: true });
  assert.deepEqual([over.status, over.body.reason], [429, 'rate_limited']);
  assert.equal((await request(tok.iA, f.teamA, f.s1, 'live')).body.reused, true, 'reuse is not rate limited');
  runner.resetAiRateLimitsForTests();
});

test('restart recovery marks interrupted jobs failed; nothing ever deleted in Foundry; official data untouched', async () => {
  const id = Number(db.prepare("INSERT INTO ai_assessments (team_id, cyber_range_id, mode, status, document_version, document_sha256, snapshot_json, snapshot_sha256, agent_name, contract_version, requested_by_username, created_at) VALUES (?, ?, 'live', 'running', 1, 'x', '{}', 'y', 'a', '1', 'admin', ?)").run(f.teamA, f.s1, new Date().toISOString()).lastInsertRowid);
  docs.recoverInterruptedAiWork();
  assert.equal(db.prepare('SELECT error_code AS e FROM ai_assessments WHERE id = ?').get(id).e, 'interrupted');
  assert.deepEqual(fake.calls.filter((c) => c.op !== 'invoke'), [], 'no Foundry deletes');
  assert.deepEqual(officialState(), officialBefore, 'scores and student-visible feedback unchanged by every AI path');
  // Students never see AI data: their documentation DTO carries none of it.
  const studentView = await call('GET', `/api/cyber-ranges/${f.s1}/documentation`, tok.studentA);
  assert.equal(studentView.status, 200);
  assert.ok(!/studentSafeFeedback|instructorOnlyNotes|ai_assessment|leakSuspected/i.test(studentView.text));
});
