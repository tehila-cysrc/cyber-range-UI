import { db } from '../db/index.js';

interface StartResult {
  ok: true;
}
interface StartError {
  ok: false;
  status: number;
  error: string;
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
      `INSERT INTO team_cyber_range_progress (team_id, cyber_range_id, status, started_at, time_limit_seconds)
       VALUES (?, ?, 'active', ?, ?)
       ON CONFLICT (team_id, cyber_range_id) DO UPDATE SET
         status = 'active',
         started_at = excluded.started_at,
         time_limit_seconds = excluded.time_limit_seconds,
         completed_at = NULL`,
    ).run(teamId, cyberRangeId, startedAt, timeLimitSeconds);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { ok: true };
}
