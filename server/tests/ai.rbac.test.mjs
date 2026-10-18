import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// AI assessment — platform P4 (2026-10-18): one cross-scope matrix over EVERY AI route (and the feedback
// link + reset preview), plus an audit-completeness check of the AI mutations. Roles: admin; iA holds
// (A,S1); iAB holds (A,S1)+(B,S2) — never A's work on S2 (cross product); a student; no token.
// Expectation rules: missing permission = 403, out of scope = 404 (audited), anonymous = 401.
// A FAKE Foundry client is injected: no network, no Azure resources, no model calls.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-ai-rbac-')), 'test.db');
Object.assign(process.env, {
  AI_ASSESSMENT_ENABLED: 'true',
  FOUNDRY_PROJECT_ENDPOINT: 'https://fake-res.services.ai.azure.com/api/projects/fake',
  FOUNDRY_AGENT_NAME: 'cyber-range-assessor',
  FOUNDRY_AGENT_VERSION: '3',
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
const { startCyberRangeForTeam } = await import('../dist/services/cyberRangeProgress.service.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');
const { issueTokens } = await import('./fixtures/tokens.mjs');

let n = 0;
const finalReply = (req) => ({
  contractVersion: '2',
  mode: 'final',
  result: {
    investigationSummary: 's', overallAssessment: { level: 'fair', text: 't' }, stages: [], incorrectConclusions: [], strengths: [], areasForImprovement: [],
    score: { criteria: req.rubric.criteria.map((c) => ({ key: c.key, maxPoints: c.maxPoints, awardedPoints: 1, rationale: 'r' })), recommendedTotal: 4, maxTotal: 100, explanation: 'e' },
    suggestedFinalFeedback: { instructorVersion: 'iv', studentSafeVersion: 'Well done.' }, confidence: { level: 'low', reason: 'r' }, warnings: [],
  },
});
const fake = {
  async uploadFile() { return { fileId: `assistant-R${++n}` }; },
  async createVectorStore() { return { vectorStoreId: `vs_R${++n}` }; },
  async waitForVectorStore() { return { ok: true, storeStatus: 'completed', fileStatus: 'completed', errorCode: null, usageBytes: 1 }; },
  async deleteVectorStore() {},
  async deleteFile() {},
  async listInventory() { return { vectorStores: [], files: [], agentVersions: [], truncated: { vectorStores: false, files: false, agentVersions: false } }; },
  async invokeAssessment({ input }) {
    const req = JSON.parse(input);
    if (req.mode !== 'final') return { outputText: '{}', responseId: 'r', responseStatus: 'completed', incompleteReason: null, model: 'm', agentName: 'a', agentVersion: '3', usage: null, fileSearchCalls: 1 };
    return { outputText: JSON.stringify(finalReply(req)), responseId: 'r', responseStatus: 'completed', incompleteReason: null, model: 'm', agentName: 'a', agentVersion: '3', usage: null, fileSearchCalls: 1 };
  },
};

let f, tok, server, base;
const ids = {};

async function call(method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  await res.arrayBuffer();
  return res.status;
}

before(async () => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  tok = issueTokens(db, f);
  setFoundryClientForTests(fake);
  await new Promise((resolve) => (server = createApp().listen(0, '127.0.0.1', resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
  const pdf = (s) => ({ filename: 'ref.pdf', contentBase64: Buffer.from(`%PDF-1.4 ${s}`).toString('base64') });
  for (const r of [f.s1, f.s2]) {
    const res = await fetch(`${base}/api/admin/cyber-ranges/${r}/ai-documents`, { method: 'POST', headers: { Authorization: `Bearer ${tok.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify(pdf(`ref-${r}`)) });
    assert.equal(res.status, 202);
  }
  await docs.waitForAiIndexingIdle();
  ids.docS1 = db.prepare('SELECT id FROM scenario_ai_documents WHERE cyber_range_id = ?').get(f.s1).id;
  ids.docS2 = db.prepare('SELECT id FROM scenario_ai_documents WHERE cyber_range_id = ?').get(f.s2).id;
  startCyberRangeForTeam(f.teamA, f.s2); // A's work on S2: the cross-product trap for iAB
  startCyberRangeForTeam(f.teamA, f.s1);
  startCyberRangeForTeam(f.teamB, f.s2);
  const final = async (teamId, rangeId) => {
    const res = await fetch(`${base}/api/admin/ai-assessments`, { method: 'POST', headers: { Authorization: `Bearer ${tok.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId, cyberRangeId: rangeId, mode: 'final' }) });
    const b = await res.json();
    assert.equal(res.status, 202, JSON.stringify(b));
    await runner.waitForAiAssessmentsIdle();
    return b.assessment.id;
  };
  ids.aA1 = await final(f.teamA, f.s1);
  ids.aA2 = await final(f.teamA, f.s2);
  ids.aB2 = await final(f.teamB, f.s2);
  ids.entryA1 = Number(db.prepare("INSERT INTO documentation_entries (team_id, cyber_range_id, author_user_id, body, created_at) VALUES (?, ?, ?, 'x', ?)").run(f.teamA, f.s1, tok.ids.studentA, new Date().toISOString()).lastInsertRowid);
});

after(() => {
  setFoundryClientForTests(null);
  server?.close();
});

// [label, method, path(), body?, { admin, iA, iAB, student, anon }]
const R = () => [
  ['status', 'GET', '/api/admin/ai/status', null, { admin: 200, iA: 200, iAB: 200, student: 403, anon: 401 }],
  ['config', 'GET', '/api/admin/ai/config', null, { admin: 200, iA: 403, iAB: 403, student: 403, anon: 401 }],
  ['resources', 'GET', '/api/admin/ai/foundry-resources', null, { admin: 200, iA: 403, iAB: 403, student: 403, anon: 401 }],
  ['inventory', 'GET', '/api/admin/ai/foundry-inventory', null, { admin: 200, iA: 403, iAB: 403, student: 403, anon: 401 }],
  ['cleanup (empty -> 400 for admin)', 'POST', '/api/admin/ai/foundry-resources/cleanup', { resourceIds: [] }, { admin: 400, iA: 403, iAB: 403, student: 403, anon: 401 }],
  ['docs S1', 'GET', `/api/admin/cyber-ranges/${f.s1}/ai-documents`, null, { admin: 200, iA: 200, iAB: 200, student: 403, anon: 401 }],
  ['docs S2', 'GET', `/api/admin/cyber-ranges/${f.s2}/ai-documents`, null, { admin: 200, iA: 404, iAB: 200, student: 403, anon: 401 }],
  ['upload S2 (invalid body -> 400 when allowed)', 'POST', `/api/admin/cyber-ranges/${f.s2}/ai-documents`, { filename: 'x.exe', contentBase64: 'TVo=' }, { admin: 400, iA: 404, iAB: 400, student: 403, anon: 401 }],
  ['retry S2 (not failed -> 409 when allowed)', 'POST', `/api/admin/cyber-ranges/${f.s2}/ai-documents/${ids.docS2}/retry`, null, { admin: 409, iA: 404, iAB: 409, student: 403, anon: 401 }],
  ['rebuild S2 (not missing -> 409 when allowed)', 'POST', `/api/admin/cyber-ranges/${f.s2}/ai-documents/${ids.docS2}/rebuild`, null, { admin: 409, iA: 404, iAB: 409, student: 403, anon: 401 }],
  ['download S2', 'GET', `/api/admin/cyber-ranges/${f.s2}/ai-documents/${ids.docS2}/content`, null, { admin: 200, iA: 404, iAB: 200, student: 403, anon: 401 }],
  ['download S1 doc via S2 url', 'GET', `/api/admin/cyber-ranges/${f.s2}/ai-documents/${ids.docS1}/content`, null, { admin: 404, iA: 404, iAB: 404, student: 403, anon: 401 }],
  ['rubric S2 (bad sum -> 400 when allowed)', 'PUT', `/api/admin/cyber-ranges/${f.s2}/ai-rubric`, { criteria: [] }, { admin: 400, iA: 404, iAB: 400, student: 403, anon: 401 }],
  ['request A/S2 (cross product)', 'POST', '/api/admin/ai-assessments', { teamId: f.teamA, cyberRangeId: f.s2, mode: 'bogus' }, { admin: 400, iA: 400, iAB: 400, student: 403, anon: 401 }],
  // A's S2 session is paused: live reviews of a paused session are allowed (admin 202); scoped never.
  ['request A/S2 live', 'POST', '/api/admin/ai-assessments', { teamId: f.teamA, cyberRangeId: f.s2, mode: 'live' }, { admin: 202, iA: 404, iAB: 404, student: 403, anon: 401 }],
  ['request NoOrg/S1', 'POST', '/api/admin/ai-assessments', { teamId: f.teamNoOrg, cyberRangeId: f.s1, mode: 'live' }, { admin: 409, iA: 404, iAB: 404, student: 403, anon: 401 }],
  ['list A/S1', 'GET', `/api/admin/ai-assessments?teamId=${f.teamA}&cyberRangeId=${f.s1}`, null, { admin: 200, iA: 200, iAB: 200, student: 403, anon: 401 }],
  ['list A/S2 (cross product)', 'GET', `/api/admin/ai-assessments?teamId=${f.teamA}&cyberRangeId=${f.s2}`, null, { admin: 200, iA: 404, iAB: 404, student: 403, anon: 401 }],
  ['list B/S2', 'GET', `/api/admin/ai-assessments?teamId=${f.teamB}&cyberRangeId=${f.s2}`, null, { admin: 200, iA: 404, iAB: 200, student: 403, anon: 401 }],
  ['detail A/S1', 'GET', `/api/admin/ai-assessments/${ids.aA1}`, null, { admin: 200, iA: 200, iAB: 200, student: 403, anon: 401 }],
  ['detail A/S2 (cross product)', 'GET', `/api/admin/ai-assessments/${ids.aA2}`, null, { admin: 200, iA: 404, iAB: 404, student: 403, anon: 401 }],
  ['detail B/S2', 'GET', `/api/admin/ai-assessments/${ids.aB2}`, null, { admin: 200, iA: 404, iAB: 200, student: 403, anon: 401 }],
  ['decision A/S2 (bad body -> 400 when allowed)', 'POST', `/api/admin/ai-assessments/${ids.aA2}/decision`, { decision: 'maybe' }, { admin: 400, iA: 404, iAB: 404, student: 403, anon: 401 }],
  ['feedback link to B/S2 assessment on A entry', 'POST', `/api/cyber-ranges/${f.s1}/documentation/${ids.entryA1}/feedback`, { verdict: 'on_track', sourceAiAssessmentId: ids.aB2 }, { admin: 400, iA: 400, iAB: 400, student: 403, anon: 401 }],
  ['reset preview', 'GET', '/api/admin/event/reset-preview', null, { admin: 200, iA: 403, iAB: 403, student: 403, anon: 401 }],
];

test('AI route matrix: 403 without permission, 404 out of scope (no cross product, no-org admin-only), 401 anonymous', async () => {
  const who = () => ({ admin: tok.admin, iA: tok.iA, iAB: tok.iAB, student: tok.studentA, anon: null });
  const failures = [];
  for (const [label, method, path, body, expect] of R()) {
    for (const [role, token] of Object.entries(who())) {
      const status = await call(method, path, token, body ?? undefined);
      if (status !== expect[role]) failures.push(`${label} as ${role}: ${status} (expected ${expect[role]})`);
    }
  }
  await runner.waitForAiAssessmentsIdle();
  assert.deepEqual(failures, []);
  // Out-of-scope refusals are audited.
  assert.ok(db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'authz.denied'").get().c > 10);
});

test('every AI route in the route inventory is covered by the matrix', async () => {
  const { readFileSync } = await import('node:fs');
  const inv = readFileSync(new URL('./routeInventory.test.mjs', import.meta.url), 'utf8');
  const aiRoutes = [...inv.matchAll(/'((?:GET|POST|PUT|DELETE) \/api\/admin\/(?:ai[/-]|cyber-ranges\/:cyberRangeId\/ai-)[^']*)'/g)].map((m) => m[1]);
  assert.ok(aiRoutes.length >= 14, aiRoutes.join('\n'));
  const covered = R().map(([, method, path]) => `${method} ${path}`);
  const pattern = (r) => new RegExp(`^${r.replace(/:[a-zA-Z]+/g, '[^/?]+').replace(/[?]/g, '\\?')}(\\?.*)?$`);
  const missing = aiRoutes.filter((r) => !covered.some((c) => pattern(r).test(c)));
  assert.deepEqual(missing, []);
});

test('audit completeness: every AI mutation leaves an audit row (ids/codes only, no content)', async () => {
  // Generate the remaining actions: decision, rubric, download, cleanup (after superseding S1 v1).
  const post = (path, token, body) => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  assert.equal((await post(`/api/admin/ai-assessments/${ids.aA1}/decision`, tok.admin, { decision: 'approved' })).status, 200);
  const crit = { criteria: [{ key: 'identification', maxPoints: 40 }, { key: 'understanding', maxPoints: 30 }, { key: 'connections', maxPoints: 20 }, { key: 'clarity', maxPoints: 10 }] };
  assert.equal((await fetch(`${base}/api/admin/cyber-ranges/${f.s1}/ai-rubric`, { method: 'PUT', headers: { Authorization: `Bearer ${tok.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify(crit) })).status, 200);
  await (await fetch(`${base}/api/admin/cyber-ranges/${f.s1}/ai-documents/${ids.docS1}/content`, { headers: { Authorization: `Bearer ${tok.admin}` } })).arrayBuffer();
  const actions = new Set(db.prepare("SELECT DISTINCT action FROM audit_log WHERE action LIKE 'ai_%'").all().map((r) => r.action));
  for (const a of ['ai_document.uploaded', 'ai_document.indexed', 'ai_assessment.requested', 'ai_assessment.completed', 'ai_assessment.decided', 'ai_rubric.updated', 'ai_document.downloaded']) {
    assert.ok(actions.has(a), `missing audit action ${a}`);
  }
  // No AI audit row carries document text, student text or model output.
  const meta = db.prepare("SELECT metadata_json AS m FROM audit_log WHERE action LIKE 'ai_%'").all().map((r) => r.m ?? '').join('\n');
  for (const s of ['%PDF', 'Well done', 'investigationSummary', 'fake-secret']) assert.ok(!meta.includes(s), s);
});
