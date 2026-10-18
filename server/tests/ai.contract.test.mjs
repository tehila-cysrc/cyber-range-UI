import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// The app <-> agent response contract (plan §I.4) and the agent-level JSON Schema generated from it.
const { parseEnvelope, buildEnvelopeJsonSchema, buildAgentTextFormat, CONTRACT_VERSION } = await import('../dist/services/ai/assessmentContract.js');

const ev = (id, quote = null) => ({ type: 'timeline_entry', id, quote });
const LIVE = {
  status: 'partially_on_track',
  summary: 'Spotted the admin logon and PowerShell; initial access not yet linked.',
  correctlyIdentified: [{ concept: 'Privileged logon then PowerShell', judgement: 'correct', evidence: [ev(42, 'log into the server with an admin acount')], interpretation: 'Informal but accurate.' }],
  partiallyUnderstood: [{ concept: 'Lateral movement path', judgement: 'partial', evidence: [{ type: 'canvas_edge', id: 3, quote: null }], interpretation: 'Hosts not named.' }],
  missingOrUnclear: [{ topic: 'Initial access vector', expectedByNow: 'unknown', whyItMatters: 'Explains the credentials.', evidence: [] }],
  direction: { assessment: 'right_direction', explanation: 'Pivoting from the right host.' },
  instructorOnlyNotes: 'Step 1 not yet found.',
  studentSafeFeedback: { teamLevel: 'Good catch.', entryFeedback: [{ entryId: 42, verdict: 'on_track', text: 'Which account?' }], guidingQuestion: null },
  suggestedEntryScores: [{ entryId: 42, points: 10, rationale: 'Key observation.' }],
  confidence: { level: 'medium', reason: 'Few entries.' },
  warnings: [],
};
const FINAL = {
  investigationSummary: '…', overallAssessment: { level: 'good', text: '…' },
  stages: [{ stage: 'Privileged logon + PowerShell', judgement: 'correct', evidence: [ev(42)], interpretation: '…' }],
  incorrectConclusions: [], strengths: ['…'], areasForImprovement: ['…'],
  score: {
    criteria: [
      { key: 'identification', maxPoints: 40, awardedPoints: 28, rationale: '…' },
      { key: 'understanding', maxPoints: 30, awardedPoints: 22, rationale: '…' },
      { key: 'connections', maxPoints: 20, awardedPoints: 12, rationale: '…' },
      { key: 'clarity', maxPoints: 10, awardedPoints: 8, rationale: '…' },
    ],
    recommendedTotal: 70, maxTotal: 100, explanation: '…',
  },
  suggestedFinalFeedback: { instructorVersion: '…', studentSafeVersion: '…' },
  confidence: { level: 'high', reason: '…' }, warnings: [],
};
const env = (over) => JSON.stringify({ contractVersion: '2', mode: 'live', result: LIVE, ...over });

test('valid live and final envelopes parse for their own mode', () => {
  const live = parseEnvelope(env(), 'live');
  assert.equal(live.ok, true);
  assert.equal(live.result.status, 'partially_on_track');
  const final = parseEnvelope(env({ mode: 'final', result: FINAL }), 'final');
  assert.equal(final.ok, true);
  assert.equal(final.result.score.recommendedTotal, 70);
});

test('wrong mode, the other kind of result, extra keys, missing fields and non-JSON are invalid_response', () => {
  const bad = [
    [env(), 'final'],
    [env({ result: FINAL }), 'live'], // a final result under mode "live"
    [env({ mode: 'final', result: LIVE }), 'final'], // a live result under mode "final"
    [env({ result: null }), 'live'],
    [env({ live: LIVE, final: null, result: undefined }), 'live'], // the contract-1 shape
    [env({ extra: 1 }), 'live'],
    [env({ result: { ...LIVE, secretField: 'x' } }), 'live'],
    [env({ result: { ...LIVE, summary: undefined } }), 'live'],
    [env({ result: { ...LIVE, status: 'great' } }), 'live'],
    [env({ result: { ...LIVE, correctlyIdentified: [{ ...LIVE.correctlyIdentified[0], evidence: [{ type: 'timeline_entry', id: 4.5, quote: null }] }] } }), 'live'],
    ['not json at all', 'live'],
    ['```json\n{}\n```', 'live'],
  ];
  for (const [text, mode] of bad) {
    const r = parseEnvelope(text, mode);
    assert.equal(r.ok, false, text.slice(0, 80));
    assert.equal(r.errorCode, 'invalid_response');
  }
});

test('a different contractVersion is reported as contract_mismatch (agent edit broke compatibility)', () => {
  const r = parseEnvelope(JSON.stringify({ contractVersion: '1', mode: 'live', live: LIVE, final: null }), 'live'); // e.g. agent v5
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'contract_mismatch');
});

// Strict structured outputs: every object lists all properties as required and forbids extras; no
// keywords strict mode may reject. Walk the generated schema and check each node.
function walk(node, path, visit) {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`, visit));
  if (!node || typeof node !== 'object') return;
  visit(node, path);
  for (const [k, v] of Object.entries(node)) {
    if (k === 'properties') for (const [pk, pv] of Object.entries(v)) walk(pv, `${path}.${pk}`, visit);
    else walk(v, `${path}/${k}`, visit);
  }
}

test('the agent JSON Schema is strict-mode compatible', () => {
  const schema = buildEnvelopeJsonSchema();
  let objects = 0;
  walk(schema, '$', (node, path) => {
    for (const k of ['$schema', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum', 'minItems', 'maxItems', 'default']) {
      assert.ok(!(k in node), `${path} has ${k}`);
    }
    if (node.type === 'object') {
      objects++;
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
    }
  });
  assert.ok(objects >= 15, `expected many objects, saw ${objects}`);
  assert.deepEqual(schema.properties.contractVersion, { type: 'string', enum: [CONTRACT_VERSION] });
  // Contract 2: the result is the LAST property, so nothing follows the large object (finding F1).
  assert.deepEqual(schema.required, ['contractVersion', 'mode', 'result']);
  assert.deepEqual(Object.keys(schema.properties), ['contractVersion', 'mode', 'result']);
  assert.equal(schema.properties.result.anyOf.length, 2);
  // Field names that look like keywords survive (Evidence.id).
  const evidence = schema.properties.result.anyOf[0].properties.correctlyIdentified.items.properties.evidence.items;
  assert.deepEqual(evidence.properties.id, { type: 'integer' });
  assert.equal(buildAgentTextFormat().format.strict, true);
});

test('the committed docs/ai-agent schema files match the contract (run npm run export-ai-schema -w server)', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'ai-agent');
  const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf-8'));
  assert.deepEqual(read('assessment-envelope.schema.json'), buildEnvelopeJsonSchema());
  assert.deepEqual(read('agent-text-format.json'), buildAgentTextFormat());
});
