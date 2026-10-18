// Live Microsoft Foundry validation of the AI assessment feature (approved by the user 2026-10-15).
// Standalone tooling — not app code. Runs the REAL app (built server) against an ISOLATED database with
// the real Foundry REST client wrapped in a hard ledger.
//
// Usage (from server/, after `npm run build`):
//   node scripts/ai-live-validation.mjs inspect       --state <dir>              read-only: agent versions + stores
//   node scripts/ai-live-validation.mjs create-agent  --state <dir>              ONE new agent version (once)
//   node scripts/ai-live-validation.mjs serve         --state <dir> --port <p> [--db <file>]   app on an isolated DB
// Limits can be tightened per run: --max-requests N --budget USD --max-files N --max-stores N
// (2026-10-18 stabilization run: 6 requests, $1, 0 files, 0 stores — reuses the existing test stores).
//   node scripts/ai-live-validation.mjs ledger        --state <dir>
//
// Phase 8 live evaluation (approved 2026-10-18: v7, 51 requests, $2, 1 file, 1 vector store):
//   create-agent  ... --instructions <md> --text-format <json> [--temperature 0] [--description "..."]
//   upload-reference --state <dir> --scenario cobalt-lynx        1 file + 1 vector store from ai-eval/scenarios
//   eval-run --state <dir> --agent-version <v> --fixtures <ids|scenario> --runs 3 --out <dir>
//            --store <scenario>=<vs_id>[,...] --doc-version <scenario>=<n>[,...]
//       Sends the calibration fixtures (server/scripts/ai-eval) straight to the pinned agent version with the
//       app's own request builder. Every run of a fixture gets the byte-identical input; no app database is
//       used. Resumable: an existing output file is never re-requested. No retries (each request counts).
//
// Approved limits: 1 new agent version (existing versions preserved), 2 files, 2 vector stores, at most
// 12 model requests (every HTTP POST /responses counts, including rejected ones), planned spend $2 with a
// stop rule checked BEFORE each request. Deletion of any Foundry resource is refused — cleanup needs a
// separate approval. Never prints secrets.
import { config as loadEnv } from 'dotenv';
import { ClientSecretCredential } from '@azure/identity';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const stateDir = opt('--state') && resolve(opt('--state'));
if (!cmd || !stateDir) {
  console.error('usage: node scripts/ai-live-validation.mjs <inspect|create-agent|serve|ledger> --state <dir> [--port <p>]');
  process.exit(2);
}
mkdirSync(stateDir, { recursive: true });

const num = (name, fallback) => (opt(name) !== undefined ? Number(opt(name)) : fallback);
const LIMITS = {
  maxModelRequests: num('--max-requests', 12),
  budgetUsd: num('--budget', 2),
  maxFiles: num('--max-files', 2),
  maxVectorStores: num('--max-stores', 2),
  maxAgentVersions: 1,
};
for (const [k, v] of Object.entries(LIMITS)) if (!Number.isFinite(v) || v < 0) throw new Error(`bad limit ${k}`);
// gpt-4.1 Global retail ($2 in / $0.50 cached / $8 out per 1M) + an assumed $0.0025 per File Search call.
const PRICE = { inPerM: 2.0, cachedInPerM: 0.5, outPerM: 8.0, fileSearchCall: 0.0025 };
// Worst case of ONE more request (30k input + 5k output + 2 searches) — the stop rule reserves it.
const WORST_CASE_NEXT_USD = 0.105;

const ledgerPath = join(stateDir, 'ledger.json');
const ledger = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
  : { requests: [], files: [], vectorStores: [], agentVersionsCreated: [], refusedDeletes: [], notes: [] };
const saveLedger = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
const spent = () => ledger.requests.reduce((s, r) => s + (r.costUsd ?? 0), 0);
const costOf = (usage, searches) =>
  usage
    ? ((usage.input_tokens - (usage.input_tokens_details?.cached_tokens ?? 0)) * PRICE.inPerM +
        (usage.input_tokens_details?.cached_tokens ?? 0) * PRICE.cachedInPerM +
        usage.output_tokens * PRICE.outPerM) /
        1e6 +
      searches * PRICE.fileSearchCall
    : 0;

function printLedger() {
  console.log(`model requests: ${ledger.requests.length}/${LIMITS.maxModelRequests}, est. spend $${spent().toFixed(4)} of $${LIMITS.budgetUsd}`);
  for (const r of ledger.requests) {
    console.log(`  #${r.n} ${r.at} HTTP ${r.status} ${r.ms} ms in=${r.inputTokens ?? '-'} (cached ${r.cachedTokens ?? '-'}) out=${r.outputTokens ?? '-'} search=${r.fileSearchCalls} $${(r.costUsd ?? 0).toFixed(4)} ${r.label ?? ''}`);
  }
  console.log(`files: ${ledger.files.map((f) => f.id).join(', ') || 'none'}`);
  console.log(`vector stores: ${ledger.vectorStores.map((v) => v.id).join(', ') || 'none'}`);
  console.log(`agent versions created: ${ledger.agentVersionsCreated.map((a) => `${a.name} v${a.version}`).join(', ') || 'none'}`);
  if (ledger.refusedDeletes.length) console.log(`REFUSED deletes: ${JSON.stringify(ledger.refusedDeletes)}`);
}

// ---------------------------------------------------------------------------------------------
// Direct REST (agent definition management only).
async function restSession() {
  loadEnv({ path: join(repo, '.env'), quiet: true });
  for (const k of ['FOUNDRY_PROJECT_ENDPOINT', 'FOUNDRY_AGENT_NAME', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']) {
    if (!process.env[k]) throw new Error(`missing env ${k}`);
  }
  const endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT.replace(/\/+$/, '');
  const agentName = process.env.FOUNDRY_AGENT_NAME;
  const credential = new ClientSecretCredential(process.env.AZURE_TENANT_ID, process.env.AZURE_CLIENT_ID, process.env.AZURE_CLIENT_SECRET);
  const call = async (method, path, json) => {
    const t = await credential.getToken('https://ai.azure.com/.default');
    const res = await fetch(`${endpoint}${path}`, {
      method,
      headers: { Authorization: `Bearer ${t.token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 1000);
    }
    return { status: res.status, body };
  };
  return { call, agentName };
}

const summariseDef = (d) => ({
  kind: d?.kind,
  model: d?.model,
  instructions: typeof d?.instructions === 'string' ? `<${d.instructions.length} chars>` : d?.instructions,
  tools: d?.tools,
  structured_inputs: d?.structured_inputs ? Object.keys(d.structured_inputs) : undefined,
  text: d?.text?.format ? { type: d.text.format.type, name: d.text.format.name, strict: d.text.format.strict } : d?.text,
  other_keys: Object.keys(d ?? {}).filter((k) => !['kind', 'model', 'instructions', 'tools', 'structured_inputs', 'text'].includes(k)),
});

async function inspect() {
  const { call, agentName } = await restSession();
  const a = await call('GET', `/agents/${encodeURIComponent(agentName)}?api-version=v1`);
  console.log(`GET agent -> ${a.status}; latest version: ${a.body?.versions?.latest?.version}`);
  const v = await call('GET', `/agents/${encodeURIComponent(agentName)}/versions?api-version=v1`);
  console.log(`GET versions -> ${v.status}`);
  for (const ver of v.body?.data ?? []) console.log(`  v${ver.version} "${ver.description ?? ''}"`, JSON.stringify(summariseDef(ver.definition)));
  const vs = await call('GET', '/openai/v1/vector_stores?limit=50');
  console.log(`vector stores (${vs.status}): ${(vs.body?.data ?? []).map((s) => `${s.id.slice(0, 7)}… "${s.name}"`).join(', ')}`);
}

async function createAgent() {
  if (ledger.agentVersionsCreated.length >= LIMITS.maxAgentVersions) throw new Error(`STOP: already created ${JSON.stringify(ledger.agentVersionsCreated)}`);
  const instructionsPath = opt('--instructions') ? resolve(opt('--instructions')) : join(repo, 'docs', 'ai-agent', 'agent-instructions.md');
  const textFormatPath = opt('--text-format') ? resolve(opt('--text-format')) : join(repo, 'docs', 'ai-agent', 'agent-text-format.json');
  const extraDefinition = opt('--temperature') !== undefined ? { temperature: Number(opt('--temperature')) } : {};
  const { call, agentName } = await restSession();
  const versions = await call('GET', `/agents/${encodeURIComponent(agentName)}/versions?api-version=v1`);
  if (versions.status !== 200) throw new Error(`STOP: cannot list versions (${versions.status})`);
  const base = (versions.body.data ?? []).find((x) => x.version === '3');
  if (!base) throw new Error('STOP: production base v3 not found');
  const instructions = readFileSync(instructionsPath, 'utf8')
    .split('<!-- BEGIN AGENT INSTRUCTIONS -->')[1]
    .split('<!-- END AGENT INSTRUCTIONS -->')[0]
    .trim();
  const text = JSON.parse(readFileSync(textFormatPath, 'utf8'));
  // v3's definition (model, File Search with {{vector_store_id}}, structured input, any safety settings)
  // + the production instructions + the full envelope schema. Nothing else changes.
  const body = {
    description: opt('--description') ?? 'Production candidate: full assessment instructions + contract envelope schema',
    definition: { ...base.definition, instructions, text, ...extraDefinition },
  };
  const r = await call('POST', `/agents/${encodeURIComponent(agentName)}/versions?api-version=v1`, body);
  console.log(`create agent version -> ${r.status}`);
  if (r.status >= 300) {
    console.log(JSON.stringify(r.body).slice(0, 1500));
    throw new Error('STOP: agent version not created');
  }
  ledger.agentVersionsCreated.push({ name: agentName, version: r.body.version, at: new Date().toISOString(), instructionsChars: instructions.length, instructionsPath, textFormatPath, extraDefinition, storedTemperature: r.body.definition?.temperature ?? null });
  saveLedger();
  console.log(`created ${agentName} v${r.body.version}:`, JSON.stringify(summariseDef(r.body.definition)));
  const after = await call('GET', `/agents/${encodeURIComponent(agentName)}/versions?api-version=v1`);
  console.log(`versions now: ${(after.body?.data ?? []).map((x) => `v${x.version}`).join(', ')}`);
}

// Counting fetch: EVERY model request (POST /responses) is capped and ledgered before it is sent.
async function countingFetch(url, init) {
  const isModel = init?.method === 'POST' && /\/openai\/v1\/responses(\?|$)/.test(url);
  if (!isModel) return fetch(url, init);
  if (ledger.requests.length >= LIMITS.maxModelRequests) throw new Error(`STOP: model request cap ${LIMITS.maxModelRequests} reached`);
  if (spent() + WORST_CASE_NEXT_USD > LIMITS.budgetUsd) throw new Error(`STOP: projected spend would pass $${LIMITS.budgetUsd}`);
  const entry = { n: ledger.requests.length + 1, at: new Date().toISOString(), status: null, ms: null, label: process.env.LIVE_LABEL ?? '' };
  ledger.requests.push(entry);
  saveLedger();
  const started = Date.now();
  const res = await fetch(url, init);
  entry.ms = Date.now() - started;
  entry.status = res.status;
  const text = await res.clone().text();
  try {
    const b = JSON.parse(text);
    const searches = (b.output ?? []).filter((o) => o.type === 'file_search_call').length;
    entry.inputTokens = b.usage?.input_tokens ?? null;
    entry.cachedTokens = b.usage?.input_tokens_details?.cached_tokens ?? null;
    entry.outputTokens = b.usage?.output_tokens ?? null;
    entry.fileSearchCalls = searches;
    entry.agentVersion = b.agent_reference?.version ?? null;
    entry.model = b.model ?? null;
    entry.responseStatus = b.status ?? null;
    entry.costUsd = res.ok ? costOf(b.usage, searches) : 0;
    if (!res.ok) entry.error = { code: b.error?.code ?? null, type: b.error?.type ?? null, innerCode: b.error?.innererror?.code ?? null };
  } catch {
    entry.costUsd = res.ok ? WORST_CASE_NEXT_USD : 0; // unknown usage on success: charge the worst case
  }
  saveLedger();
  console.log(`[live] model request #${entry.n}: HTTP ${entry.status} ${entry.ms} ms in=${entry.inputTokens} out=${entry.outputTokens} search=${entry.fileSearchCalls} ≈$${(entry.costUsd ?? 0).toFixed(4)} | total ≈$${spent().toFixed(4)} (${ledger.requests.length}/${LIMITS.maxModelRequests})`);
  return res;
}

// ---------------------------------------------------------------------------------------------
// The app on an isolated DB with a ledgered real client.
async function serve() {
  const port = Number(opt('--port') ?? 4630);
  const agentVersion = ledger.agentVersionsCreated[0]?.version;
  if (!agentVersion) throw new Error('STOP: create the agent version first');
  const dbPath = opt('--db') ? resolve(opt('--db')) : join(stateDir, 'live.db');
  // Set BEFORE the server's dotenv runs (dotenv never overrides): isolated DB, AI on, one job at a time,
  // pinned to the new agent version. Real credentials come from the root .env.
  Object.assign(process.env, {
    DB_PATH: dbPath,
    PORT: String(port),
    CLIENT_DIST: join(repo, 'client', 'dist'),
    AI_ASSESSMENT_ENABLED: 'true',
    AI_MAX_CONCURRENT: '1',
    FOUNDRY_AGENT_VERSION: String(agentVersion),
    ENABLE_SCOPED_INSTRUCTORS: 'true',
  });
  const dist = (p) => import(pathToFileURL(join(repo, 'server', 'dist', p)).href);
  const { db } = await dist('db/index.js');
  const { seed } = await dist('db/seed.js');
  const { createApp } = await dist('app.js');
  const { getAiConfig } = await dist('services/ai/aiConfig.js');
  const fc = await dist('services/ai/foundryClient.js');
  const aiConfig = getAiConfig();
  if (!aiConfig.enabled || !aiConfig.configured) throw new Error('STOP: AI not configured from .env');
  console.log(`[live] isolated DB: ${dbPath}`);
  console.log(`[live] agent ${aiConfig.agentName} pinned to v${aiConfig.agentVersion}`);
  console.log(`[live] limits: ${JSON.stringify(LIMITS)}`);

  const real = fc.createRestFoundryClient({ config: aiConfig, fetchImpl: countingFetch, maxRetries: 0 });
  fc.setFoundryClientForTests({
    async uploadFile(input) {
      if (ledger.files.length >= LIMITS.maxFiles) throw new fc.FoundryError('ai_bad_request');
      const r = await real.uploadFile(input);
      ledger.files.push({ id: r.fileId, filename: input.filename, bytes: input.bytes.length, at: new Date().toISOString() });
      saveLedger();
      console.log(`[live] file created: ${r.fileId} (${input.filename})`);
      return r;
    },
    async createVectorStore(input) {
      if (ledger.vectorStores.length >= LIMITS.maxVectorStores) throw new fc.FoundryError('ai_bad_request');
      const r = await real.createVectorStore(input);
      ledger.vectorStores.push({ id: r.vectorStoreId, name: input.name, fileIds: input.fileIds, at: new Date().toISOString() });
      saveLedger();
      console.log(`[live] vector store created: ${r.vectorStoreId} (${input.name})`);
      return r;
    },
    waitForVectorStore: (id, o) => real.waitForVectorStore(id, o),
    invokeAssessment: (input) => real.invokeAssessment(input),
    // Cleanup is NOT authorized: refuse and record.
    async deleteVectorStore(id) {
      ledger.refusedDeletes.push({ kind: 'vector_store', id, at: new Date().toISOString() });
      saveLedger();
      throw new fc.FoundryError('ai_bad_request');
    },
    async deleteFile(id) {
      ledger.refusedDeletes.push({ kind: 'file', id, at: new Date().toISOString() });
      saveLedger();
      throw new fc.FoundryError('ai_bad_request');
    },
  });

  seed();
  createApp().listen(port, '127.0.0.1', () => console.log(`[live] listening on http://127.0.0.1:${port}`));
  void db;
}

// ---------------------------------------------------------------------------------------------
// Phase 8: a ledgered real client outside the app (no app database).
async function evalClient(agentVersion) {
  loadEnv({ path: join(repo, '.env'), quiet: true });
  // In-process only: the .env file is never written.
  process.env.AI_ASSESSMENT_ENABLED = 'true';
  process.env.FOUNDRY_AGENT_VERSION = String(agentVersion);
  process.env.DB_PATH = join(stateDir, 'eval-unused.db'); // isolated, in case any import opens the app DB
  const dist = (p) => import(pathToFileURL(join(repo, 'server', 'dist', p)).href);
  const { getAiConfig } = await dist('services/ai/aiConfig.js');
  const fc = await dist('services/ai/foundryClient.js');
  const aiConfig = getAiConfig();
  if (!aiConfig.enabled || !aiConfig.configured) throw new Error(`STOP: AI not configured (${aiConfig.missing?.join(', ')})`);
  return { fc, aiConfig, client: fc.createRestFoundryClient({ config: aiConfig, fetchImpl: countingFetch, maxRetries: 0 }), dist };
}

const pairs = (v) => Object.fromEntries((v ?? '').split(',').filter(Boolean).map((x) => x.split('=')));

async function uploadReference() {
  const scenario = opt('--scenario');
  const dataset = JSON.parse(readFileSync(join(here, 'ai-eval', 'calibration-dataset.json'), 'utf8'));
  const sc = dataset.scenarios[scenario];
  if (!sc) throw new Error(`unknown scenario ${scenario}`);
  if (ledger.files.length >= LIMITS.maxFiles) throw new Error(`STOP: file cap ${LIMITS.maxFiles} reached`);
  if (ledger.vectorStores.length >= LIMITS.maxVectorStores) throw new Error(`STOP: vector store cap ${LIMITS.maxVectorStores} reached`);
  const { client } = await evalClient(ledger.agentVersionsCreated[0]?.version ?? '6');
  const bytes = readFileSync(join(here, 'ai-eval', sc.reference));
  const filename = `${scenario}-reference-v1.txt`;
  const { fileId } = await client.uploadFile({ bytes, filename, mimeType: 'text/plain' });
  ledger.files.push({ id: fileId, filename, bytes: bytes.length, at: new Date().toISOString() });
  saveLedger();
  console.log(`file created: ${fileId} (${filename}, ${bytes.length} bytes)`);
  const name = `cr-eval-${scenario}-v1`;
  const { vectorStoreId } = await client.createVectorStore({ name, fileIds: [fileId] });
  ledger.vectorStores.push({ id: vectorStoreId, name, fileIds: [fileId], at: new Date().toISOString() });
  saveLedger();
  console.log(`vector store created: ${vectorStoreId} (${name})`);
  const st = await client.waitForVectorStore(vectorStoreId, { timeoutMs: 300_000 });
  console.log(`vector store state: ${JSON.stringify(st)}`);
}

async function evalRun() {
  const agentVersion = opt('--agent-version');
  if (!agentVersion) throw new Error('--agent-version is required');
  const outDir = resolve(opt('--out'));
  mkdirSync(outDir, { recursive: true });
  const runs = Number(opt('--runs') ?? 3);
  const stores = pairs(opt('--store'));
  const docVersions = pairs(opt('--doc-version'));
  const { client, dist } = await evalClient(agentVersion);
  const { buildAssessmentInput } = await dist('services/ai/assessmentRunner.service.js');
  const { createHash } = await import('node:crypto');
  const harness = await import(pathToFileURL(join(here, 'ai-eval', 'evaluate.mjs')).href);
  const sel = (opt('--fixtures') ?? '').split(',').filter(Boolean);
  const fixtures = harness.dataset.fixtures.filter((f) => sel.includes(f.id) || sel.includes(f.scenario));
  if (!fixtures.length) throw new Error('no fixtures selected');
  let consecutiveInvalid = 0;
  for (const fx of fixtures) {
    const vectorStoreId = stores[fx.scenario];
    if (!/^vs_[A-Za-z0-9]+$/.test(vectorStoreId ?? '')) throw new Error(`no --store for ${fx.scenario}`);
    // ONE input per fixture, reused byte-for-byte for every run (same snapshot, metadata, document version).
    const input = buildAssessmentInput('final', harness.snapshotFor(fx), Number(docVersions[fx.scenario] ?? 1), harness.dataset.rubric);
    const inputSha256 = createHash('sha256').update(input).digest('hex');
    for (let run = 1; run <= runs; run++) {
      const file = join(outDir, `${fx.id}__v${agentVersion}__${run}.json`);
      if (existsSync(file)) { console.log(`skip ${fx.id} run ${run} (exists)`); continue; }
      // The client maps a fetch exception to ai_unavailable, so the caps are checked here as well.
      if (ledger.requests.length >= LIMITS.maxModelRequests) { console.error(`STOP: model request cap ${LIMITS.maxModelRequests} reached`); printLedger(); return; }
      if (spent() + WORST_CASE_NEXT_USD > LIMITS.budgetUsd) { console.error(`STOP: projected spend would pass $${LIMITS.budgetUsd}`); printLedger(); return; }
      process.env.LIVE_LABEL = `eval ${fx.id} run ${run}`;
      const out = { fixture: fx.id, run, mode: 'final', agentVersion: String(agentVersion), vectorStoreId, inputSha256, at: new Date().toISOString() };
      try {
        const r = await client.invokeAssessment({ vectorStoreId, input, maxOutputTokens: 3000 });
        Object.assign(out, { outputText: r.outputText, reportedAgentVersion: r.agentVersion, model: r.model, fileSearchCalls: r.fileSearchCalls, responseStatus: r.responseStatus, incompleteReason: r.incompleteReason, usage: r.usage });
      } catch (e) {
        if (String(e?.message ?? '').startsWith('STOP:')) { console.error(e.message); return; }
        Object.assign(out, { outputText: '', error: e?.code ?? 'internal_error', filterCategories: e?.filterCategories ?? [] });
      }
      out.ledgerRequest = ledger.requests.at(-1)?.n ?? null;
      writeFileSync(file, JSON.stringify(out, null, 2));
      const row = out.error ? { valid: false, errorCode: out.error } : harness.evaluateOutput({ fx, mode: 'final', outputText: out.outputText, snapshot: harness.snapshotFor(fx), label: `v${agentVersion}`, run, fileSearchCalls: out.fileSearchCalls });
      console.log(`  ${fx.id} run ${run}: ${row.valid ? `valid total=${row.total} (${fx.expected.total.join('-')}) stages=${row.stages.join(',')}` : `INVALID ${row.errorCode}`}`);
      consecutiveInvalid = row.valid ? 0 : consecutiveInvalid + 1;
      if (consecutiveInvalid >= 3) { console.error('STOP: 3 invalid replies in a row — systemic problem, not spending more'); return; }
    }
  }
  printLedger();
}

if (cmd === 'inspect') await inspect();
else if (cmd === 'upload-reference') await uploadReference();
else if (cmd === 'eval-run') await evalRun();
else if (cmd === 'create-agent') await createAgent();
else if (cmd === 'serve') await serve();
else if (cmd === 'ledger') printLedger();
else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
