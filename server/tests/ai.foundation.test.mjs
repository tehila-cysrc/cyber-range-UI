import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// AI Investigation Assessment — Phase 1 foundation: schema, migration, reset semantics, kill switch,
// permission. Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-ai-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId, createFreshEventRun } = await import('../dist/db/seed.js');
const { migrate } = await import('../dist/db/migrate.js');
const { getAiConfig, isAiEnabled, aiStatusSummary } = await import('../dist/services/ai/aiConfig.js');
const { can, permissionsFor } = await import('../dist/authz/permissions.js');

const NOW = '2026-10-15T00:00:00.000Z';
let rangeId;
let teamId;

const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const count = (sql, ...p) => db.prepare(sql).get(...p).n;

function insertDoc(version, { current = 0, status = 'ready' } = {}) {
  return Number(
    db.prepare(
      `INSERT INTO scenario_ai_documents (cyber_range_id, version, original_filename, mime_type, size_bytes, sha256, content,
         status, is_current, uploaded_by_username, created_at)
       VALUES (?, ?, 'ref.pdf', 'application/pdf', 3, 'abc', ?, ?, ?, 'instructor', ?)`,
    ).run(rangeId, version, new Uint8Array([1, 2, 3]), status, current, NOW).lastInsertRowid,
  );
}

function insertAssessment(docId, extra = {}) {
  const row = { mode: 'live', decision: null, decided_score: null, ...extra };
  return Number(
    db.prepare(
      `INSERT INTO ai_assessments (team_id, cyber_range_id, mode, status, document_id, document_version, document_sha256,
         snapshot_json, snapshot_sha256, agent_name, contract_version, requested_by_username, created_at, decision, decided_score)
       VALUES (?, ?, ?, 'succeeded', ?, 1, 'abc', '{}', 'def', 'cyber-range-assessor', '1', 'instructor', ?, ?, ?)`,
    ).run(teamId, rangeId, row.mode, docId, NOW, row.decision, row.decided_score).lastInsertRowid,
  );
}

before(() => {
  seed();
  const day = db.prepare('SELECT id FROM days LIMIT 1').get().id;
  rangeId = Number(
    db.prepare("INSERT INTO cyber_ranges (day_id, name, difficulty, sort_order) VALUES (?, 'AI Range', 'intermediate', 99)").run(day).lastInsertRowid,
  );
  teamId = db.prepare("SELECT id FROM teams WHERE name = 'Team Alpha'").get().id;
});

test('schema: AI tables and columns exist', () => {
  assert.ok(cols('scenario_ai_documents').includes('foundry_vector_store_id'));
  assert.ok(cols('scenario_ai_documents').includes('content'));
  assert.ok(cols('ai_assessments').includes('snapshot_sha256'));
  assert.ok(cols('ai_assessments').includes('decided_score'));
  assert.ok(cols('cyber_ranges').includes('ai_rubric_json'));
  assert.ok(cols('team_cyber_range_progress').includes('ai_document_id'));
});

test('migrate() is idempotent and leaves no FK violations', () => {
  const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name").all().map((r) => r.name);
  const first = tables();
  migrate();
  migrate();
  assert.deepEqual(tables(), first);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('the CONFIG table never references a RUN table (invariant)', () => {
  const targets = db.prepare('PRAGMA foreign_key_list(scenario_ai_documents)').all().map((f) => f.table).sort();
  assert.deepEqual([...new Set(targets)], ['accounts', 'cyber_ranges']);
});

test('at most one current document version per scenario', () => {
  insertDoc(1, { current: 1 });
  assert.throws(() => insertDoc(2, { current: 1 }));
  insertDoc(2, { current: 0, status: 'processing' });
  assert.throws(() => insertDoc(2)); // (scenario, version) unique
  assert.throws(() => insertDoc(3, { status: 'bogus' }));
});

test('a decision is only allowed on a final assessment, with a 0..100 score', () => {
  const doc = db.prepare('SELECT id FROM scenario_ai_documents WHERE cyber_range_id = ? AND version = 1').get(rangeId).id;
  assert.throws(() => insertAssessment(doc, { mode: 'live', decision: 'approved', decided_score: 50 }));
  assert.throws(() => insertAssessment(doc, { mode: 'final', decision: 'edited', decided_score: 101 }));
  const id = insertAssessment(doc, { mode: 'final', decision: 'approved', decided_score: 72 });
  assert.equal(db.prepare('SELECT decided_score FROM ai_assessments WHERE id = ?').get(id).decided_score, 72);
});

test('deleting a document version nulls pins and references but keeps the assessment record', () => {
  const doc = insertDoc(10);
  db.prepare(
    `INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status, started_at, ai_document_id) VALUES (?, ?, 'active', ?, ?)
     ON CONFLICT (team_id, cyber_range_id) DO UPDATE SET ai_document_id = excluded.ai_document_id`,
  ).run(teamId, rangeId, NOW, doc);
  const a = insertAssessment(doc);
  db.prepare('DELETE FROM scenario_ai_documents WHERE id = ?').run(doc);
  assert.equal(db.prepare('SELECT ai_document_id FROM team_cyber_range_progress WHERE team_id = ? AND cyber_range_id = ?').get(teamId, rangeId).ai_document_id, null);
  const row = db.prepare('SELECT document_id, document_version, document_sha256 FROM ai_assessments WHERE id = ?').get(a);
  assert.equal(row.document_id, null);
  assert.equal(row.document_version, 1); // pinned snapshot of which version was used survives
});

test('an AI assessment row never touches scores or the leaderboard sum', () => {
  const before = count('SELECT COUNT(*) AS n FROM scores');
  const doc = db.prepare('SELECT id FROM scenario_ai_documents WHERE cyber_range_id = ? AND version = 1').get(rangeId).id;
  insertAssessment(doc, { mode: 'final', decision: 'approved', decided_score: 90 });
  assert.equal(count('SELECT COUNT(*) AS n FROM scores'), before);
});

test('event reset wipes assessments and session pins, keeps scenario documents (CONFIG/RUN split)', () => {
  const doc = db.prepare('SELECT id FROM scenario_ai_documents WHERE cyber_range_id = ? AND version = 1').get(rangeId).id;
  db.prepare('UPDATE team_cyber_range_progress SET ai_document_id = ? WHERE team_id = ? AND cyber_range_id = ?').run(doc, teamId, rangeId);
  assert.ok(count('SELECT COUNT(*) AS n FROM ai_assessments') > 0);
  const docs = count('SELECT COUNT(*) AS n FROM scenario_ai_documents');

  // Same statements as the reset job in routes/admin/event.routes.ts.
  db.exec('BEGIN');
  db.prepare('DELETE FROM event_runs WHERE id = ?').run(getActiveEventRunId());
  createFreshEventRun();
  db.exec('COMMIT');

  assert.equal(count('SELECT COUNT(*) AS n FROM ai_assessments'), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM team_cyber_range_progress WHERE ai_document_id IS NOT NULL'), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM scenario_ai_documents'), docs);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

// ---------------------------------------------------------------------------------------------

const AI_ENV = ['AI_ASSESSMENT_ENABLED', 'FOUNDRY_PROJECT_ENDPOINT', 'FOUNDRY_AGENT_NAME', 'FOUNDRY_AGENT_VERSION', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AI_REQUEST_TIMEOUT_MS', 'AI_MAX_CONCURRENT'];
const SECRET = 'super-secret-value~do-not-leak-0123456789';
function withEnv(values, fn) {
  const saved = Object.fromEntries(AI_ENV.map((k) => [k, process.env[k]]));
  for (const k of AI_ENV) delete process.env[k];
  Object.assign(process.env, values);
  try {
    return fn();
  } finally {
    for (const k of AI_ENV) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}
const FULL = {
  FOUNDRY_PROJECT_ENDPOINT: 'https://example-res.services.ai.azure.com/api/projects/proj1',
  FOUNDRY_AGENT_NAME: 'cyber-range-assessor',
  AZURE_TENANT_ID: '11111111-2222-3333-4444-555555555555',
  AZURE_CLIENT_ID: '66666666-7777-8888-9999-000000000000',
  AZURE_CLIENT_SECRET: SECRET,
};

test('kill switch: AI is off by default and off for any non-"on" value', () => {
  withEnv(FULL, () => assert.equal(isAiEnabled(), false));
  for (const v of ['false', '0', 'off', 'no', 'maybe', ' ', 'enabled']) {
    withEnv({ ...FULL, AI_ASSESSMENT_ENABLED: v }, () => assert.equal(isAiEnabled(), false, v));
  }
  for (const v of ['true', 'TRUE', ' on ', '1', 'yes']) {
    withEnv({ ...FULL, AI_ASSESSMENT_ENABLED: v }, () => assert.equal(isAiEnabled(), true, v));
  }
});

test('switched on but incomplete configuration stays disabled and names (only) what is missing', () => {
  withEnv({ AI_ASSESSMENT_ENABLED: 'true', FOUNDRY_PROJECT_ENDPOINT: 'http://evil.example.com/x', FOUNDRY_AGENT_NAME: 'cyber-range-assessor' }, () => {
    const c = getAiConfig();
    assert.equal(c.enabled, false);
    assert.equal(c.switchOn, true);
    assert.deepEqual(c.missing, ['FOUNDRY_PROJECT_ENDPOINT', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']);
  });
  withEnv({ ...FULL, AI_ASSESSMENT_ENABLED: 'true', FOUNDRY_AGENT_VERSION: 'latest' }, () => {
    assert.deepEqual(getAiConfig().missing, ['FOUNDRY_AGENT_VERSION']);
  });
});

test('the client secret never appears in config objects or the staff status summary', () => {
  withEnv({ ...FULL, AI_ASSESSMENT_ENABLED: 'true' }, () => {
    const c = getAiConfig();
    assert.equal(c.enabled, true);
    assert.equal(c.hasClientSecret, true);
    assert.ok(!JSON.stringify(c).includes(SECRET));
    const s = aiStatusSummary();
    assert.deepEqual(Object.keys(s).sort(), ['agentName', 'configured', 'enabled']);
    assert.ok(!JSON.stringify(s).includes(SECRET));
    assert.ok(!JSON.stringify(s).includes(FULL.AZURE_CLIENT_ID));
  });
});

test('timeouts and concurrency are clamped to safe ranges', () => {
  withEnv({ ...FULL, AI_REQUEST_TIMEOUT_MS: '1', AI_MAX_CONCURRENT: '500' }, () => {
    assert.equal(getAiConfig().requestTimeoutMs, 10_000);
    assert.equal(getAiConfig().maxConcurrent, 10);
  });
  withEnv({ ...FULL, AI_REQUEST_TIMEOUT_MS: 'abc' }, () => assert.equal(getAiConfig().requestTimeoutMs, 120_000));
});

test('permission ai_assessment.use: admin and instructor, never student', () => {
  assert.equal(can('admin', 'ai_assessment.use'), true);
  assert.equal(can('instructor', 'ai_assessment.use'), true);
  assert.equal(can('student', 'ai_assessment.use'), false);
  assert.ok(!permissionsFor('student').includes('ai_assessment.use'));
});
