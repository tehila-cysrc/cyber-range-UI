import assert from 'node:assert/strict';
import { test } from 'node:test';

// Foundry client — wire format verified live in Phase 0 (docs/ai-assessment-foundry-poc.md), exercised
// here with a fake fetch. NO network, NO model calls.
const { createRestFoundryClient, getFoundryClient, setFoundryClientForTests, FoundryError, classifyFoundryResponse } =
  await import('../dist/services/ai/foundryClient.js');

const SENTINEL = 'STUDENT-TEXT-SENTINEL-must-not-leak';
const CONFIG = {
  enabled: true, switchOn: true, configured: true, missing: [],
  projectEndpoint: 'https://res.services.ai.azure.com/api/projects/p1',
  agentName: 'cyber-range-assessor', agentVersion: null,
  tenantId: '11111111-2222-3333-4444-555555555555', clientId: '66666666-7777-8888-9999-000000000000',
  hasClientSecret: true, requestTimeoutMs: 30_000, maxConcurrent: 3,
};
const VS = 'vs_JleY4ImVLVRXoGeYRS9gVegT';

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

// A scripted fake: each call pops the next response (or a function of the request).
function fakeFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method, headers: init.headers, body });
    const next = script.shift();
    if (!next) throw new Error('unexpected extra request');
    return typeof next === 'function' ? next({ url, init, body }) : next;
  };
  fn.calls = calls;
  return fn;
}

const client = (fetchImpl, config = CONFIG) =>
  createRestFoundryClient({ config, fetchImpl, getToken: async () => 'fake-token', sleep: async () => {} });

const OK_RESPONSE = {
  id: 'resp_1', status: 'completed', model: 'gpt-4.1',
  agent_reference: { type: 'agent_reference', name: 'cyber-range-assessor', version: '4' },
  output: [
    { type: 'file_search_call', id: 'fs_1' },
    { type: 'message', content: [{ type: 'output_text', text: '{"contractVersion":"1"}' }] },
  ],
  usage: { input_tokens: 1890, output_tokens: 275, input_tokens_details: { cached_tokens: 1152 } },
};

test('invokeAssessment sends exactly the Phase-0-verified request shape', async () => {
  const f = fakeFetch([json(200, OK_RESPONSE)]);
  await client(f).invokeAssessment({ vectorStoreId: VS, input: '{"mode":"live"}' });
  const [call] = f.calls;
  assert.equal(call.url, 'https://res.services.ai.azure.com/api/projects/p1/openai/v1/responses');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.Authorization, 'Bearer fake-token');
  assert.deepEqual(call.body.agent_reference, { type: 'agent_reference', name: 'cyber-range-assessor' });
  assert.deepEqual(call.body.structured_inputs, { vector_store_id: VS });
  assert.equal(call.body.tool_choice, 'required'); // mandatory File Search (Phase 0 finding 8)
  assert.equal(call.body.store, false);
  assert.equal(call.body.input, '{"mode":"live"}');
  // Agent-owned behaviour: the app never sends instructions or a per-request schema.
  for (const forbidden of ['text', 'instructions', 'tools', 'model', 'temperature']) assert.ok(!(forbidden in call.body), forbidden);
});

test('invokeAssessment returns text, agent version, usage and the retrieval count', async () => {
  const r = await client(fakeFetch([json(200, OK_RESPONSE)])).invokeAssessment({ vectorStoreId: VS, input: '{}' });
  assert.equal(r.outputText, '{"contractVersion":"1"}');
  assert.equal(r.agentVersion, '4');
  assert.equal(r.model, 'gpt-4.1');
  assert.equal(r.responseId, 'resp_1');
  assert.equal(r.fileSearchCalls, 1);
  assert.deepEqual(r.usage, { inputTokens: 1890, cachedInputTokens: 1152, outputTokens: 275 });
  const noSearch = await client(fakeFetch([json(200, { ...OK_RESPONSE, output: OK_RESPONSE.output.slice(1) })])).invokeAssessment({ vectorStoreId: VS, input: '{}' });
  assert.equal(noSearch.fileSearchCalls, 0);
});

test('a pinned agent version is sent only when configured', async () => {
  const f = fakeFetch([json(200, OK_RESPONSE)]);
  await client(f, { ...CONFIG, agentVersion: '4' }).invokeAssessment({ vectorStoreId: VS, input: '{}' });
  assert.equal(f.calls[0].body.agent_reference.version, '4');
});

test('never calls Foundry without a valid vector store id', async () => {
  for (const bad of ['', ' ', 'vs_', 'abc', 'vs_x/../../files', null, undefined]) {
    const f = fakeFetch([]);
    await assert.rejects(client(f).invokeAssessment({ vectorStoreId: bad, input: '{}' }), (e) => e instanceof FoundryError && e.code === 'ai_bad_request');
    assert.equal(f.calls.length, 0);
  }
});

test('content filter (Prompt Shields) -> ai_content_filtered, categories only, never retried', async () => {
  const f = fakeFetch([
    json(400, {
      error: {
        code: 'content_filter', message: `blocked: ${SENTINEL}`,
        content_filters: [{ blocked: true, content_filter_results: { jailbreak: { detected: true, filtered: true }, hate: { filtered: false } } }],
      },
    }),
  ]);
  const err = await client(f).invokeAssessment({ vectorStoreId: VS, input: SENTINEL }).catch((e) => e);
  assert.equal(err.code, 'ai_content_filtered');
  assert.deepEqual(err.filterCategories, ['jailbreak']);
  assert.equal(f.calls.length, 1);
  assert.ok(!String(err.message).includes(SENTINEL) && !JSON.stringify(err).includes(SENTINEL));
});

test('429 is retried (honouring retry-after), then succeeds', async () => {
  const slept = [];
  const f = fakeFetch([json(429, { error: { code: 'rate_limit_exceeded' } }, { 'retry-after': '2' }), json(200, OK_RESPONSE)]);
  const c = createRestFoundryClient({ config: CONFIG, fetchImpl: f, getToken: async () => 't', sleep: async (ms) => slept.push(ms) });
  const r = await c.invokeAssessment({ vectorStoreId: VS, input: '{}' });
  assert.equal(r.fileSearchCalls, 1);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(slept, [2000]);
});

test('persistent 5xx -> ai_unavailable after 2 retries; network error -> ai_unavailable', async () => {
  const f = fakeFetch([json(503, {}), json(500, {}), json(502, {})]);
  await assert.rejects(client(f).invokeAssessment({ vectorStoreId: VS, input: '{}' }), (e) => e.code === 'ai_unavailable' && e.httpStatus === 502);
  assert.equal(f.calls.length, 3);
  const boom = () => { throw new TypeError('fetch failed'); };
  await assert.rejects(client(fakeFetch([boom, boom, boom])).invokeAssessment({ vectorStoreId: VS, input: '{}' }), (e) => e.code === 'ai_unavailable');
});

test('non-idempotent creates are not retried on 5xx (no duplicate uploads), only on 429', async () => {
  const f = fakeFetch([json(500, {})]);
  await assert.rejects(client(f).uploadFile({ bytes: new Uint8Array([1]), filename: 'a.pdf', mimeType: 'application/pdf' }), (e) => e.code === 'ai_unavailable');
  assert.equal(f.calls.length, 1);
  const g = fakeFetch([json(429, {}), json(200, { id: 'vs_abc123' })]);
  assert.deepEqual(await client(g).createVectorStore({ name: 'cr-1-v1', fileIds: ['assistant-x'] }), { vectorStoreId: 'vs_abc123' });
  assert.equal(g.calls.length, 2);
});

test('auth failures map to ai_auth_failed (401/403 and a failing token provider)', async () => {
  await assert.rejects(client(fakeFetch([json(401, {})])).invokeAssessment({ vectorStoreId: VS, input: '{}' }), (e) => e.code === 'ai_auth_failed');
  await assert.rejects(client(fakeFetch([json(403, { error: { message: SENTINEL } })])).invokeAssessment({ vectorStoreId: VS, input: '{}' }), (e) => e.code === 'ai_auth_failed' && !e.message.includes(SENTINEL));
  const c = createRestFoundryClient({ config: CONFIG, fetchImpl: fakeFetch([]), getToken: async () => { throw new Error(`AADSTS7000215 ${SENTINEL}`); }, sleep: async () => {} });
  await assert.rejects(c.invokeAssessment({ vectorStoreId: VS, input: '{}' }), (e) => e.code === 'ai_auth_failed' && !e.message.includes(SENTINEL));
});

test('deletes treat 404 as already gone; other errors surface', async () => {
  await client(fakeFetch([json(404, {})])).deleteVectorStore(VS);
  await client(fakeFetch([json(404, {})])).deleteFile('assistant-JWUUSVY51TenrU16y3HKX3');
  await assert.rejects(client(fakeFetch([json(400, {})])).deleteVectorStore(VS), (e) => e.code === 'ai_bad_request');
});

test('waitForVectorStore: completed -> ok; failed file -> not ok with Foundry error code', async () => {
  const done = fakeFetch([
    json(200, { status: 'in_progress', file_counts: { in_progress: 1, completed: 0, failed: 0 } }),
    json(200, { status: 'completed', usage_bytes: 1549, file_counts: { in_progress: 0, completed: 1, failed: 0 } }),
    json(200, { data: [{ status: 'completed', last_error: null }] }),
  ]);
  assert.deepEqual(await client(done).waitForVectorStore(VS, { intervalMs: 1 }), { ok: true, storeStatus: 'completed', fileStatus: 'completed', errorCode: null, usageBytes: 1549 });
  const failed = fakeFetch([
    json(200, { status: 'completed', file_counts: { in_progress: 0, completed: 0, failed: 1 } }),
    json(200, { data: [{ status: 'failed', last_error: { code: 'unsupported_file', message: 'x' } }] }),
  ]);
  const r = await client(failed).waitForVectorStore(VS);
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'unsupported_file');
});

test('classification table', () => {
  assert.equal(classifyFoundryResponse(404, null).code, 'ai_not_found');
  assert.equal(classifyFoundryResponse(408, null).code, 'ai_timeout');
  assert.equal(classifyFoundryResponse(400, { error: { code: 'invalid_payload', additionalInfo: { request_id: 'r1' } } }).requestId, 'r1');
});

test('getFoundryClient: refuses when not configured; the test seam overrides', () => {
  const saved = process.env.FOUNDRY_PROJECT_ENDPOINT;
  delete process.env.FOUNDRY_PROJECT_ENDPOINT;
  try {
    setFoundryClientForTests(null);
    assert.throws(() => getFoundryClient(), (e) => e instanceof FoundryError && e.code === 'ai_not_configured');
    const fake = { invokeAssessment: async () => ({}) };
    setFoundryClientForTests(fake);
    assert.equal(getFoundryClient(), fake);
  } finally {
    setFoundryClientForTests(null);
    if (saved !== undefined) process.env.FOUNDRY_PROJECT_ENDPOINT = saved;
  }
});
