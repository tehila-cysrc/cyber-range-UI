import { db } from '../db/index.js';
import { writeAudit } from './audit.service.js';

// Cyber Range (scenario) catalog writes shared by POST /admin/cyber-ranges and the Environments
// registration flow, which creates its range in the same transaction as the environment.
export const VALID_DIFFICULTIES = ['intermediate', 'advanced'];
const MAX_BRIEFING_LENGTH = 4000;

export function normalizeBriefing(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_BRIEFING_LENGTH) : null;
}

export interface NewCyberRangeInput {
  dayId: number;
  name: string;
  difficulty: string;
  expectedDurationMinutes?: number | null;
  studentBriefing?: unknown;
}

/** Returns an error message for a 400, or null when the input can be inserted. */
export function validateNewCyberRange(input: Record<string, unknown> | null | undefined): string | null {
  const { dayId, name, difficulty } = input ?? {};
  if (typeof dayId !== 'number' || typeof name !== 'string' || !name.trim() || !VALID_DIFFICULTIES.includes(difficulty as string)) {
    return `dayId (number), name (string) and difficulty ('intermediate'|'advanced') are required`;
  }
  if (!db.prepare('SELECT id FROM days WHERE id = ?').get(dayId)) return 'unknown dayId';
  return null;
}

export function insertCyberRange(input: NewCyberRangeInput): number {
  const { maxSort } = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM cyber_ranges WHERE day_id = ?')
    .get(input.dayId) as { maxSort: number };

  const result = db
    .prepare(
      `INSERT INTO cyber_ranges (day_id, name, difficulty, expected_duration_minutes, sort_order, student_briefing)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.dayId, input.name.trim(), input.difficulty, input.expectedDurationMinutes ?? null, maxSort + 1, normalizeBriefing(input.studentBriefing));
  return Number(result.lastInsertRowid);
}

export type DeleteCyberRangeResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

// Hard delete, for a scenario nothing depends on yet — e.g. one left behind by a failed environment
// registration. Blocked while an environment backs it (its topology is discovery-owned) or while any
// team of the current event has it assigned; its own CONFIG rows (topology, thresholds, expected
// techniques, publication) go with it. Anything else still pointing at it (FK) rolls the delete back.
export function deleteCyberRange(id: number, actorUsername: string): DeleteCyberRangeResult {
  const range = db.prepare('SELECT name FROM cyber_ranges WHERE id = ?').get(id) as { name: string } | undefined;
  if (!range) return { ok: false, status: 404, error: 'cyber range not found' };

  const linked = db
    .prepare(
      `SELECT e.name AS name FROM cyber_range_environments cre JOIN cloud_environments e ON e.id = cre.environment_id
       WHERE cre.cyber_range_id = ? LIMIT 1`,
    )
    .get(id) as { name: string } | undefined;
  if (linked) {
    return {
      ok: false,
      status: 409,
      error: `this scenario is backed by the environment "${linked.name}" — delete or unlink that environment on the Environments page first`,
    };
  }
  if (db.prepare('SELECT 1 FROM team_cyber_range_progress WHERE cyber_range_id = ? LIMIT 1').get(id)) {
    return {
      ok: false,
      status: 409,
      error: 'a team in the current event has been assigned this scenario, so its history would be lost — it can be deleted after an event reset',
    };
  }

  db.exec('BEGIN');
  try {
    for (const table of [
      'topology_edges',
      'topology_nodes',
      'topology_zones',
      'pressure_stages',
      'cyber_range_expected_ttps',
      'cyber_range_topology_publications',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE cyber_range_id = ?`).run(id);
    }
    db.prepare('DELETE FROM cyber_ranges WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch {
    db.exec('ROLLBACK');
    return {
      ok: false,
      status: 409,
      error: "this scenario still has recorded activity (e.g. access-session or script history on its hosts) and can't be deleted",
    };
  }

  writeAudit(actorUsername, 'cyber_range.deleted', 'cyber_range', id, { name: range.name });
  return { ok: true };
}
