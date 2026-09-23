import { db } from '../db/index.js';

interface StartResult {
  ok: true;
}
interface StartError {
  ok: false;
  status: number;
  error: string;
}

// The only cyber range a team may currently write to (timeline entries, canvas nodes) — resolved
// server-side, same principle as help_requests' cyberRangeId resolution: a student can't file work
// under a scenario the instructor never assigned them.
export function activeCyberRangeIdForTeam(teamId: number): number | null {
  const row = db
    .prepare(
      `SELECT cyber_range_id AS cyberRangeId FROM team_cyber_range_progress
       WHERE team_id = ? AND status = 'active' LIMIT 1`,
    )
    .get(teamId) as { cyberRangeId: number } | undefined;
  return row?.cyberRangeId ?? null;
}

// Any scenario the team has ever been assigned (active, paused or completed) — the set of ranges
// whose topology/debrief a student may read.
export function teamHasProgressOn(teamId: number, cyberRangeId: number): boolean {
  return !!db
    .prepare('SELECT 1 FROM team_cyber_range_progress WHERE team_id = ? AND cyber_range_id = ?')
    .get(teamId, cyberRangeId);
}

// Shared by the instructor admin route and the student self-service route — a team has at most one
// "current" scenario, so starting a new one pauses whatever else was active for that team (progress
// rows are kept, not deleted, so re-starting a paused range resumes its history).
export function startCyberRangeForTeam(teamId: number, cyberRangeId: number): StartResult | StartError {
  const cyberRange = db
    .prepare('SELECT expected_duration_minutes AS expectedDurationMinutes FROM cyber_ranges WHERE id = ?')
    .get(cyberRangeId) as { expectedDurationMinutes: number | null } | undefined;

  if (!cyberRange) {
    return { ok: false, status: 404, error: 'cyber range not found' };
  }

  const timeLimitSeconds =
    cyberRange.expectedDurationMinutes != null ? cyberRange.expectedDurationMinutes * 60 : null;
  const startedAt = new Date().toISOString();

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE team_cyber_range_progress SET status = 'paused'
       WHERE team_id = ? AND cyber_range_id != ? AND status = 'active'`,
    ).run(teamId, cyberRangeId);

    db.prepare(
      `INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status, started_at, first_started_at, time_limit_seconds)
       VALUES (?, ?, 'active', ?, ?, ?)
       ON CONFLICT (team_id, cyber_range_id) DO UPDATE SET
         status = 'active',
         started_at = excluded.started_at,
         first_started_at = COALESCE(team_cyber_range_progress.first_started_at, excluded.first_started_at),
         time_limit_seconds = excluded.time_limit_seconds,
         completed_at = NULL`,
    ).run(teamId, cyberRangeId, startedAt, startedAt, timeLimitSeconds);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { ok: true };
}
