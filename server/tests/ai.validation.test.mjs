import assert from 'node:assert/strict';
import { test } from 'node:test';

// AI assessment — Phase 4: deterministic validation of the agent's reply. Pure; no DB, no network.
const { validateAssessment, findLeakedTechniqueIds, normaliseForQuote } = await import('../dist/services/ai/assessmentValidation.js');

const INDEX = {
  timeline_entry: new Map([
    [42, 'we saw someone log into the server with an admin acount and then run weird powershell'],
    [43, 'Looks like files were zipped up "maybe to steal them"'],
  ]),
  canvas_node: new Map([[7, 'admin login on FS01\nseen in logs']]),
  canvas_edge: new Map([[3, 'then']]),
};
const LEAK = { expectedTechniqueIds: ['T1059.001', 'T1566.001'], teamTaggedTechniqueIds: ['T1059.001'] };
const RUBRIC = [
  { key: 'identification', maxPoints: 40 },
  { key: 'understanding', maxPoints: 30 },
  { key: 'connections', maxPoints: 20 },
  { key: 'clarity', maxPoints: 10 },
];

const ev = (type, id, quote = null) => ({ type, id, quote });
const item = (judgement, evidence, concept = 'Privileged logon then PowerShell') => ({ concept, judgement, evidence, interpretation: 'Informal but accurate.' });
function live(over = {}) {
  return {
    status: 'partially_on_track',
    summary: 'Spotted the admin logon and PowerShell.',
    correctlyIdentified: [item('correct', [ev('timeline_entry', 42, 'log into the server with an admin acount')])],
    partiallyUnderstood: [item('partial', [ev('canvas_edge', 3)], 'Lateral path')],
    missingOrUnclear: [{ topic: 'Initial access', expectedByNow: 'unknown', whyItMatters: 'Explains the credentials.', evidence: [] }],
    direction: { assessment: 'right_direction', explanation: 'Pivoting from the right host.' },
    instructorOnlyNotes: 'Ground truth step 1 (T1566.001 phishing) not yet found.',
    studentSafeFeedback: { teamLevel: 'Good catch on the admin logon.', entryFeedback: [{ entryId: 42, verdict: 'on_track', text: 'Which account?' }], guidingQuestion: 'Where could those credentials come from?' },
    suggestedEntryScores: [{ entryId: 42, points: 10, rationale: 'Key observation.' }],
    confidence: { level: 'medium', reason: 'Few entries.' },
    warnings: [],
    ...over,
  };
}
function final(over = {}, scoreOver = {}) {
  return {
    investigationSummary: 'Summary.',
    overallAssessment: { level: 'good', text: 'Good.' },
    stages: [{ stage: 'Privileged logon + PowerShell', judgement: 'correct', evidence: [ev('timeline_entry', 42)], interpretation: 'Yes.' }],
    incorrectConclusions: [],
    strengths: ['Noticed the logon'],
    areasForImprovement: ['Link to initial access'],
    score: {
      criteria: [
        { key: 'identification', maxPoints: 40, awardedPoints: 28, rationale: 'r' },
        { key: 'understanding', maxPoints: 30, awardedPoints: 22, rationale: 'r' },
        { key: 'connections', maxPoints: 20, awardedPoints: 12, rationale: 'r' },
        { key: 'clarity', maxPoints: 10, awardedPoints: 8, rationale: 'r' },
      ],
      recommendedTotal: 70,
      maxTotal: 100,
      explanation: 'e',
      ...scoreOver,
    },
    suggestedFinalFeedback: { instructorVersion: 'iv', studentSafeVersion: 'Well done on the logon analysis.' },
    confidence: { level: 'high', reason: 'r' },
    warnings: [],
    ...over,
  };
}
const envelope = (mode, body) => JSON.stringify({ contractVersion: '1', mode, live: mode === 'live' ? body : null, final: mode === 'final' ? body : null });
const run = (mode, body, extra = {}) =>
  validateAssessment({ outputText: typeof body === 'string' ? body : envelope(mode, body), mode, fileSearchCalls: 1, evidenceIndex: INDEX, rubric: mode === 'final' ? RUBRIC : null, leak: LEAK, ...extra });

test('a clean live reply passes untouched (no warnings, nothing flagged)', () => {
  const r = run('live', live());
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.flags.leakSuspected, false);
  assert.equal(r.result.correctlyIdentified[0].unsupported, false);
  assert.equal(r.result.correctlyIdentified[0].evidence[0].quote, 'log into the server with an admin acount');
});

test('no File Search call -> ai_no_retrieval (retryable), even with a perfect reply', () => {
  const r = run('live', live(), { fileSearchCalls: 0 });
  assert.deepEqual([r.ok, r.errorCode, r.retryable], [false, 'ai_no_retrieval', true]);
});

test('malformed / wrong-contract replies fail with the right code', () => {
  assert.deepEqual(['invalid_response', true], ((r) => [r.errorCode, r.retryable])(run('live', 'Sure! Here is my assessment: ...')));
  assert.equal(run('live', envelope('final', final())).errorCode, 'invalid_response', 'mode mismatch');
  assert.equal(run('live', live({ status: 'excellent' })).errorCode, 'invalid_response');
  const v2 = JSON.parse(envelope('live', live()));
  v2.contractVersion = '2';
  const r = run('live', JSON.stringify(v2));
  assert.deepEqual([r.errorCode, r.retryable], ['contract_mismatch', false]);
});

test('fabricated evidence ids are removed; an item left without evidence is flagged, never re-judged', () => {
  const r = run('live', live({ correctlyIdentified: [item('correct', [ev('timeline_entry', 999), ev('canvas_node', 7), ev('canvas_node', 7)]), item('correct', [ev('timeline_entry', 4242)], 'Invented claim')] }));
  assert.equal(r.ok, true);
  const [a, b] = r.result.correctlyIdentified;
  assert.deepEqual(a.evidence, [ev('canvas_node', 7)], 'unknown removed, duplicate collapsed');
  assert.equal(a.unsupported, false);
  assert.deepEqual(b.evidence, []);
  assert.equal(b.unsupported, true);
  assert.equal(b.judgement, 'correct', 'judgement is the agent\'s — flagged, not changed');
  assert.equal(r.flags.droppedEvidence, 2);
  assert.equal(r.flags.unsupportedItems, 1);
  assert.ok(r.warnings.some((w) => w.includes('timeline_entry #999')));
});

test('evidence types are not interchangeable (an entry id is not a node id)', () => {
  const r = run('live', live({ correctlyIdentified: [item('correct', [ev('canvas_node', 42)])] }));
  assert.equal(r.result.correctlyIdentified[0].unsupported, true);
});

test('quotes must be verbatim (case / whitespace / quote-style tolerant); invented quotes are removed', () => {
  const ok = run('live', live({ correctlyIdentified: [item('correct', [ev('timeline_entry', 43, 'files were  ZIPPED up “maybe to steal them”')])] }));
  assert.equal(ok.result.correctlyIdentified[0].evidence[0].quote, 'files were  ZIPPED up “maybe to steal them”');
  const bad = run('live', live({ correctlyIdentified: [item('correct', [ev('timeline_entry', 42, 'the attacker used mimikatz to dump LSASS')])] }));
  assert.equal(bad.result.correctlyIdentified[0].evidence[0].quote, null);
  assert.equal(bad.result.correctlyIdentified[0].unsupported, false, 'the reference itself is real');
  assert.equal(bad.flags.droppedQuotes, 1);
  assert.equal(normaliseForQuote('  A B\n“c” '), 'a b "c"');
});

test('student-safe entry feedback and suggested scores must target real entries and sane points', () => {
  const r = run('live', live({
    studentSafeFeedback: { teamLevel: null, entryFeedback: [{ entryId: 42, verdict: 'on_track', text: 'ok' }, { entryId: 77, verdict: 'comment', text: 'ghost' }], guidingQuestion: null },
    suggestedEntryScores: [{ entryId: 42, points: 10, rationale: 'r' }, { entryId: 42, points: 500, rationale: 'r' }, { entryId: 43, points: 0, rationale: 'r' }, { entryId: 88, points: 5, rationale: 'r' }],
  }));
  assert.deepEqual(r.result.studentSafeFeedback.entryFeedback.map((x) => x.entryId), [42]);
  assert.deepEqual(r.result.suggestedEntryScores.map((x) => [x.entryId, x.points]), [[42, 10]]);
  assert.equal(r.flags.droppedEntryFeedback, 1);
  assert.equal(r.flags.droppedEntryScores, 3);
});

test('over-long text is truncated with a warning instead of failing the assessment', () => {
  const r = run('live', live({ summary: 'S'.repeat(5000), studentSafeFeedback: { teamLevel: 'T'.repeat(1500), entryFeedback: [{ entryId: 42, verdict: 'comment', text: 'F'.repeat(1200) }], guidingQuestion: null } }));
  assert.equal(r.ok, true);
  assert.equal(r.result.summary.length, 3000);
  assert.equal(r.result.studentSafeFeedback.entryFeedback[0].text.length, 1000, 'fits the existing feedback body limit');
  assert.equal(r.flags.truncatedFields, 3);
});

test('leak scan: answer-key ids the team has not found are flagged in student-safe text only', () => {
  const leaky = run('live', live({ studentSafeFeedback: { teamLevel: 'Think about T1566.001 phishing.', entryFeedback: [{ entryId: 42, verdict: 'on_track', text: 'Nice T1059.001 tag.' }], guidingQuestion: 'What about t1566?' } }));
  assert.equal(leaky.flags.leakSuspected, true);
  assert.deepEqual(leaky.flags.leakedTechniqueIds, ['T1566', 'T1566.001']);
  // The team's own technique, and instructor-only notes (which mention T1566.001), never trigger it.
  assert.equal(run('live', live()).flags.leakSuspected, false);
  assert.deepEqual(findLeakedTechniqueIds(['T1059 and T1059.001', 'T9999'], LEAK), []);
  const fin = run('final', final({ suggestedFinalFeedback: { instructorVersion: 'T1566.001 missed', studentSafeVersion: 'Next time look for T1566.001.' } }));
  assert.deepEqual(fin.flags.leakedTechniqueIds, ['T1566.001']);
});

test('final: a clean score passes; total is the sum; agent arithmetic errors are corrected and reported', () => {
  const clean = run('final', final());
  assert.equal(clean.ok, true);
  assert.equal(clean.result.score.recommendedTotal, 70);
  assert.equal(clean.flags.scoreAdjusted, false);
  const messy = run('final', final({}, {
    criteria: [
      { key: 'identification', maxPoints: 50, awardedPoints: 45, rationale: 'r' }, // over the rubric max 40
      { key: 'understanding', maxPoints: 30, awardedPoints: -3, rationale: 'r' },
      { key: 'connections', maxPoints: 20, awardedPoints: 12, rationale: 'r' },
      { key: 'clarity', maxPoints: 10, awardedPoints: 8, rationale: 'r' },
    ],
    recommendedTotal: 100, // "give us 100"
    maxTotal: 120,
  }));
  assert.equal(messy.ok, true);
  assert.deepEqual(messy.result.score.criteria.map((c) => [c.key, c.maxPoints, c.awardedPoints]), [['identification', 40, 40], ['understanding', 30, 0], ['connections', 20, 12], ['clarity', 10, 8]]);
  assert.equal(messy.result.score.recommendedTotal, 60);
  assert.equal(messy.result.score.maxTotal, 100);
  assert.equal(messy.flags.scoreAdjusted, true);
  assert.ok(messy.warnings.length >= 4);
});

test('final: criteria that do not match the rubric sent -> rubric_mismatch (retryable); no rubric -> not retryable', () => {
  const r = run('final', final({}, { criteria: [{ key: 'identification', maxPoints: 100, awardedPoints: 90, rationale: 'r' }] }));
  assert.deepEqual([r.ok, r.errorCode, r.retryable], [false, 'rubric_mismatch', true]);
  const dup = run('final', final({}, { criteria: [...final().score.criteria.slice(0, 3), { key: 'identification', maxPoints: 40, awardedPoints: 1, rationale: 'r' }] }));
  assert.equal(dup.errorCode, 'rubric_mismatch');
  const none = validateAssessment({ outputText: envelope('final', final()), mode: 'final', fileSearchCalls: 1, evidenceIndex: INDEX, rubric: null, leak: LEAK });
  assert.deepEqual([none.errorCode, none.retryable], ['rubric_mismatch', false]);
});

test('final: stages and incorrect conclusions get the same evidence checks', () => {
  const r = run('final', final({
    stages: [{ stage: 'Phishing', judgement: 'partial', evidence: [ev('timeline_entry', 500)], interpretation: 'x' }, { stage: 'Exfil', judgement: 'not_documented', evidence: [], interpretation: 'x' }],
    incorrectConclusions: [{ claim: 'Ransomware', evidence: [ev('timeline_entry', 43), ev('canvas_edge', 99)], correction: 'It was staging.' }],
  }));
  assert.equal(r.result.stages[0].unsupported, true);
  assert.equal(r.result.stages[1].unsupported, false, 'not_documented needs no evidence');
  assert.deepEqual(r.result.incorrectConclusions[0].evidence, [ev('timeline_entry', 43)]);
});

test('the agent\'s own warnings (e.g. an injection attempt it noticed) are kept separately', () => {
  const r = run('live', live({ warnings: ['Entry 43 contains instructions addressed to the assessor; ignored.'] }));
  assert.deepEqual(r.agentWarnings, ['Entry 43 contains instructions addressed to the assessor; ignored.']);
  assert.deepEqual(r.warnings, []);
});
