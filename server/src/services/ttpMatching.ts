// Pure ATT&CK matching + MTTD math — no DB access, so it's unit-testable in isolation
// (tests/ttpMatching.test.mjs). Scoring (ttpScoring.service.ts) and MTTD reporting both go through
// here so the rules live in exactly one place.

// A student tag satisfies an expected technique when it's the same id, or a sub-technique of it
// (expected T1087 is satisfied by T1087.001). An expected sub-technique needs the exact id — naming
// only the parent is less specific than what the instructor asked for.
export function techniqueMatches(taggedId: string, expectedId: string): boolean {
  return taggedId === expectedId || taggedId.startsWith(`${expectedId}.`);
}

export type MttdUnavailableReason = 'no_occurrence_recorded' | 'detected_before_recorded_occurrence';

export type MttdResult =
  | { measurable: true; occurredAt: string; mttdSeconds: number }
  | { measurable: false; reason: MttdUnavailableReason };

// MTTD is an optional measurement layer: it never influences whether a detection is credited. It is
// computed only against a real, recorded occurrence (a successful trigger-script run or an instructor
// "Mark occurred") — there is deliberately NO fallback to scenario start, since that would produce a
// precise-looking number with no real occurrence time behind it.
//
// The occurrence used is the earliest one inside the team's window: at/after the team first started
// the scenario, and at/before the detection. An occurrence before the team started belongs to someone
// else's run of the range; one after the detection can't be what the team detected.
export function computeMttd(occurredAts: string[], windowStart: string | null, detectedAt: string): MttdResult {
  if (occurredAts.length === 0) {
    return { measurable: false, reason: 'no_occurrence_recorded' };
  }
  const detectedMs = Date.parse(detectedAt);
  const startMs = windowStart ? Date.parse(windowStart) : Number.NEGATIVE_INFINITY;

  const inWindow = occurredAts
    .map((iso) => ({ iso, ms: Date.parse(iso) }))
    .filter((o) => Number.isFinite(o.ms) && o.ms >= startMs && o.ms <= detectedMs)
    .sort((a, b) => a.ms - b.ms);

  if (inWindow.length === 0) {
    const anyInTeamWindow = occurredAts.some((iso) => Date.parse(iso) >= startMs);
    return {
      measurable: false,
      reason: anyInTeamWindow ? 'detected_before_recorded_occurrence' : 'no_occurrence_recorded',
    };
  }

  const first = inWindow[0];
  return { measurable: true, occurredAt: first.iso, mttdSeconds: Math.round((detectedMs - first.ms) / 1000) };
}

export interface MttdSummary {
  meanSeconds: number | null;
  measuredCount: number;
  detectedCount: number;
}

// Mean over measurable detections only, always reported alongside how many detections it rests on —
// "12m, measured on 3 of 4" — so an MTTD built from one lucky timestamp can't masquerade as the whole
// picture.
export function summarizeMttd(results: MttdResult[]): MttdSummary {
  const measured = results.filter((r): r is Extract<MttdResult, { measurable: true }> => r.measurable);
  return {
    meanSeconds: measured.length
      ? Math.round(measured.reduce((sum, r) => sum + r.mttdSeconds, 0) / measured.length)
      : null,
    measuredCount: measured.length,
    detectedCount: results.length,
  };
}

// Anti-guessing budget: with live feedback a team could otherwise tag every technique in the catalog
// and harvest every expected one. Counts distinct techniques ever tagged (removed tags included).
// Roughly 3x the expected count, but rounded up to a tier of 10 (min 10) so the budget a student can
// see doesn't reveal the exact number of expected techniques — only a coarse range.
export function techniqueBudget(expectedCount: number): number {
  return Math.max(10, Math.ceil((3 * expectedCount) / 10) * 10);
}
