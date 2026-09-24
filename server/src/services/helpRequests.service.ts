import { db } from '../db/index.js';
import { emitHelpRequestResolved } from '../sockets/emitters.js';

export type HelpResolveReason = 'instructor' | 'scenario_ended';

// A request is about one scenario — once the team's scenario is completed or switched, a still-open
// request only clutters the instructor's queue ("waiting 1h 35m" on a finished run) and leaves the
// team thinking someone is on the way. Closed with no resolver, so it reads as system-closed.
export function closeOpenHelpRequests(teamId: number, opts: { exceptCyberRangeId?: number } = {}) {
  const open = db
    .prepare(
      `SELECT id FROM help_requests
       WHERE team_id = ? AND status = 'open' ${opts.exceptCyberRangeId != null ? 'AND cyber_range_id IS NOT ?' : ''}`,
    )
    .all(...(opts.exceptCyberRangeId != null ? [teamId, opts.exceptCyberRangeId] : [teamId])) as { id: number }[];

  const resolvedAt = new Date().toISOString();
  const update = db.prepare(`UPDATE help_requests SET status = 'resolved', resolved_at = ? WHERE id = ?`);
  for (const { id } of open) {
    update.run(resolvedAt, id);
    emitHelpRequestResolved(teamId, id, 'scenario_ended');
  }
}
