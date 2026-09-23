import { db } from '../db/index.js';
import { getActiveEventRunId } from '../db/seed.js';
import { getTactic, getTechnique, techniqueLabel } from './mitreCatalog.js';
import { computeMttd, summarizeMttd, techniqueBudget, techniqueMatches, type MttdResult, type MttdSummary } from './ttpMatching.js';

// ATT&CK TTP scoring. Correctness is decided ONLY here, server-side, from stored tags vs the scenario's
// expected techniques — the client sends technique ids and nothing else. Two layers, kept separate:
//  1. scoring: reconcileTeamTtps() credits each expected technique at most once per team, into the
//     existing `scores` table (source='ttp'), so every existing total/leaderboard includes it;
//  2. MTTD: read-only, derived in the reports below from ttp_occurrences — never consulted by scoring.
// Pure DB functions (no sockets) so tests can drive them directly; routes call the *AndAnnounce
// wrappers in ttpAnnounce.ts.

export const MAX_TTPS_PER_ENTRY = 3;

export interface ExpectedTtp {
  id: number;
  cyberRangeId: number;
  techniqueId: string;
  tacticId: string;
  points: number;
  description: string | null;
  topologyNodeId: number | null;
  triggerScriptId: number | null;
  sortOrder: number;
}

const EXPECTED_COLUMNS = `id, cyber_range_id AS cyberRangeId, technique_id AS techniqueId, tactic_id AS tacticId,
  points, description, topology_node_id AS topologyNodeId, trigger_script_id AS triggerScriptId,
  sort_order AS sortOrder`;

export function activeExpectedTtps(cyberRangeId: number): ExpectedTtp[] {
  return db
    .prepare(
      `SELECT ${EXPECTED_COLUMNS} FROM cyber_range_expected_ttps
       WHERE cyber_range_id = ? AND is_active = 1 ORDER BY sort_order, id`,
    )
    .all(cyberRangeId) as unknown as ExpectedTtp[];
}

export function getExpectedTtp(id: number): (ExpectedTtp & { isActive: number }) | undefined {
  return db
    .prepare(`SELECT ${EXPECTED_COLUMNS}, is_active AS isActive FROM cyber_range_expected_ttps WHERE id = ?`)
    .get(id) as unknown as (ExpectedTtp & { isActive: number }) | undefined;
}

interface TagRow {
  id: number;
  documentationEntryId: number;
  techniqueId: string;
  taggedByUserId: number;
  taggedAt: string;
  removedAt: string | null;
}

function allTags(teamId: number, cyberRangeId: number): TagRow[] {
  return db
    .prepare(
      `SELECT id, documentation_entry_id AS documentationEntryId, technique_id AS techniqueId,
              tagged_by_user_id AS taggedByUserId, tagged_at AS taggedAt, removed_at AS removedAt
       FROM documentation_entry_ttps WHERE team_id = ? AND cyber_range_id = ?
       ORDER BY tagged_at ASC, id ASC`,
    )
    .all(teamId, cyberRangeId) as unknown as TagRow[];
}

export interface Credit {
  detectionId: number;
  scoreId: number;
  teamId: number;
  cyberRangeId: number;
  creditedUserId: number | null;
  points: number;
}

function inTransaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Idempotent: credits every active expected technique that has no credit yet for this team and has a
// matching active tag, using the EARLIEST such tag (its tagged_at becomes detected_at). Safe to call
// after any tag write, expected-TTP change or void — repeated calls never double-award (the partial
// unique index idx_ttp_detections_one_credit is the backstop). An instructor void blocks auto re-credit
// of that technique for that team; only a manual credit can restore it (otherwise re-tagging the same
// guess would immediately undo the void).
export function reconcileTeamTtps(teamId: number, cyberRangeId: number): Credit[] {
  const expected = activeExpectedTtps(cyberRangeId);
  if (expected.length === 0) return [];

  return inTransaction(() => {
    const blocked = new Set(
      (
        db
          .prepare(
            `SELECT DISTINCT expected_ttp_id AS id FROM ttp_detections
             WHERE team_id = ? AND cyber_range_id = ?`,
          )
          .all(teamId, cyberRangeId) as { id: number }[]
      ).map((r) => r.id),
    );
    const activeTags = allTags(teamId, cyberRangeId).filter((t) => t.removedAt === null);
    const credits: Credit[] = [];
    const now = new Date().toISOString();

    for (const exp of expected) {
      if (blocked.has(exp.id)) continue; // already credited, or voided by the instructor
      const tag = activeTags.find((t) => techniqueMatches(t.techniqueId, exp.techniqueId));
      if (!tag) continue;

      const score = db
        .prepare(
          `INSERT INTO scores
             (team_id, student_user_id, documentation_entry_id, cyber_range_id, points, is_gamified,
              awarded_by_user_id, note, created_at, source)
           VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, 'ttp')`,
        )
        .run(
          teamId,
          tag.taggedByUserId,
          tag.documentationEntryId,
          cyberRangeId,
          exp.points,
          `ATT&CK detection: ${techniqueLabel(tag.techniqueId)}`,
          now,
        );
      const scoreId = Number(score.lastInsertRowid);

      const detection = db
        .prepare(
          `INSERT INTO ttp_detections
             (team_id, cyber_range_id, expected_ttp_id, documentation_entry_ttp_id, documentation_entry_id,
              credited_user_id, detected_at, points_awarded, source, status, score_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto', 'credited', ?, ?)`,
        )
        .run(teamId, cyberRangeId, exp.id, tag.id, tag.documentationEntryId, tag.taggedByUserId, tag.taggedAt, exp.points, scoreId, now);

      credits.push({
        detectionId: Number(detection.lastInsertRowid),
        scoreId,
        teamId,
        cyberRangeId,
        creditedUserId: tag.taggedByUserId,
        points: exp.points,
      });
    }
    return credits;
  });
}

// Every team that has ever been assigned this scenario — used when the scenario's expectations change
// mid-run, so tags made before an expectation existed are credited deterministically.
export function teamIdsOnRange(cyberRangeId: number): number[] {
  return (
    db.prepare('SELECT team_id AS teamId FROM team_cyber_range_progress WHERE cyber_range_id = ?').all(cyberRangeId) as {
      teamId: number;
    }[]
  ).map((r) => r.teamId);
}

// ---------------------------------------------------------------------------------------------------
// Student tagging

export type SetTagsResult =
  | { ok: true; changed: boolean }
  | { ok: false; status: number; error: string };

export function budgetFor(teamId: number, cyberRangeId: number): { limit: number; used: number } | null {
  const expectedCount = activeExpectedTtps(cyberRangeId).length;
  if (expectedCount === 0) return null; // nothing to score -> nothing to guess at
  const used = db
    .prepare(
      `SELECT COUNT(DISTINCT technique_id) AS n FROM documentation_entry_ttps WHERE team_id = ? AND cyber_range_id = ?`,
    )
    .get(teamId, cyberRangeId) as { n: number };
  return { limit: techniqueBudget(expectedCount), used: used.n };
}

// null = fine; otherwise the user-facing refusal. Only brand-new distinct techniques count against the
// budget — re-tagging something the team already tried (anywhere, even since removed) is free.
export function checkBudget(teamId: number, cyberRangeId: number, techniqueIdsToAdd: string[]): string | null {
  const budget = budgetFor(teamId, cyberRangeId);
  if (!budget || techniqueIdsToAdd.length === 0) return null;
  const everTagged = new Set(
    (
      db
        .prepare(`SELECT DISTINCT technique_id AS id FROM documentation_entry_ttps WHERE team_id = ? AND cyber_range_id = ?`)
        .all(teamId, cyberRangeId) as { id: string }[]
    ).map((r) => r.id),
  );
  const newDistinct = new Set(techniqueIdsToAdd.filter((id) => !everTagged.has(id))).size;
  if (budget.used + newDistinct <= budget.limit) return null;
  return `technique budget reached — your team can try at most ${budget.limit} different ATT&CK techniques in this scenario (${budget.limit - budget.used} left)`;
}

// Set semantics (the full desired list, not add/remove deltas) so a replayed request is a no-op.
// Removed tags are soft-removed to keep history. Caller validates ids against the catalog, entry
// ownership and the active-range gate; this enforces the per-entry cap and the team budget.
export function setEntryTtps(
  entryId: number,
  teamId: number,
  cyberRangeId: number,
  userId: number,
  techniqueIds: string[],
): SetTagsResult {
  const desired = [...new Set(techniqueIds)];
  if (desired.length > MAX_TTPS_PER_ENTRY) {
    return { ok: false, status: 400, error: `at most ${MAX_TTPS_PER_ENTRY} ATT&CK techniques per entry` };
  }

  return inTransaction((): SetTagsResult => {
    const current = db
      .prepare(
        `SELECT id, technique_id AS techniqueId FROM documentation_entry_ttps
         WHERE documentation_entry_id = ? AND removed_at IS NULL`,
      )
      .all(entryId) as { id: number; techniqueId: string }[];
    const currentIds = new Set(current.map((c) => c.techniqueId));
    const toAdd = desired.filter((id) => !currentIds.has(id));
    const toRemove = current.filter((c) => !desired.includes(c.techniqueId));
    if (toAdd.length === 0 && toRemove.length === 0) return { ok: true, changed: false };

    const budgetError = checkBudget(teamId, cyberRangeId, toAdd);
    if (budgetError) return { ok: false, status: 409, error: budgetError };

    const now = new Date().toISOString();
    for (const tag of toRemove) {
      db.prepare('UPDATE documentation_entry_ttps SET removed_at = ?, removed_by_user_id = ? WHERE id = ?').run(now, userId, tag.id);
    }
    for (const techniqueId of toAdd) {
      db.prepare(
        `INSERT INTO documentation_entry_ttps
           (documentation_entry_id, team_id, cyber_range_id, technique_id, tagged_by_user_id, tagged_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(entryId, teamId, cyberRangeId, techniqueId, userId, now);
    }
    return { ok: true, changed: true };
  });
}

export interface EntryTagDTO {
  techniqueId: string;
  techniqueName: string;
  credited: boolean;
}

// Active tags per entry for one team's timeline. `credited` = the tag's technique satisfies an
// expected technique this team has been credited for — only information the team already has (it got
// the points live). Never says "wrong": an uncredited tag may simply be a technique the scenario
// doesn't score.
export function tagsByEntry(teamId: number, cyberRangeId: number): Map<number, EntryTagDTO[]> {
  const creditedTechniques = (
    db
      .prepare(
        `SELECT e.technique_id AS techniqueId FROM ttp_detections d
         JOIN cyber_range_expected_ttps e ON e.id = d.expected_ttp_id
         WHERE d.team_id = ? AND d.cyber_range_id = ? AND d.status = 'credited'`,
      )
      .all(teamId, cyberRangeId) as { techniqueId: string }[]
  ).map((r) => r.techniqueId);

  const byEntry = new Map<number, EntryTagDTO[]>();
  for (const tag of allTags(teamId, cyberRangeId)) {
    if (tag.removedAt !== null) continue;
    const list = byEntry.get(tag.documentationEntryId) ?? [];
    list.push({
      techniqueId: tag.techniqueId,
      techniqueName: getTechnique(tag.techniqueId)?.name ?? 'Unknown technique',
      credited: creditedTechniques.some((expectedId) => techniqueMatches(tag.techniqueId, expectedId)),
    });
    byEntry.set(tag.documentationEntryId, list);
  }
  return byEntry;
}

// ---------------------------------------------------------------------------------------------------
// Occurrences (MTTD only — nothing here touches a credit)

// Called when a Run Script execution succeeds: every active expectation in the node's scenario whose
// trigger is this library script "happened" at the execution's start (server dispatch time — slightly
// before the VM actually runs it, so MTTD errs long, never short). Returns the scenario and the
// expected-TTP ids that got an occurrence (none if the script triggers nothing).
export function recordScriptOccurrences(executionId: number): { cyberRangeId: number; expectedTtpIds: number[] } | null {
  const execution = db
    .prepare(
      `SELECT se.id, se.script_id AS scriptId, se.started_at AS startedAt, tn.cyber_range_id AS cyberRangeId
       FROM script_executions se JOIN topology_nodes tn ON tn.id = se.topology_node_id
       WHERE se.id = ? AND se.status = 'succeeded'`,
    )
    .get(executionId) as { id: number; scriptId: number | null; startedAt: string; cyberRangeId: number } | undefined;
  const eventRunId = getActiveEventRunId();
  if (!execution || execution.scriptId == null || eventRunId == null) return null;

  const triggered = db
    .prepare(
      `SELECT id FROM cyber_range_expected_ttps WHERE cyber_range_id = ? AND trigger_script_id = ? AND is_active = 1`,
    )
    .all(execution.cyberRangeId, execution.scriptId) as { id: number }[];
  const now = new Date().toISOString();
  for (const exp of triggered) {
    db.prepare(
      `INSERT INTO ttp_occurrences (event_run_id, cyber_range_id, expected_ttp_id, occurred_at, source, script_execution_id, created_at)
       VALUES (?, ?, ?, ?, 'script_execution', ?, ?)`,
    ).run(eventRunId, execution.cyberRangeId, exp.id, execution.startedAt, execution.id, now);
  }
  return { cyberRangeId: execution.cyberRangeId, expectedTtpIds: triggered.map((t) => t.id) };
}

export interface OccurrenceDTO {
  id: number;
  expectedTtpId: number;
  occurredAt: string;
  source: 'script_execution' | 'manual';
  scriptExecutionId: number | null;
  scriptName: string | null;
  nodeLabel: string | null;
  recordedByName: string | null;
}

export function occurrencesForRange(cyberRangeId: number): OccurrenceDTO[] {
  return db
    .prepare(
      `SELECT o.id, o.expected_ttp_id AS expectedTtpId, o.occurred_at AS occurredAt, o.source,
              o.script_execution_id AS scriptExecutionId, s.name AS scriptName, tn.label AS nodeLabel,
              u.display_name AS recordedByName
       FROM ttp_occurrences o
       LEFT JOIN script_executions se ON se.id = o.script_execution_id
       LEFT JOIN scripts s ON s.id = se.script_id
       LEFT JOIN topology_nodes tn ON tn.id = se.topology_node_id
       LEFT JOIN users u ON u.id = o.recorded_by_user_id
       WHERE o.cyber_range_id = ?
       ORDER BY o.occurred_at ASC, o.id ASC`,
    )
    .all(cyberRangeId) as unknown as OccurrenceDTO[];
}

// ---------------------------------------------------------------------------------------------------
// Instructor overrides

export type OverrideResult = { ok: true; teamId: number; cyberRangeId: number } | { ok: false; status: number; error: string };

export function voidDetection(detectionId: number, instructorUserId: number, reason: string | null): OverrideResult {
  const detection = db
    .prepare(
      `SELECT id, team_id AS teamId, cyber_range_id AS cyberRangeId, status, score_id AS scoreId FROM ttp_detections WHERE id = ?`,
    )
    .get(detectionId) as { id: number; teamId: number; cyberRangeId: number; status: string; scoreId: number | null } | undefined;
  if (!detection) return { ok: false, status: 404, error: 'detection not found' };
  if (detection.status !== 'credited') return { ok: false, status: 409, error: 'this detection is already voided' };

  inTransaction(() => {
    db.prepare(
      `UPDATE ttp_detections SET status = 'voided', voided_at = ?, voided_by_user_id = ?, void_reason = ?, score_id = NULL WHERE id = ?`,
    ).run(new Date().toISOString(), instructorUserId, reason, detectionId);
    if (detection.scoreId != null) db.prepare('DELETE FROM scores WHERE id = ?').run(detection.scoreId);
  });
  return { ok: true, teamId: detection.teamId, cyberRangeId: detection.cyberRangeId };
}

// The instructor judges that an entry identified an expected technique even though the team didn't
// tag it (or tagged it wrong / was voided). detected_at = the entry's own created_at — the moment the
// evidence was written — and the credit is flagged source='instructor' in every report.
export function manualCredit(
  teamId: number,
  expectedTtpId: number,
  documentationEntryId: number,
  instructorUserId: number,
  note: string | null,
): OverrideResult & { detectionId?: number; scoreId?: number; creditedUserId?: number; points?: number } {
  const expected = getExpectedTtp(expectedTtpId);
  if (!expected || !expected.isActive) return { ok: false, status: 404, error: 'expected technique not found' };
  const entry = db
    .prepare(
      `SELECT id, author_user_id AS authorUserId, created_at AS createdAt FROM documentation_entries
       WHERE id = ? AND team_id = ? AND cyber_range_id = ?`,
    )
    .get(documentationEntryId, teamId, expected.cyberRangeId) as { id: number; authorUserId: number; createdAt: string } | undefined;
  if (!entry) return { ok: false, status: 400, error: "that entry isn't this team's, in this scenario" };
  const existing = db
    .prepare(`SELECT 1 FROM ttp_detections WHERE team_id = ? AND expected_ttp_id = ? AND status = 'credited'`)
    .get(teamId, expectedTtpId);
  if (existing) return { ok: false, status: 409, error: 'this technique is already credited for this team' };

  return inTransaction(() => {
    const now = new Date().toISOString();
    const score = db
      .prepare(
        `INSERT INTO scores
           (team_id, student_user_id, documentation_entry_id, cyber_range_id, points, is_gamified,
            awarded_by_user_id, note, created_at, source)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'ttp')`,
      )
      .run(
        teamId,
        entry.authorUserId,
        entry.id,
        expected.cyberRangeId,
        expected.points,
        instructorUserId,
        `ATT&CK detection (instructor credit): ${techniqueLabel(expected.techniqueId)}${note ? ` — ${note}` : ''}`,
        now,
      );
    const scoreId = Number(score.lastInsertRowid);
    const detection = db
      .prepare(
        `INSERT INTO ttp_detections
           (team_id, cyber_range_id, expected_ttp_id, documentation_entry_id, credited_user_id, detected_at,
            points_awarded, source, status, score_id, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'instructor', 'credited', ?, ?, ?)`,
      )
      .run(teamId, expected.cyberRangeId, expectedTtpId, entry.id, entry.authorUserId, entry.createdAt, expected.points, scoreId, instructorUserId, now);
    return {
      ok: true as const,
      teamId,
      cyberRangeId: expected.cyberRangeId,
      detectionId: Number(detection.lastInsertRowid),
      scoreId,
      creditedUserId: entry.authorUserId,
      points: expected.points,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Reports

export interface DetectionDTO {
  id: number;
  detectedAt: string;
  pointsAwarded: number;
  source: 'auto' | 'instructor';
  creditedUserName: string | null;
  taggedTechniqueId: string | null;
  documentationEntryId: number | null;
  entryExcerpt: string | null;
  mttd: MttdResult;
}

export interface ExpectedResultDTO {
  expectedTtpId: number;
  techniqueId: string;
  techniqueName: string;
  tacticId: string;
  tacticName: string;
  points: number;
  description?: string | null;
  status: 'detected' | 'missed';
  voided: boolean;
  detection: DetectionDTO | null;
}

export interface IncorrectDTO {
  techniqueId: string;
  techniqueName: string;
  firstTaggedAt: string;
  stillTagged: boolean;
}

export interface TeamTtpReport {
  teamId: number;
  teamName: string;
  cyberRangeId: number;
  expected: ExpectedResultDTO[];
  incorrect: IncorrectDTO[];
  totals: {
    earnedPoints: number;
    availablePoints: number;
    expectedCount: number;
    detectedCount: number;
    incorrectCount: number;
    distinctTaggedCount: number;
    precision: number | null;
  };
  mttd: MttdSummary;
}

function excerpt(body: string | null): string | null {
  if (body == null) return null;
  return body.length > 140 ? `${body.slice(0, 137)}…` : body;
}

export function buildTeamTtpReport(teamId: number, cyberRangeId: number, opts: { includeInstructorNotes: boolean }): TeamTtpReport | null {
  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId) as { id: number; name: string } | undefined;
  if (!team) return null;
  const progress = db
    .prepare('SELECT first_started_at AS firstStartedAt FROM team_cyber_range_progress WHERE team_id = ? AND cyber_range_id = ?')
    .get(teamId, cyberRangeId) as { firstStartedAt: string | null } | undefined;

  const expected = activeExpectedTtps(cyberRangeId);
  const detections = db
    .prepare(
      `SELECT d.id, d.expected_ttp_id AS expectedTtpId, d.detected_at AS detectedAt, d.points_awarded AS pointsAwarded,
              d.source, d.status, d.documentation_entry_id AS documentationEntryId, u.display_name AS creditedUserName,
              t.technique_id AS taggedTechniqueId, de.body AS entryBody
       FROM ttp_detections d
       LEFT JOIN users u ON u.id = d.credited_user_id
       LEFT JOIN documentation_entry_ttps t ON t.id = d.documentation_entry_ttp_id
       LEFT JOIN documentation_entries de ON de.id = d.documentation_entry_id
       WHERE d.team_id = ? AND d.cyber_range_id = ?
       ORDER BY d.id ASC`,
    )
    .all(teamId, cyberRangeId) as {
    id: number;
    expectedTtpId: number;
    detectedAt: string;
    pointsAwarded: number;
    source: 'auto' | 'instructor';
    status: 'credited' | 'voided';
    documentationEntryId: number | null;
    creditedUserName: string | null;
    taggedTechniqueId: string | null;
    entryBody: string | null;
  }[];

  const occurrencesByExpected = new Map<number, string[]>();
  for (const o of occurrencesForRange(cyberRangeId)) {
    const list = occurrencesByExpected.get(o.expectedTtpId) ?? [];
    list.push(o.occurredAt);
    occurrencesByExpected.set(o.expectedTtpId, list);
  }

  const mttdResults: MttdResult[] = [];
  const expectedResults: ExpectedResultDTO[] = expected.map((exp) => {
    const credited = detections.find((d) => d.expectedTtpId === exp.id && d.status === 'credited');
    const voided = detections.some((d) => d.expectedTtpId === exp.id && d.status === 'voided');
    let detection: DetectionDTO | null = null;
    if (credited) {
      const mttd = computeMttd(occurrencesByExpected.get(exp.id) ?? [], progress?.firstStartedAt ?? null, credited.detectedAt);
      mttdResults.push(mttd);
      detection = {
        id: credited.id,
        detectedAt: credited.detectedAt,
        pointsAwarded: credited.pointsAwarded,
        source: credited.source,
        creditedUserName: credited.creditedUserName,
        taggedTechniqueId: credited.taggedTechniqueId,
        documentationEntryId: credited.documentationEntryId,
        entryExcerpt: excerpt(credited.entryBody),
        mttd,
      };
    }
    return {
      expectedTtpId: exp.id,
      techniqueId: exp.techniqueId,
      techniqueName: getTechnique(exp.techniqueId)?.name ?? 'Unknown technique',
      tacticId: exp.tacticId,
      tacticName: getTactic(exp.tacticId)?.name ?? exp.tacticId,
      points: exp.points,
      ...(opts.includeInstructorNotes ? { description: exp.description } : {}),
      status: credited ? 'detected' : 'missed',
      voided: voided && !credited,
      detection,
    };
  });

  const tags = allTags(teamId, cyberRangeId);
  const distinct = new Map<string, { firstTaggedAt: string; stillTagged: boolean }>();
  for (const tag of tags) {
    const seen = distinct.get(tag.techniqueId);
    distinct.set(tag.techniqueId, {
      firstTaggedAt: seen?.firstTaggedAt ?? tag.taggedAt,
      stillTagged: (seen?.stillTagged ?? false) || tag.removedAt === null,
    });
  }
  const matchesAnyExpected = (id: string) => expected.some((e) => techniqueMatches(id, e.techniqueId));
  const incorrect: IncorrectDTO[] = [...distinct.entries()]
    .filter(([id]) => !matchesAnyExpected(id))
    .map(([id, info]) => ({ techniqueId: id, techniqueName: getTechnique(id)?.name ?? 'Unknown technique', ...info }))
    .sort((a, b) => a.firstTaggedAt.localeCompare(b.firstTaggedAt));

  const correctDistinct = [...distinct.keys()].filter(matchesAnyExpected).length;
  return {
    teamId,
    teamName: team.name,
    cyberRangeId,
    expected: expectedResults,
    incorrect,
    totals: {
      earnedPoints: expectedResults.reduce((sum, e) => sum + (e.detection?.pointsAwarded ?? 0), 0),
      availablePoints: expected.reduce((sum, e) => sum + e.points, 0),
      expectedCount: expected.length,
      detectedCount: expectedResults.filter((e) => e.status === 'detected').length,
      incorrectCount: incorrect.length,
      distinctTaggedCount: distinct.size,
      precision: distinct.size ? correctDistinct / distinct.size : null,
    },
    mttd: summarizeMttd(mttdResults),
  };
}

// Scenario-wide report: every team that has been on this range, plus pooled MTTD over all their
// measurable detections (with the same measured-of-detected count).
export function buildRangeTtpReport(cyberRangeId: number) {
  const teams = teamIdsOnRange(cyberRangeId)
    .map((teamId) => buildTeamTtpReport(teamId, cyberRangeId, { includeInstructorNotes: true }))
    .filter((r): r is TeamTtpReport => r !== null);
  const allMttd = teams.flatMap((t) => t.expected.map((e) => e.detection?.mttd).filter((m): m is MttdResult => !!m));
  return { cyberRangeId, teams, mttd: summarizeMttd(allMttd) };
}

// Compact per-team numbers for the Instructor Dashboard card.
export function teamTtpSummary(teamId: number, cyberRangeId: number) {
  const report = buildTeamTtpReport(teamId, cyberRangeId, { includeInstructorNotes: false });
  if (!report || report.totals.expectedCount === 0) return null;
  return { ...report.totals, mttd: report.mttd };
}
