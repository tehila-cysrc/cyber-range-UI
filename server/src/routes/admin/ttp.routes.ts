import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getActiveEventRunId } from '../../db/seed.js';
import { writeAudit } from '../../services/audit.service.js';
import { getTactic, getTechnique, isValidTechniqueId, listCatalog } from '../../services/mitreCatalog.js';
import {
  activeExpectedTtps,
  buildRangeTtpReport,
  buildTeamTtpReport,
  getExpectedTtp,
  inTransaction,
  manualCredit,
  occurrencesForRange,
  teamIdsOnRange,
  VOID_REASON_EXPECTATION_REMOVED,
  voidDetection,
} from '../../services/ttpScoring.service.js';
import { announceCredits, announceLeaderboard, reconcileRangeAndAnnounce } from '../../services/ttpAnnounce.js';
import { emitTtpChanged } from '../../sockets/emitters.js';

// Instructor-only ATT&CK surface: the scenario's expected techniques, occurrences, reports and credit
// overrides. Everything in this file is answer-key data — nothing here may ever be reachable from a
// student route (see CLAUDE/invariants.md).
const router = Router();

router.use(requireAuth, requireRole('instructor'));

const MAX_POINTS = 1000;
const MAX_DESCRIPTION = 500;

function cyberRangeExists(id: number): boolean {
  return !!db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(id);
}

function expectedDTO(cyberRangeId: number) {
  const scriptNames = new Map(
    (db.prepare('SELECT id, name FROM scripts').all() as { id: number; name: string }[]).map((s) => [s.id, s.name]),
  );
  const nodeLabels = new Map(
    (
      db.prepare('SELECT id, label FROM topology_nodes WHERE cyber_range_id = ?').all(cyberRangeId) as {
        id: number;
        label: string;
      }[]
    ).map((n) => [n.id, n.label]),
  );
  return activeExpectedTtps(cyberRangeId).map((e) => ({
    ...e,
    techniqueName: getTechnique(e.techniqueId)?.name ?? 'Unknown technique',
    parentTechniqueName: (() => {
      const parentId = getTechnique(e.techniqueId)?.parentId;
      return parentId ? getTechnique(parentId)?.name ?? null : null;
    })(),
    tacticName: getTactic(e.tacticId)?.name ?? e.tacticId,
    triggerScriptName: e.triggerScriptId != null ? scriptNames.get(e.triggerScriptId) ?? null : null,
    topologyNodeLabel: e.topologyNodeId != null ? nodeLabels.get(e.topologyNodeId) ?? null : null,
  }));
}

function notifyRange(cyberRangeId: number) {
  for (const teamId of teamIdsOnRange(cyberRangeId)) emitTtpChanged(teamId, cyberRangeId);
}

type FieldCheck = { ok: true } | { ok: false; error: string };

function validateOptionalRefs(cyberRangeId: number, body: Record<string, unknown>): FieldCheck {
  if (body.points !== undefined) {
    const p = body.points;
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > MAX_POINTS) {
      return { ok: false, error: `points must be a whole number between 1 and ${MAX_POINTS}` };
    }
  }
  if (body.description != null && (typeof body.description !== 'string' || body.description.length > MAX_DESCRIPTION)) {
    return { ok: false, error: `description must be text of at most ${MAX_DESCRIPTION} characters` };
  }
  if (body.topologyNodeId != null) {
    if (!Number.isInteger(body.topologyNodeId)) return { ok: false, error: 'topologyNodeId must be a number' };
    if (!db.prepare('SELECT 1 FROM topology_nodes WHERE id = ? AND cyber_range_id = ?').get(body.topologyNodeId as number, cyberRangeId)) {
      return { ok: false, error: "that host isn't part of this scenario's topology" };
    }
  }
  if (body.triggerScriptId != null) {
    if (!Number.isInteger(body.triggerScriptId)) return { ok: false, error: 'triggerScriptId must be a number' };
    if (!db.prepare('SELECT 1 FROM scripts WHERE id = ?').get(body.triggerScriptId as number)) {
      return { ok: false, error: 'trigger script not found in the Script Library' };
    }
  }
  if (body.sortOrder !== undefined && (typeof body.sortOrder !== 'number' || !Number.isInteger(body.sortOrder))) {
    return { ok: false, error: 'sortOrder must be a whole number' };
  }
  return { ok: true };
}

function validTacticFor(techniqueId: string, tacticId: unknown): boolean {
  return typeof tacticId === 'string' && (getTechnique(techniqueId)?.tacticIds.includes(tacticId) ?? false);
}

router.get('/cyber-ranges/:cyberRangeId/expected-ttps', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  if (!cyberRangeExists(cyberRangeId)) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }
  const expected = expectedDTO(cyberRangeId);
  res.json({
    attackVersion: listCatalog().attackVersion,
    expected,
    totalPoints: expected.reduce((sum, e) => sum + e.points, 0),
    occurrences: occurrencesForRange(cyberRangeId),
  });
});

router.post('/cyber-ranges/:cyberRangeId/expected-ttps', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  if (!cyberRangeExists(cyberRangeId)) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { techniqueId } = body;
  if (!isValidTechniqueId(techniqueId)) {
    res.status(400).json({ error: 'techniqueId must be a MITRE ATT&CK technique id from the catalog (e.g. T1087)' });
    return;
  }
  if (typeof body.points !== 'number') {
    res.status(400).json({ error: 'points is required' });
    return;
  }
  const tacticId = body.tacticId ?? getTechnique(techniqueId)!.tacticIds[0];
  if (!validTacticFor(techniqueId, tacticId)) {
    res.status(400).json({ error: `tacticId must be one of ${techniqueId}'s tactics: ${getTechnique(techniqueId)!.tacticIds.join(', ')}` });
    return;
  }
  const check = validateOptionalRefs(cyberRangeId, body);
  if (!check.ok) {
    res.status(400).json({ error: check.error });
    return;
  }

  const { maxSort } = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM cyber_range_expected_ttps WHERE cyber_range_id = ? AND is_active = 1')
    .get(cyberRangeId) as { maxSort: number };
  const now = new Date().toISOString();
  let id: number;
  try {
    const result = db
      .prepare(
        `INSERT INTO cyber_range_expected_ttps
           (cyber_range_id, technique_id, tactic_id, points, description, topology_node_id, trigger_script_id, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cyberRangeId,
        techniqueId,
        tacticId as string,
        body.points as number,
        typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
        (body.topologyNodeId as number | null | undefined) ?? null,
        (body.triggerScriptId as number | null | undefined) ?? null,
        typeof body.sortOrder === 'number' ? body.sortOrder : maxSort + 1,
        now,
        now,
      );
    id = Number(result.lastInsertRowid);
  } catch {
    // idx_expected_ttps_one_active_per_technique
    res.status(409).json({ error: `${techniqueId} is already an expected technique for this scenario` });
    return;
  }

  writeAudit(req.user!.username, 'ttp.expected_created', 'expected_ttp', id, { cyberRangeId, techniqueId, points: body.points });
  // A new expectation can credit tags teams already made (detected_at stays the tag's own time).
  reconcileRangeAndAnnounce(cyberRangeId);
  res.status(201).json({ expected: expectedDTO(cyberRangeId).find((e) => e.id === id) });
});

// technique_id is deliberately not editable: changing it would silently re-point existing credits at
// a different technique. Remove + add instead.
router.patch('/expected-ttps/:id', (req, res) => {
  const existing = getExpectedTtp(Number(req.params.id));
  if (!existing || !existing.isActive) {
    res.status(404).json({ error: 'expected technique not found' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if ('techniqueId' in body && body.techniqueId !== existing.techniqueId) {
    res.status(400).json({ error: "the technique can't be changed — remove this one and add the new technique instead" });
    return;
  }
  if (body.tacticId !== undefined && !validTacticFor(existing.techniqueId, body.tacticId)) {
    res.status(400).json({ error: `tacticId must be one of ${existing.techniqueId}'s tactics` });
    return;
  }
  const check = validateOptionalRefs(existing.cyberRangeId, body);
  if (!check.ok) {
    res.status(400).json({ error: check.error });
    return;
  }

  // `in` checks (not COALESCE) so an explicit null clears an optional field.
  const next = {
    tacticId: (body.tacticId as string | undefined) ?? existing.tacticId,
    points: (body.points as number | undefined) ?? existing.points,
    description:
      'description' in body
        ? typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : null
        : existing.description,
    topologyNodeId: 'topologyNodeId' in body ? ((body.topologyNodeId as number | null) ?? null) : existing.topologyNodeId,
    triggerScriptId: 'triggerScriptId' in body ? ((body.triggerScriptId as number | null) ?? null) : existing.triggerScriptId,
    sortOrder: (body.sortOrder as number | undefined) ?? existing.sortOrder,
  };
  db.prepare(
    `UPDATE cyber_range_expected_ttps SET tactic_id = ?, points = ?, description = ?, topology_node_id = ?,
       trigger_script_id = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
  ).run(next.tacticId, next.points, next.description, next.topologyNodeId, next.triggerScriptId, next.sortOrder, new Date().toISOString(), existing.id);

  writeAudit(req.user!.username, 'ttp.expected_updated', 'expected_ttp', existing.id, {
    cyberRangeId: existing.cyberRangeId,
    techniqueId: existing.techniqueId,
    changes: Object.keys(body),
  });
  // Points edits apply to future credits only (existing ones keep their snapshot) — no reconcile needed.
  notifyRange(existing.cyberRangeId);
  res.json({ expected: expectedDTO(existing.cyberRangeId).find((e) => e.id === existing.id) });
});

// Soft delete. Credits already awarded against it would otherwise keep points for a technique the
// scenario no longer expects, so the instructor must explicitly choose to void them.
router.delete('/expected-ttps/:id', (req, res) => {
  const existing = getExpectedTtp(Number(req.params.id));
  if (!existing || !existing.isActive) {
    res.status(404).json({ error: 'expected technique not found' });
    return;
  }
  const credited = db
    .prepare(`SELECT id FROM ttp_detections WHERE expected_ttp_id = ? AND status = 'credited'`)
    .all(existing.id) as { id: number }[];
  if (credited.length > 0 && req.query.voidDetections !== 'true') {
    res.status(409).json({
      error: `${credited.length} team(s) were already credited for this technique. Remove it anyway and void those credits (their points are removed)?`,
      creditedCount: credited.length,
    });
    return;
  }

  // One atomic unit: never "some credits voided, expectation still active".
  inTransaction(() => {
    for (const d of credited) voidDetection(d.id, req.user!.id, VOID_REASON_EXPECTATION_REMOVED);
    db.prepare('UPDATE cyber_range_expected_ttps SET is_active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), existing.id);
  });

  writeAudit(req.user!.username, 'ttp.expected_deleted', 'expected_ttp', existing.id, {
    cyberRangeId: existing.cyberRangeId,
    techniqueId: existing.techniqueId,
    voidedCredits: credited.length,
  });
  if (credited.length > 0) announceLeaderboard();
  notifyRange(existing.cyberRangeId);
  res.json({ ok: true, voidedCredits: credited.length });
});

// Manual "Mark occurred" — for activity the platform didn't run itself (the external AI Agent
// Simulator, a hands-on injector). MTTD only: never creates or changes a credit.
router.post('/expected-ttps/:id/occurrences', (req, res) => {
  const existing = getExpectedTtp(Number(req.params.id));
  if (!existing || !existing.isActive) {
    res.status(404).json({ error: 'expected technique not found' });
    return;
  }
  const eventRunId = getActiveEventRunId();
  if (eventRunId == null) {
    res.status(409).json({ error: 'no active event run' });
    return;
  }
  const run = db.prepare('SELECT started_at AS startedAt FROM event_runs WHERE id = ?').get(eventRunId) as { startedAt: string };
  const nowMs = Date.now();
  const raw = req.body?.occurredAt;
  let occurredMs = nowMs;
  if (raw != null) {
    occurredMs = typeof raw === 'string' ? Date.parse(raw) : NaN;
    if (!Number.isFinite(occurredMs)) {
      res.status(400).json({ error: 'occurredAt must be an ISO-8601 timestamp' });
      return;
    }
    if (occurredMs > nowMs) {
      res.status(400).json({ error: "occurredAt can't be in the future" });
      return;
    }
    if (occurredMs < Date.parse(run.startedAt)) {
      res.status(400).json({ error: "occurredAt can't be before the current event run started" });
      return;
    }
  }
  const occurredAt = new Date(occurredMs).toISOString();
  const result = db
    .prepare(
      `INSERT INTO ttp_occurrences (event_run_id, cyber_range_id, expected_ttp_id, occurred_at, source, recorded_by_user_id, created_at)
       VALUES (?, ?, ?, ?, 'manual', ?, ?)`,
    )
    .run(eventRunId, existing.cyberRangeId, existing.id, occurredAt, req.user!.id, new Date().toISOString());

  writeAudit(req.user!.username, 'ttp.occurrence_recorded', 'expected_ttp', existing.id, {
    cyberRangeId: existing.cyberRangeId,
    techniqueId: existing.techniqueId,
    occurredAt,
  });
  notifyRange(existing.cyberRangeId);
  res.status(201).json({ occurrence: occurrencesForRange(existing.cyberRangeId).find((o) => o.id === Number(result.lastInsertRowid)) });
});

router.delete('/ttp-occurrences/:id', (req, res) => {
  const occurrence = db
    .prepare('SELECT id, cyber_range_id AS cyberRangeId, expected_ttp_id AS expectedTtpId, occurred_at AS occurredAt FROM ttp_occurrences WHERE id = ?')
    .get(Number(req.params.id)) as { id: number; cyberRangeId: number; expectedTtpId: number; occurredAt: string } | undefined;
  if (!occurrence) {
    res.status(404).json({ error: 'occurrence not found' });
    return;
  }
  db.prepare('DELETE FROM ttp_occurrences WHERE id = ?').run(occurrence.id);
  writeAudit(req.user!.username, 'ttp.occurrence_deleted', 'expected_ttp', occurrence.expectedTtpId, {
    cyberRangeId: occurrence.cyberRangeId,
    occurredAt: occurrence.occurredAt,
  });
  notifyRange(occurrence.cyberRangeId);
  res.json({ ok: true });
});

router.get('/cyber-ranges/:cyberRangeId/ttp-report', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  if (!cyberRangeExists(cyberRangeId)) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }
  if (req.query.teamId) {
    const report = buildTeamTtpReport(Number(req.query.teamId), cyberRangeId, { includeInstructorNotes: true });
    if (!report) {
      res.status(404).json({ error: 'team not found' });
      return;
    }
    res.json({ report });
    return;
  }
  res.json(buildRangeTtpReport(cyberRangeId));
});

router.post('/ttp-detections', (req, res) => {
  const { teamId, expectedTtpId, documentationEntryId, note } = req.body ?? {};
  if (typeof teamId !== 'number' || typeof expectedTtpId !== 'number' || typeof documentationEntryId !== 'number') {
    res.status(400).json({ error: 'teamId, expectedTtpId and documentationEntryId are required' });
    return;
  }
  if (note != null && (typeof note !== 'string' || note.length > 500)) {
    res.status(400).json({ error: 'note must be text of at most 500 characters' });
    return;
  }
  const result = manualCredit(teamId, expectedTtpId, documentationEntryId, req.user!.id);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  writeAudit(req.user!.username, 'ttp.manual_credit', 'ttp_detection', result.detectionId!, {
    teamId,
    expectedTtpId,
    documentationEntryId,
    points: result.points,
    // Instructor-private: never copied into the student-visible scores.note.
    note: typeof note === 'string' && note.trim() ? note.trim() : null,
  });
  announceCredits([{ scoreId: result.scoreId!, teamId, creditedUserId: result.creditedUserId ?? null }]);
  announceLeaderboard();
  emitTtpChanged(teamId, result.cyberRangeId);
  res.status(201).json({ ok: true, detectionId: result.detectionId });
});

router.post('/ttp-detections/:id/void', (req, res) => {
  const reason = req.body?.reason;
  if (reason != null && (typeof reason !== 'string' || reason.length > 500)) {
    res.status(400).json({ error: 'reason must be text of at most 500 characters' });
    return;
  }
  const detectionId = Number(req.params.id);
  const trimmed = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
  // The removal marker is reserved (it doesn't block re-credit) — an instructor can't reuse it.
  const result = voidDetection(detectionId, req.user!.id, trimmed === VOID_REASON_EXPECTATION_REMOVED ? `${trimmed} (manual)` : trimmed);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  writeAudit(req.user!.username, 'ttp.credit_voided', 'ttp_detection', detectionId, { teamId: result.teamId, reason: reason ?? null });
  announceLeaderboard();
  emitTtpChanged(result.teamId, result.cyberRangeId);
  res.json({ ok: true });
});

export default router;
