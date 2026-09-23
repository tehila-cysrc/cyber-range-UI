import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeMttd, summarizeMttd, techniqueBudget, techniqueMatches } from '../dist/services/ttpMatching.js';
import { getTechnique, isValidTechniqueId, listCatalog, techniqueLabel } from '../dist/services/mitreCatalog.js';

test('exact technique id matches', () => {
  assert.equal(techniqueMatches('T1087', 'T1087'), true);
});

test('a sub-technique satisfies an expected parent', () => {
  assert.equal(techniqueMatches('T1087.001', 'T1087'), true);
});

test('a parent does not satisfy an expected sub-technique', () => {
  assert.equal(techniqueMatches('T1087', 'T1087.001'), false);
});

test('a sibling sub-technique does not match', () => {
  assert.equal(techniqueMatches('T1087.002', 'T1087.001'), false);
});

test('a technique whose id merely starts with the same digits does not match', () => {
  // T10870 is not a sub-technique of T1087 — the match must be on the "." boundary.
  assert.equal(techniqueMatches('T10870', 'T1087'), false);
});

const start = '2026-09-23T09:00:00.000Z';

test('MTTD is N/A with no occurrence recorded — never falls back to scenario start', () => {
  assert.deepEqual(computeMttd([], start, '2026-09-23T09:12:00.000Z'), {
    measurable: false,
    reason: 'no_occurrence_recorded',
  });
});

test('MTTD uses the earliest occurrence inside the team window', () => {
  const result = computeMttd(
    ['2026-09-23T09:30:00.000Z', '2026-09-23T09:05:00.000Z'],
    start,
    '2026-09-23T09:17:00.000Z',
  );
  assert.deepEqual(result, { measurable: true, occurredAt: '2026-09-23T09:05:00.000Z', mttdSeconds: 12 * 60 });
});

test('a first run the team missed legitimately inflates MTTD', () => {
  const result = computeMttd(
    ['2026-09-23T09:05:00.000Z', '2026-09-23T10:00:00.000Z'],
    start,
    '2026-09-23T10:02:00.000Z',
  );
  assert.equal(result.measurable, true);
  assert.equal(result.mttdSeconds, 57 * 60);
});

test('tagged before the only recorded occurrence -> N/A with its own reason', () => {
  assert.deepEqual(computeMttd(['2026-09-23T09:30:00.000Z'], start, '2026-09-23T09:10:00.000Z'), {
    measurable: false,
    reason: 'detected_before_recorded_occurrence',
  });
});

test('an occurrence before the team started is outside the window', () => {
  // Belongs to an earlier run of the range, not to what this team detected.
  assert.deepEqual(computeMttd(['2026-09-23T08:00:00.000Z'], start, '2026-09-23T09:10:00.000Z'), {
    measurable: false,
    reason: 'no_occurrence_recorded',
  });
});

test('detection at the exact occurrence instant measures 0', () => {
  const result = computeMttd([start], start, start);
  assert.deepEqual(result, { measurable: true, occurredAt: start, mttdSeconds: 0 });
});

test('MTTD summary averages only measurable detections and reports measured-of-detected', () => {
  const summary = summarizeMttd([
    { measurable: true, occurredAt: start, mttdSeconds: 600 },
    { measurable: true, occurredAt: start, mttdSeconds: 1200 },
    { measurable: false, reason: 'no_occurrence_recorded' },
  ]);
  assert.deepEqual(summary, { meanSeconds: 900, measuredCount: 2, detectedCount: 3 });
});

test('MTTD summary is null (N/A) when nothing is measurable', () => {
  assert.deepEqual(summarizeMttd([{ measurable: false, reason: 'no_occurrence_recorded' }]), {
    meanSeconds: null,
    measuredCount: 0,
    detectedCount: 1,
  });
});

test('technique budget has a floor of 10 and scales 3x with the expected count', () => {
  assert.equal(techniqueBudget(0), 10);
  assert.equal(techniqueBudget(3), 10);
  assert.equal(techniqueBudget(5), 15);
});

test('catalog: known techniques resolve, unknown ids are rejected', () => {
  assert.equal(isValidTechniqueId('T1087'), true);
  assert.equal(isValidTechniqueId('T1087.001'), true);
  assert.equal(isValidTechniqueId('T9999'), false);
  assert.equal(isValidTechniqueId(42), false);
  assert.equal(getTechnique('T1087.001')?.parentId, 'T1087');
  assert.ok(listCatalog().tactics.length > 0);
});

test('catalog: every technique belongs to at least one known tactic', () => {
  const { tactics, techniques } = listCatalog();
  const tacticIds = new Set(tactics.map((t) => t.id));
  for (const technique of techniques) {
    assert.ok(technique.tacticIds.length > 0, `${technique.id} has no tactic`);
    for (const id of technique.tacticIds) assert.ok(tacticIds.has(id), `${technique.id} -> unknown ${id}`);
  }
});

test('catalog: sub-technique labels carry the parent name', () => {
  assert.equal(techniqueLabel('T1087.001'), 'T1087.001 — Account Discovery: Local Account');
  assert.equal(techniqueLabel('T1087'), 'T1087 — Account Discovery');
});
