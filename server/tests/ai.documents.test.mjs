import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// AI Investigation Assessment — Phase 2: scenario ground-truth documents, session pinning, Foundry
// resource tracking and the admin-approved cleanup. A FAKE Foundry client is injected: no network, no
// Azure resources, no model calls. The central guarantee checked throughout: nothing is ever deleted in
// Foundry except through an explicit admin cleanup request on listed candidates.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-ai-docs-')), 'test.db');
Object.assign(process.env, {
  AI_ASSESSMENT_ENABLED: 'true',
  FOUNDRY_PROJECT_ENDPOINT: 'https://fake-res.services.ai.azure.com/api/projects/fake',
  FOUNDRY_AGENT_NAME: 'cyber-range-assessor',
  AZURE_TENANT_ID: '11111111-2222-3333-4444-555555555555',
  AZURE_CLIENT_ID: '66666666-7777-8888-9999-000000000000',
  AZURE_CLIENT_SECRET: 'fake-secret-value-for-tests-only',
});

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { createApp } = await import('../dist/app.js');
const { setFoundryClientForTests, FoundryError } = await import('../dist/services/ai/foundryClient.js');
const docs = await import('../dist/services/ai/scenarioAiDocuments.service.js');
const { startCyberRangeForTeam } = await import('../dist/services/cyberRangeProgress.service.js');
const { deleteCyberRange } = await import('../dist/services/cyberRangeCatalog.service.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');
const { issueTokens } = await import('./fixtures/tokens.mjs');

// ---------------------------------------------------------------------------------------------
// Fake Foundry: sequential ids, scripted failures, and a log of every call.
const fake = {
  n: 0,
  calls: [],
  failNextIndex: false,
  failNextUpload: null,
  failDeleteIds: new Set(),
  get deletes() {
    return this.calls.filter((c) => c.op.startsWith('delete'));
  },
  async uploadFile({ filename }) {
    this.calls.push({ op: 'uploadFile', filename });
    if (this.failNextUpload) {
      const code = this.failNextUpload;
      this.failNextUpload = null;
      throw new FoundryError(code);
    }
    return { fileId: `assistant-F${++this.n}` };
  },
  async createVectorStore({ name }) {
    this.calls.push({ op: 'createVectorStore', name });
    return { vectorStoreId: `vs_V${++this.n}` };
  },
  async waitForVectorStore(id) {
    this.calls.push({ op: 'waitForVectorStore', id });
    if (this.failNextIndex) {
      this.failNextIndex = false;
      return { ok: false, storeStatus: 'completed', fileStatus: 'failed', errorCode: 'unsupported_file', usageBytes: 0 };
    }
    return { ok: true, storeStatus: 'completed', fileStatus: 'completed', errorCode: null, usageBytes: 1500 };
  },
  async deleteVectorStore(id) {
    this.calls.push({ op: 'deleteVectorStore', id });
    if (this.failDeleteIds.has(id)) throw new FoundryError('ai_unavailable');
  },
  async deleteFile(id) {
    this.calls.push({ op: 'deleteFile', id });
    if (this.failDeleteIds.has(id)) throw new FoundryError('ai_unavailable');
  },
  async invokeAssessment() {
    throw new Error('Phase 2 must never invoke the model');
  },
};

let f, tok, server, base;

before(async () => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  tok = issueTokens(db, f);
  setFoundryClientForTests(fake);
  await new Promise((resolve) => {
    server = createApp().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  setFoundryClientForTests(null);
  server?.close();
});

async function call(method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

const b64 = (s) => Buffer.from(s, 'latin1').toString('base64');
let pdfCounter = 0;
const pdf = (name = 'reference.pdf') => ({ filename: name, contentBase64: b64(`%PDF-1.4\nscenario reference ${++pdfCounter}\n%%EOF`) });
const docx = { filename: 'reference.docx', contentBase64: b64('PK\x03\x04....word/document.xml....') };
const txt = { filename: 'notes.txt', contentBase64: Buffer.from('Scenario notes – UTF-8 ✓').toString('base64') };

async function upload(rangeId, payload, token = tok.admin) {
  const r = await call('POST', `/api/admin/cyber-ranges/${rangeId}/ai-documents`, token, payload);
  await docs.waitForAiIndexingIdle();
  return r;
}
const getDocs = (rangeId, token = tok.admin) => call('GET', `/api/admin/cyber-ranges/${rangeId}/ai-documents`, token);
const pinOf = (teamId, rangeId) =>
  db.prepare('SELECT ai_document_id AS d FROM team_cyber_range_progress WHERE team_id = ? AND cyber_range_id = ?').get(teamId, rangeId)?.d ?? null;
const docId = (rangeId, version) => db.prepare('SELECT id FROM scenario_ai_documents WHERE cyber_range_id = ? AND version = ?').get(rangeId, version).id;
function newRange(name) {
  const day = db.prepare('SELECT id FROM days LIMIT 1').get().id;
  return Number(db.prepare("INSERT INTO cyber_ranges (day_id, name, difficulty, sort_order) VALUES (?, ?, 'intermediate', 60)").run(day, name).lastInsertRowid);
}

// ---------------------------------------------------------------------------------------------

test('validation: type, magic bytes, size, encoding and filename', async () => {
  const cases = [
    [{ filename: 'x.exe', contentBase64: b64('MZ') }, 400, 'unsupported_type'],
    [{ filename: 'fake.pdf', contentBase64: b64('<html>not a pdf') }, 400, 'invalid_file'],
    [{ filename: 'fake.docx', contentBase64: b64('PK\x03\x04 no word part') }, 400, 'invalid_file'],
    [{ filename: 'bin.txt', contentBase64: Buffer.from([0x41, 0x00, 0x42]).toString('base64') }, 400, 'invalid_file'],
    [{ filename: 'latin1.txt', contentBase64: Buffer.from([0xff, 0xfe, 0xfa]).toString('base64') }, 400, 'invalid_file'],
    [{ filename: 'a.pdf', contentBase64: '' }, 400, 'empty'],
    [{ filename: 'a.pdf', contentBase64: 'not base64!!' }, 400, 'invalid_encoding'],
    [{ filename: '', contentBase64: b64('%PDF-') }, 400, 'invalid_filename'],
    [{ filename: 'big.pdf', contentBase64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') }, 413, 'too_large'],
  ];
  for (const [payload, status, reason] of cases) {
    const r = await upload(f.s1, payload);
    assert.equal(r.status, status, `${payload.filename}: ${r.text.slice(0, 120)}`);
    assert.equal(r.body.reason, reason, payload.filename);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scenario_ai_documents').get().n, 0);
  assert.equal(fake.calls.length, 0, 'no Foundry call for a rejected upload');
});

test('RBAC: students 403, out-of-scope scenario 404 (audited), in-scope instructor allowed', async () => {
  assert.equal((await upload(f.s1, pdf(), tok.studentA)).status, 403);
  assert.equal((await getDocs(f.s1, tok.studentA)).status, 403);
  // iA holds (A,S1) only: S2 is invisible.
  assert.equal((await upload(f.s2, pdf(), tok.iA)).status, 404);
  assert.equal((await getDocs(f.s2, tok.iA)).status, 404);
  assert.equal((await call('PUT', `/api/admin/cyber-ranges/${f.s2}/ai-rubric`, tok.iA, { criteria: [] })).status, 404);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'authz.denied' AND cyber_range_id = ?").get(f.s2));
  assert.equal((await getDocs(999999)).status, 404);
  // In scope: accepted and indexed.
  const r = await upload(f.s1, { ...pdf(), filename: '..\\..\\etc\\evil reference.pdf' }, tok.iA);
  assert.equal(r.status, 202, r.text);
  assert.equal(r.body.document.originalFilename, 'evil reference.pdf');
  assert.equal(r.body.document.version, 1);
});

test('indexing records every Foundry resource; DTOs never expose bytes or Foundry ids', async () => {
  const list = await getDocs(f.s1, tok.iA);
  assert.equal(list.status, 200);
  assert.equal(list.body.ready, true);
  assert.equal(list.body.current.status, 'ready');
  assert.equal(list.body.current.isCurrent, true);
  assert.equal(list.body.aiEnabled, true);
  assert.deepEqual(list.body.rubric.criteria.map((c) => c.maxPoints), [40, 30, 20, 10]);
  assert.ok(!/assistant-F|vs_V|content|JVBER/.test(list.text), 'no Foundry ids or bytes in the response');
  const resources = db.prepare('SELECT kind, document_id AS d FROM ai_foundry_resources ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(resources, [{ kind: 'file', d: docId(f.s1, 1) }, { kind: 'vector_store', d: docId(f.s1, 1) }]);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'ai_document.indexed'").get());
});

test('AI disabled: upload refused with 503, nothing stored, no Foundry call', async () => {
  const before = fake.calls.length;
  process.env.AI_ASSESSMENT_ENABLED = 'false';
  try {
    const r = await upload(f.s1, pdf());
    assert.equal(r.status, 503);
    assert.equal(r.body.reason, 'ai_disabled');
    assert.equal((await getDocs(f.s1)).body.aiEnabled, false);
  } finally {
    process.env.AI_ASSESSMENT_ENABLED = 'true';
  }
  assert.equal(fake.calls.length, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scenario_ai_documents WHERE cyber_range_id = ?').get(f.s1).n, 1);
});

test('replacement: new version becomes current, old one superseded; duplicates refused', async () => {
  const r = await upload(f.s1, docx);
  assert.equal(r.status, 202);
  const list = (await getDocs(f.s1)).body;
  assert.deepEqual(list.versions.map((v) => [v.version, v.status, v.isCurrent]), [[2, 'ready', true], [1, 'superseded', false]]);
  const dup = await upload(f.s1, docx);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.reason, 'duplicate_document');
});

test('a failed replacement keeps the current version; retry recovers; only failed versions retry', async () => {
  fake.failNextIndex = true;
  await upload(f.s1, txt);
  let list = (await getDocs(f.s1)).body;
  assert.equal(list.current.version, 2, 'v2 stays current');
  assert.deepEqual([list.versions[0].version, list.versions[0].status, list.versions[0].errorCode], [3, 'failed', 'indexing_failed:unsupported_file']);
  const v3 = docId(f.s1, 3);
  assert.equal((await call('POST', `/api/admin/cyber-ranges/${f.s1}/ai-documents/${docId(f.s1, 2)}/retry`, tok.admin)).body.reason, 'not_failed');
  assert.equal((await call('POST', `/api/admin/cyber-ranges/${f.s2}/ai-documents/${v3}/retry`, tok.admin)).status, 404, 'doc must belong to the URL scenario');
  const retry = await call('POST', `/api/admin/cyber-ranges/${f.s1}/ai-documents/${v3}/retry`, tok.admin);
  assert.equal(retry.status, 202);
  await docs.waitForAiIndexingIdle();
  list = (await getDocs(f.s1)).body;
  assert.deepEqual(list.versions.map((v) => [v.version, v.status]), [[3, 'ready'], [2, 'superseded'], [1, 'superseded']]);
  // An upload error from Foundry also fails cleanly with a safe code.
  fake.failNextUpload = 'ai_rate_limited';
  await upload(f.s1, pdf());
  assert.equal(db.prepare('SELECT error_code AS e FROM scenario_ai_documents WHERE cyber_range_id = ? AND version = 4').get(f.s1).e, 'ai_rate_limited');
  assert.equal((await getDocs(f.s1)).body.current.version, 3);
});

test('session pinning: start pins current; replacement never moves a pin; resume keeps it; first-ready backfill', async () => {
  const r = newRange('Pin scenario');
  // Team A starts before any version exists -> no pin yet.
  startCyberRangeForTeam(f.teamA, r);
  assert.equal(pinOf(f.teamA, r), null);
  // First ready version pins sessions that started without one.
  await upload(r, pdf());
  const v1 = docId(r, 1);
  assert.equal(pinOf(f.teamA, r), v1);
  // v2 becomes current; team A keeps v1, a newly started team gets v2.
  await upload(r, pdf());
  const v2 = docId(r, 2);
  assert.equal(pinOf(f.teamA, r), v1);
  startCyberRangeForTeam(f.teamB, r);
  assert.equal(pinOf(f.teamB, r), v2);
  // Pause (switch away) and resume: still v1.
  startCyberRangeForTeam(f.teamA, f.s1);
  startCyberRangeForTeam(f.teamA, r);
  assert.equal(pinOf(f.teamA, r), v1);
  // The resolver returns the pinned version's own store, never "current".
  const s = docs.resolveSessionVersion(f.teamA, r);
  assert.equal(s.documentId, v1);
  assert.equal(s.version, 1);
  assert.equal(s.vectorStoreId, db.prepare('SELECT foundry_vector_store_id AS v FROM scenario_ai_documents WHERE id = ?').get(v1).v);
  assert.equal(docs.resolveSessionVersion(f.teamNoOrg, r), null);
  // Pinned counts are scoped: iAB holds (A,S1),(B,S2) — not this scenario, so 404; admin sees both.
  assert.equal((await getDocs(r, tok.iAB)).status, 404);
  const counts = Object.fromEntries((await getDocs(r)).body.versions.map((v) => [v.version, v.pinnedSessionCount]));
  assert.deepEqual(counts, { 2: 1, 1: 1 });
});

test('cleanup candidates: pinned or current never listed; nothing deleted automatically', async () => {
  const r = db.prepare("SELECT id FROM cyber_ranges WHERE name = 'Pin scenario'").get().id;
  const v1 = docId(r, 1);
  const listed = (state = 'candidates') => call('GET', `/api/admin/ai/foundry-resources?state=${state}`, tok.admin);
  let c = (await listed()).body.resources;
  // S1: v1/v2 superseded & unpinned, v3 failed attempt replaced by the retry, v4 failed upload (no resources).
  assert.ok(c.every((x) => x.cyberRangeId === f.s1), 'the pinned v1 of the pin scenario is not a candidate');
  assert.deepEqual([...new Set(c.map((x) => x.cleanupReason))].sort(), ['replaced_attempt', 'superseded_unpinned']);
  assert.ok(!c.some((x) => x.documentId === docId(f.s1, 3) && x.cleanupReason === null));
  // Once no session pins v1 any more (what an event reset does), it becomes a candidate — but is NOT deleted.
  db.prepare('DELETE FROM team_cyber_range_progress WHERE cyber_range_id = ? AND ai_document_id = ?').run(r, v1);
  c = (await listed()).body.resources;
  assert.ok(c.some((x) => x.documentId === v1 && x.cleanupReason === 'superseded_unpinned'));
  // Interrupted work is marked failed, never cleaned up.
  db.prepare("UPDATE scenario_ai_documents SET status = 'processing' WHERE id = ?").run(docId(f.s1, 4));
  assert.deepEqual(docs.recoverInterruptedAiWork(), { documents: 1, assessments: 0 });
  assert.equal(db.prepare('SELECT error_code AS e FROM scenario_ai_documents WHERE id = ?').get(docId(f.s1, 4)).e, 'interrupted');
  // Scenario deletion leaves its resources recorded as candidates.
  const gone = newRange('Doomed scenario');
  await upload(gone, pdf());
  assert.equal(deleteCyberRange(gone, 'admin').ok, true);
  c = (await listed()).body.resources;
  assert.equal(c.filter((x) => x.cyberRangeId === gone && x.cleanupReason === 'document_deleted').length, 2);
  // THE guarantee: through uploads, replacements, failures, retries, unpinning, recovery and scenario
  // deletion, not a single delete reached Foundry.
  assert.deepEqual(fake.deletes, []);
  // Listing everything shows in-use resources too, flagged.
  assert.ok((await listed('all')).body.resources.some((x) => x.inUse));
});

test('cleanup: admin only, exact approved ids, re-checked, vector stores first, failures recorded', async () => {
  const listed = async () => (await call('GET', '/api/admin/ai/foundry-resources', tok.admin)).body.resources;
  assert.equal((await call('GET', '/api/admin/ai/foundry-resources', tok.iA)).status, 403);
  assert.equal((await call('POST', '/api/admin/ai/foundry-resources/cleanup', tok.iAB, { resourceIds: [1] })).status, 403);
  const all = (await call('GET', '/api/admin/ai/foundry-resources?state=all', tok.admin)).body.resources;
  const inUse = all.find((x) => x.inUse);
  // An in-use id anywhere in the request rejects the whole request; nothing is deleted.
  const candidates = await listed();
  const mixed = await call('POST', '/api/admin/ai/foundry-resources/cleanup', tok.admin, { resourceIds: [candidates[0].id, inUse.id] });
  assert.equal(mixed.status, 409);
  assert.equal(mixed.body.reason, 'not_candidates');
  assert.equal((await call('POST', '/api/admin/ai/foundry-resources/cleanup', tok.admin, { resourceIds: [] })).status, 400);
  assert.equal((await call('POST', '/api/admin/ai/foundry-resources/cleanup', tok.admin, { resourceIds: ['1'] })).status, 400);
  assert.deepEqual(fake.deletes, []);

  // Approve the two resources of the deleted scenario, with one delete failing.
  const doomed = candidates.filter((x) => x.cleanupReason === 'document_deleted');
  const failing = doomed.find((x) => x.kind === 'file');
  fake.failDeleteIds.add(failing.foundryId);
  const r = await call('POST', '/api/admin/ai/foundry-resources/cleanup', tok.admin, { resourceIds: doomed.map((x) => x.id) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(fake.deletes.map((d) => d.op), ['deleteVectorStore', 'deleteFile'], 'vector store before file');
  assert.equal(r.body.deleted.length, 1);
  assert.deepEqual(r.body.failed.map((x) => x.errorCode), ['ai_unavailable']);
  // The failed one stays a candidate (with its error); the deleted one is no longer offered.
  const after = await listed();
  assert.ok(after.some((x) => x.id === failing.id && x.deleteError === 'ai_unavailable'));
  assert.ok(!after.some((x) => x.id === r.body.deleted[0].id));
  fake.failDeleteIds.clear();
  const again = await call('POST', '/api/admin/ai/foundry-resources/cleanup', tok.admin, { resourceIds: [failing.id] });
  assert.equal(again.status, 200);
  assert.equal(again.body.deleted.length, 1);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'ai_resources.cleanup'").get());
  // A superseded version whose resources are all deleted is marked so (bytes kept for re-indexing).
  const s1v1 = docId(f.s1, 1);
  const ids = (await listed()).filter((x) => x.documentId === s1v1).map((x) => x.id);
  assert.equal(ids.length, 2);
  await call('POST', '/api/admin/ai/foundry-resources/cleanup', tok.admin, { resourceIds: ids });
  const row = db.prepare('SELECT foundry_deleted_at AS d, length(content) AS bytes FROM scenario_ai_documents WHERE id = ?').get(s1v1);
  assert.ok(row.d);
  assert.ok(row.bytes > 0);
});

test('rubric: validated, scoped, stored; default otherwise', async () => {
  const put = (body, token = tok.iA) => call('PUT', `/api/admin/cyber-ranges/${f.s1}/ai-rubric`, token, body);
  const crit = (a, b, c, d) => ({ criteria: [{ key: 'identification', maxPoints: a }, { key: 'understanding', maxPoints: b }, { key: 'connections', maxPoints: c }, { key: 'clarity', maxPoints: d }] });
  assert.equal((await put(crit(40, 30, 20, 20))).status, 400);
  assert.equal((await put({ criteria: [{ key: 'identification', maxPoints: 100 }] })).status, 400);
  assert.equal((await put({ ...crit(50, 30, 10, 10), extra: 1 })).status, 200);
  const g = (await getDocs(f.s1, tok.iA)).body.rubric;
  assert.equal(g.isDefault, false);
  assert.deepEqual(g.criteria.map((c) => c.maxPoints), [50, 30, 10, 10]);
  assert.equal((await put(crit(50, 30, 10, 10), tok.studentA)).status, 403);
});

test('official scoring untouched and the model never invoked in Phase 2', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 0);
  assert.ok(!fake.calls.some((c) => c.op === 'invokeAssessment'));
});
