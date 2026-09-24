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

export interface AuditLogEntry {
  id: number;
  actorUsername: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogRow {
  id: number;
  actorUsername: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  metadataJson: string | null;
  createdAt: string;
}

// Instructor-facing read of the compliance trail (Phase 5). CONFIG data — deliberately readable
// across event resets, since that's the whole point of it surviving them (see CLAUDE/invariants.md).
export function listAuditLog(options: { entityType?: string; limit?: number; before?: number; search?: string } = {}): AuditLogEntry[] {
  const limit = Math.min(options.limit ?? 100, 500);
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (options.entityType) {
    clauses.push('entity_type = ?');
    params.push(options.entityType);
  }
  // Free-text search over who / what / details (e.g. a username, "T1003", "discovery").
  if (options.search?.trim()) {
    clauses.push("(action LIKE ? OR actor_username LIKE ? OR metadata_json LIKE ? OR entity_type LIKE ?)");
    const like = `%${options.search.trim()}%`;
    params.push(like, like, like, like);
  }
  if (options.before) {
    clauses.push('id < ?');
    params.push(options.before);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT id, actor_username AS actorUsername, action, entity_type AS entityType, entity_id AS entityId,
              metadata_json AS metadataJson, created_at AS createdAt
       FROM audit_log ${where} ORDER BY id DESC LIMIT ?`,
    )
    .all(...params, limit) as unknown as AuditLogRow[];

  return rows.map((r) => ({
    id: r.id,
    actorUsername: r.actorUsername,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    metadata: r.metadataJson ? JSON.parse(r.metadataJson) : null,
    createdAt: r.createdAt,
  }));
}
