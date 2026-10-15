// Live Microsoft Foundry validation of the AI assessment feature (approved by the user 2026-10-15).
// Standalone tooling — not app code. Runs the REAL app (built server) against an ISOLATED database with
// the real Foundry REST client wrapped in a hard ledger.
//
// Usage (from server/, after `npm run build`):
//   node scripts/ai-live-validation.mjs inspect       --state <dir>              read-only: agent versions + stores
//   node scripts/ai-live-validation.mjs create-agent  --state <dir>              ONE new agent version (once)
//   node scripts/ai-live-validation.mjs serve         --state <dir> --port <p>   app on an isolated DB in <dir>
//   node scripts/ai-live-validation.mjs ledger        --state <dir>
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

export const LIMITS = { maxModelRequests: 12, budgetUsd: 2, maxFiles: 2, maxVectorStores: 2, maxAgentVersions: 1 };
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
  const { call, agentName } = await restSession();
  const versions = await call('GET', `/agents/${encodeURIComponent(agentName)}/versions?api-version=v1`);
  if (versions.status !== 200) throw new Error(`STOP: cannot list versions (${versions.status})`);
  const base = (versions.body.data ?? []).find((x) => x.version === '3');
  if (!base) throw new Error('STOP: production base v3 not found');
  const instructions = readFileSync(join(repo, 'docs', 'ai-agent', 'agent-instructions.md'), 'utf8')
    .split('<!-- BEGIN AGENT INSTRUCTIONS -->')[1]
    .split('<!-- END AGENT INSTRUCTIONS -->')[0]
    .trim();
  const text = JSON.parse(readFileSync(join(repo, 'docs', 'ai-agent', 'agent-text-format.json'), 'utf8'));
  // v3's definition (model, File Search with {{vector_store_id}}, structured input, any safety settings)
  // + the production instructions + the full envelope schema. Nothing else changes.
  const body = {
    description: 'Production candidate: full assessment instructions + contract v1 envelope schema (live validation 2026-10-15)',
    definition: { ...base.definition, instructions, text },
  };
  const r = await call('POST', `/agents/${encodeURIComponent(agentName)}/versions?api-version=v1`, body);
  console.log(`create agent version -> ${r.status}`);
  if (r.status >= 300) {
    console.log(JSON.stringify(r.body).slice(0, 1500));
    throw new Error('STOP: agent version not created');
  }
  ledger.agentVersionsCreated.push({ name: agentName, version: r.body.version, at: new Date().toISOString(), instructionsChars: instructions.length });
  saveLedger();
  console.log(`created ${agentName} v${r.body.version}:`, JSON.stringify(summariseDef(r.body.definition)));
  const after = await call('GET', `/agents/${encodeURIComponent(agentName)}/versions?api-version=v1`);
  console.log(`versions now: ${(after.body?.data ?? []).map((x) => `v${x.version}`).join(', ')}`);
}

// ---------------------------------------------------------------------------------------------
// The app on an isolated DB with a ledgered real client.
async function serve() {
  const port = Number(opt('--port') ?? 4630);
  const agentVersion = ledger.agentVersionsCreated[0]?.version;
  if (!agentVersion) throw new Error('STOP: create the agent version first');
  const dbPath = join(stateDir, 'live.db');
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

  // Counting fetch: EVERY model request (POST /responses) is capped and ledgered before it is sent.
  const countingFetch = async (url, init) => {
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
  };
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

if (cmd === 'inspect') await inspect();
else if (cmd === 'create-agent') await createAgent();
else if (cmd === 'serve') await serve();
else if (cmd === 'ledger') printLedger();
else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
