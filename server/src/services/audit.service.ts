import { db } from '../db/index.js';

// One shared, append-only compliance trail (CONFIG — never touched by event reset, see
// CLAUDE/invariants.md). Called from every mutating action on cloud environments/credentials so the
// audit trail can't be forgotten ad hoc per-route.
export function writeAudit(
  actorUsername: string | null,
  action: string,
  entityType: string,
  entityId: number | null,
  metadata: Record<string, unknown> | null = null,
): void {
  db.prepare(
    `INSERT INTO audit_log (actor_username, action, entity_type, entity_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(actorUsername, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
}
