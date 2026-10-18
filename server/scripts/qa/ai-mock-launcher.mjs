// Browser-QA launcher for the AI assessment screens: the real built app on an ISOLATED throwaway database
// with a MOCKED Microsoft Foundry client (no network, no Azure, no model calls, nothing billable).
//
// Usage (from server/, after `npm run build -w server` and `npm run build -w client`):
//   node scripts/qa/ai-mock-launcher.mjs --db <new-file.db> [--port 4620] [--contract 2|3] [--ai off]
//
// Refuses the real development database. The mock agent version ("mock") exists only in this process;
// no environment or agent version is selected by this script.
//
// Fixture: organization "Org QA" with Team Alpha (scoped instructor ins1 / pass12345 on "Phishing QA"),
// scenario "Phishing QA" with reference v1 (superseded, unpinned -> cleanup candidate), a failed upload
// (candidate) and v2 (current, pinned by Team Alpha), scenario "Other QA" for Team Bravo.
// Trigger words in a student entry change the mock reply: LEAKME (student text names a reference term),
// FILTERME (Prompt Shields block), BADJSON (invalid output twice), INJECTME (agent lists the entry as
// instruction-like). Foundry inventory: the tracked resources plus two UNTRACKED items.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isRealDevDb } from '../db/dbStats.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const dbPath = opt('--db') && resolve(opt('--db'));
const port = Number(opt('--port', '4620'));
const contract = opt('--contract', '3');
if (!dbPath) throw new Error('--db <new isolated file> is required');
if (isRealDevDb(dbPath, repo)) throw new Error('refusing the real development database');
if (existsSync(dbPath)) throw new Error(`${dbPath} exists — use a new throwaway file`);
if (!['2', '3'].includes(contract)) throw new Error('--contract must be 2 or 3');

Object.assign(process.env, {
  DB_PATH: dbPath,
  PORT: String(port),
  CLIENT_DIST: join(repo, 'client', 'dist'),
  AI_ASSESSMENT_ENABLED: opt('--ai', 'on') === 'off' ? 'false' : 'true',
  FOUNDRY_PROJECT_ENDPOINT: 'https://mock-qa.services.ai.azure.com/api/projects/mock',
  FOUNDRY_AGENT_NAME: 'mock-agent',
  FOUNDRY_AGENT_VERSION: '999', // mock pin, this process only
  AZURE_TENANT_ID: '00000000-0000-0000-0000-000000000000',
  AZURE_CLIENT_ID: '00000000-0000-0000-0000-000000000001',
  AZURE_CLIENT_SECRET: 'mock-not-a-secret',
  ENABLE_SCOPED_INSTRUCTORS: 'true',
});
const dist = (p) => import(pathToFileURL(join(repo, 'server', 'dist', p)).href);
const { db } = await dist('db/index.js');
const { seed } = await dist('db/seed.js');
const { createApp } = await dist('app.js');
const { setFoundryClientForTests, FoundryError } = await dist('services/ai/foundryClient.js');
const { startCyberRangeForTeam } = await dist('services/cyberRangeProgress.service.js');

let n = 0;
const log = (...a) => console.log('[mock-foundry]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const created = { stores: [], files: [] };
const extra = contract === '3' ? (instr) => ({ instructionLikeRecords: instr }) : () => ({});

function liveReply(req) {
  const entries = req.untrustedStudentInvestigation.timelineEntries;
  const all = entries.map((e) => e.body).join('\n');
  const first = entries[0];
  const second = entries[1] ?? entries[0];
  const injected = entries.filter((e) => /INJECTME/.test(e.body)).map((e) => ({ type: 'timeline_entry', id: e.id, quote: null }));
  return {
    status: entries.length >= 2 ? 'partially_on_track' : 'insufficient_evidence',
    summary: `MOCK: The team has ${entries.length} entries. They noticed the suspicious admin logon but have not linked it to the phishing mail.`,
    correctlyIdentified: first ? [{ concept: 'Suspicious privileged logon on the file server', judgement: 'correct', evidence: [{ type: 'timeline_entry', id: first.id, quote: first.body.split(/\s+/).slice(0, 4).join(' ') }], interpretation: 'Informal but accurate.' }] : [],
    partiallyUnderstood: [
      { concept: 'PowerShell execution after the logon', judgement: contract === '3' ? 'hypothesis' : 'partial', evidence: [{ type: 'timeline_entry', id: second?.id ?? 1, quote: null }], interpretation: 'Seen, not yet tied to the account.' },
      { concept: 'Fabricated reference test', judgement: 'correct', evidence: [{ type: 'timeline_entry', id: 999999, quote: null }], interpretation: 'MOCK: cites an id that does not exist — validation must drop it and flag the item.' },
    ],
    missingOrUnclear: [{ topic: 'Initial access vector (phishing mail)', expectedByNow: 'unknown', whyItMatters: 'Explains how the attacker got the admin credentials.', evidence: [] }],
    direction: { assessment: 'right_direction', explanation: 'Pivoting from the right host.' },
    instructorOnlyNotes: 'MOCK INSTRUCTOR-ONLY: ground truth step 1 (phishing mail on WS03) not found yet.',
    studentSafeFeedback: {
      teamLevel: /LEAKME/.test(all) ? 'Have a look at the phishing mail on the mail server.' : 'Good catch on the admin logon.',
      entryFeedback: first ? [{ entryId: first.id, verdict: 'on_track', text: 'Nice observation. Can you note which account and which host?' }] : [],
      guidingQuestion: 'What evidence would show whether these two events are connected?',
    },
    suggestedEntryScores: first ? [{ entryId: first.id, points: 10, rationale: 'Key observation.' }] : [],
    confidence: { level: 'medium', reason: 'Few entries so far.' },
    ...extra(injected),
    warnings: injected.length ? [`Ignored instruction-like text in timeline entry ${injected.map((r) => r.id).join(', ')}.`] : [],
  };
}

let finalRun = 0;
function finalReply(req) {
  const entries = req.untrustedStudentInvestigation.timelineEntries;
  const all = entries.map((e) => e.body).join(' ');
  const bump = finalRun++ > 0 ? 2 : 0;
  const share = { identification: 0.7, understanding: 0.6, connections: 0.5, clarity: 0.8 };
  const criteria = req.rubric.criteria.map((c) => ({ key: c.key, maxPoints: c.maxPoints, awardedPoints: Math.min(c.maxPoints, Math.round(c.maxPoints * share[c.key]) + bump), rationale: `MOCK rationale for ${c.key}.` }));
  return {
    investigationSummary: `MOCK FINAL: ${entries.length} entries; the privileged logon and PowerShell were identified, the phishing mail was not.`,
    overallAssessment: { level: 'good', text: 'Later stages found; initial access missed.' },
    stages: [
      { stage: 'Initial access via phishing mail', judgement: 'not_documented', evidence: [], interpretation: 'Nothing mentions the mail.' },
      { stage: 'Privileged logon on FS01', judgement: 'correct', evidence: entries[0] ? [{ type: 'timeline_entry', id: entries[0].id, quote: null }] : [], interpretation: 'Clearly described.' },
      { stage: 'PowerShell execution', judgement: contract === '3' ? 'hypothesis' : 'partial', evidence: entries[1] ? [{ type: 'timeline_entry', id: entries[1].id, quote: null }] : [], interpretation: 'Proposed, not confirmed.' },
    ],
    incorrectConclusions: [],
    strengths: ['Quick detection of the admin logon'],
    areasForImprovement: ['Explain what the PowerShell did'],
    score: { criteria, recommendedTotal: criteria.reduce((s, c) => s + c.awardedPoints, 0), maxTotal: 100, explanation: 'MOCK.' },
    suggestedFinalFeedback: { instructorVersion: 'MOCK: missed the phishing mail on WS03.', studentSafeVersion: /LEAKME/.test(all) ? 'Great work. Next time look for the phishing mail.' : 'Great work on the logon.' },
    confidence: { level: 'high', reason: 'Enough entries.' },
    ...extra([]),
    warnings: bump ? ['Instruction-like text was ignored.'] : [], // 2nd final: unverified warning (no such record)
  };
}

setFoundryClientForTests({
  async uploadFile({ filename }) {
    const fileId = `assistant-MOCK${++n}`;
    created.files.push({ id: fileId, filename });
    log('uploadFile', filename, fileId);
    return { fileId };
  },
  async createVectorStore({ name }) {
    const id = `vs_MOCK${++n}`;
    created.stores.push({ id, name });
    log('createVectorStore', name, id);
    return { vectorStoreId: id };
  },
  async waitForVectorStore(id) {
    await sleep(400);
    const failed = created.stores.find((s) => s.id === id)?.name.includes('FAIL') || pendingFail;
    pendingFail = false;
    return failed ? { ok: false, storeStatus: 'completed', fileStatus: 'failed', errorCode: 'unsupported_file', usageBytes: 0 } : { ok: true, storeStatus: 'completed', fileStatus: 'completed', errorCode: null, usageBytes: 1234 };
  },
  async deleteVectorStore(id) { log('MOCK deleteVectorStore (approved cleanup)', id); created.stores = created.stores.filter((s) => s.id !== id); },
  async deleteFile(id) { log('MOCK deleteFile (approved cleanup)', id); created.files = created.files.filter((f) => f.id !== id); },
  async listInventory() {
    log('listInventory (read-only)');
    const at = new Date().toISOString();
    return {
      vectorStores: [...created.stores.map((s) => ({ id: s.id, name: s.name, status: 'completed', createdAt: at, usageBytes: 1234, fileCount: 1 })), { id: 'vs_UNTRACKEDtestStore', name: 'cr-eval-cobalt-lynx-v1 (script-created)', status: 'completed', createdAt: at, usageBytes: 2078, fileCount: 1 }],
      files: [...created.files.map((f) => ({ id: f.id, filename: f.filename, bytes: 100, purpose: 'assistants', createdAt: at })), { id: 'assistant-UNTRACKEDtestFile', filename: 'cobalt-lynx-reference-v1.txt', bytes: 1054, purpose: 'assistants', createdAt: at }],
      agentVersions: [{ version: '999', description: 'MOCK pinned version', createdAt: at }, { version: '998', description: 'MOCK older version', createdAt: at }],
      truncated: { vectorStores: false, files: false, agentVersions: false },
    };
  },
  async invokeAssessment({ vectorStoreId, input }) {
    log('invokeAssessment', vectorStoreId, `${input.length} chars`);
    await sleep(3000);
    if (/FILTERME/.test(input)) throw new FoundryError('ai_content_filtered', { filterCategories: ['jailbreak'] });
    const meta = { responseId: `resp_mock${++n}`, responseStatus: 'completed', incompleteReason: null, model: 'gpt-4.1-mock', agentName: 'mock-agent', agentVersion: '999', usage: { inputTokens: 5000, cachedInputTokens: 0, outputTokens: 900 }, fileSearchCalls: 1 };
    if (/BADJSON/.test(input)) return { ...meta, outputText: '{"not":"valid"}' };
    const req = JSON.parse(input);
    const result = req.mode === 'final' ? finalReply(req) : liveReply(req);
    return { ...meta, outputText: JSON.stringify({ contractVersion: contract, mode: req.mode, result }) };
  },
});
let pendingFail = false;

seed();
const now = () => new Date().toISOString();
const day = db.prepare('SELECT id FROM days LIMIT 1').get().id;
const org = Number(db.prepare('INSERT INTO organizations (name, created_at) VALUES (?, ?)').run('Org QA', now()).lastInsertRowid);
const range = (name) => Number(db.prepare("INSERT INTO cyber_ranges (day_id, name, difficulty, sort_order, expected_duration_minutes, student_briefing) VALUES (?, ?, 'intermediate', 1, 90, 'Investigate suspicious activity reported on the file server FS01.')").run(day, name).lastInsertRowid);
const phishing = range('Phishing QA');
const other = range('Other QA');
db.prepare("UPDATE teams SET organization_id = ? WHERE name IN ('Team Alpha', 'Team Bravo')").run(org);
const acc = Number(db.prepare("INSERT INTO accounts (username, password, role, display_name, created_at) VALUES ('ins1', 'pass12345', 'instructor', 'Instructor One', ?)").run(now()).lastInsertRowid);
db.prepare('INSERT INTO instructor_assignments (account_id, organization_id, cyber_range_id, created_at) VALUES (?, ?, ?, ?)').run(acc, org, phishing, now());
db.prepare("INSERT INTO cyber_range_expected_ttps (cyber_range_id, technique_id, tactic_id, points, is_active, sort_order, created_at, updated_at) VALUES (?, 'T1566.001', 'TA0001', 10, 1, 1, ?, ?)").run(phishing, now(), now());

createApp().listen(port, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${port}/api`;
  const login = async (u, p) => (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token;
  const admin = await login('instructor', 'instructor123');
  const upload = async (r, filename, text) => {
    const res = await fetch(`${base}/admin/cyber-ranges/${r}/ai-documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` }, body: JSON.stringify({ filename, contentBase64: Buffer.from(text).toString('base64') }) });
    console.log('[qa] upload', filename, res.status);
    await sleep(1200);
  };
  await upload(phishing, 'phishing-reference-v1.txt', 'Ground truth (QA) v1: 1. phishing mail on WS03. 2. admin logon on FS01. 3. PowerShell.');
  pendingFail = true;
  await upload(phishing, 'phishing-reference-broken.txt', 'Ground truth (QA) broken upload.');
  await upload(phishing, 'phishing-reference-v3.txt', 'Ground truth (QA) v3: 1. phishing mail on WS03. 2. admin logon on FS01. 3. encoded PowerShell.');
  const alpha = db.prepare("SELECT id FROM teams WHERE name = 'Team Alpha'").get().id;
  const bravo = db.prepare("SELECT id FROM teams WHERE name = 'Team Bravo'").get().id;
  startCyberRangeForTeam(alpha, phishing);
  startCyberRangeForTeam(bravo, other);
  const user = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
  const add = (team, r, u, body) => db.prepare('INSERT INTO documentation_entries (team_id, cyber_range_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(team, r, user(u), body, now());
  add(alpha, phishing, 'alice', 'we saw someone log into the file server FS01 with an admin acount at 09:12');
  add(alpha, phishing, 'bob', 'then weird powershell ran on FS01 right after the login, encoded command');
  add(bravo, other, 'carol', 'bravo entry on another scenario');
  console.log(`[qa] contract ${contract}; Phishing QA=${phishing}, Other QA=${other}, Team Alpha=${alpha}, Team Bravo=${bravo}`);
  console.log(`[qa] listening on http://127.0.0.1:${port}  (admin instructor/instructor123, scoped ins1/pass12345, students alice/bob)`);
});
