import { db } from '../../db/index.js';
import { expireSession } from './accessBroker.service.js';

// Server-authoritative session timeboxing, same "never trust a client-side timer" precedent as
// clock.service.ts: a session's real expiry is always this sweep comparing expires_at against the
// server clock, not anything the browser tracks. Runs once per interval across every still-'active'
// access_sessions row.
function sweep() {
  const expired = db
    .prepare(`SELECT id, team_id AS teamId FROM access_sessions WHERE outcome = 'active' AND expires_at <= ?`)
    .all(new Date().toISOString()) as { id: number; teamId: number }[];

  for (const row of expired) {
    expireSession(row.id, row.teamId);
  }
}

export function startAccessSessionExpirySweep(intervalMs = 10_000) {
  return setInterval(sweep, intervalMs);
}
