import { db } from '../db/index.js';
import { emitClockTick, emitPressureStage, emitTimeUp } from '../sockets/emitters.js';

interface ActiveProgressRow {
  id: number;
  teamId: number;
  cyberRangeId: number;
  startedAt: string;
  timeLimitSeconds: number;
  currentPressureStageId: number | null;
}

interface StageRow {
  id: number;
  label: string;
  visualStyle: string;
}

// In-memory only: tracks which progress rows have already had time_up emitted, so it fires once
// per run rather than every tick for as long as an expired range stays 'active' (until an instructor
// completes it). Reset naturally when the process restarts or the row is re-started (new id on
// upsert conflict reuses the same id, but started_at changes — fine, since we key by id and a
// restarted range immediately has remaining > 0 again, which clears the flag below).
const timeUpEmitted = new Set<number>();

// Server-authoritative countdown: remaining time is always derived from started_at + time_limit,
// never trusted from a client timer (see CLAUDE/invariants.md). Runs once per second across every
// active team_cyber_range_progress row that has a configured time limit.
function tick() {
  const rows = db
    .prepare(
      `SELECT
         id, team_id AS teamId, cyber_range_id AS cyberRangeId, started_at AS startedAt,
         time_limit_seconds AS timeLimitSeconds, current_pressure_stage_id AS currentPressureStageId
       FROM team_cyber_range_progress
       WHERE status = 'active' AND time_limit_seconds IS NOT NULL`,
    )
    .all() as unknown as ActiveProgressRow[];

  for (const row of rows) {
    const elapsed = Math.floor((Date.now() - new Date(row.startedAt).getTime()) / 1000);
    const remaining = Math.max(0, row.timeLimitSeconds - elapsed);

    emitClockTick(row.teamId, row.id, remaining);

    // The reached stage with the smallest threshold is the most urgent one still "active".
    const stage = db
      .prepare(
        `SELECT id, label, visual_style AS visualStyle
         FROM pressure_stages
         WHERE cyber_range_id = ? AND trigger_seconds_remaining >= ?
         ORDER BY trigger_seconds_remaining ASC
         LIMIT 1`,
      )
      .get(row.cyberRangeId, remaining) as StageRow | undefined;

    if (stage && stage.id !== row.currentPressureStageId) {
      db.prepare('UPDATE team_cyber_range_progress SET current_pressure_stage_id = ? WHERE id = ?').run(
        stage.id,
        row.id,
      );
      emitPressureStage(row.teamId, row.id, stage.label, stage.visualStyle);
    }

    if (remaining === 0 && !timeUpEmitted.has(row.id)) {
      timeUpEmitted.add(row.id);
      emitTimeUp(row.teamId, row.id);
    } else if (remaining > 0) {
      timeUpEmitted.delete(row.id);
    }
  }
}

export function startClock(intervalMs = 1000) {
  return setInterval(tick, intervalMs);
}
