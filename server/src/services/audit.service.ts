import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from '../db/index.js';
import type { Principal } from '../authz/principal.js';
import { isAdmin } from '../authz/roles.js';

// Who is acting in the current request — set once by requireAuth, read by every writeAudit call below
// it, so no call site can forget the actor's role/account/IP.
export interface AuditActor {
  accountId: number | null;
  role: string;
  ip: string | null;
}
const actorContext = new AsyncLocalStorage<AuditActor>();

// Runs the rest of the request (sync and async) with this actor; scoped, so it can never leak into
// another request on the same connection.
export function runAsAuditActor(actor: AuditActor, fn: () => void) {
  actorContext.run(actor, fn);
}

export interface AuditScope {
  organizationId?: number | null;
  cyberRangeId?: number | null;
  outcome?: 'allowed' | 'denied';
}

// One shared, append-only compliance trail (CONFIG — never touched by event reset, see
// CLAUDE/invariants.md). Called from every mutating action on cloud environments/credentials so the
// audit trail can't be forgotten ad hoc per-route.
export function writeAudit(
  actorUsername: string | null,
  action: string,
  entityType: string,
  entityId: number | null,
  metadata: Record<string, unknown> | null = null,
  scope: AuditScope = {},
): void {
  const actor = actorContext.getStore();
  db.prepare(
    `INSERT INTO audit_log (actor_username, action, entity_type, entity_id, metadata_json, created_at,
       actor_account_id, actor_role, organization_id, cyber_range_id, outcome, client_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    actorUsername,
    action,
    entityType,
    entityId,
    metadata ? JSON.stringify(metadata) : null,
    new Date().toISOString(),
    actor?.accountId ?? null,
    actor?.role ?? null,
    scope.organizationId ?? null,
    scope.cyberRangeId ?? null,
    scope.outcome ?? 'allowed',
    actor?.ip ?? null,
  );
}

export interface AuditLogEntry {
  id: number;
  actorUsername: string | null;
  actorRole: string | null;
  organizationId: number | null;
  cyberRangeId: number | null;
  outcome: string;
  action: string;
  entityType: string;
  entityId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogRow {
  id: number;
  actorUsername: string | null;
  actorRole: string | null;
  organizationId: number | null;
  cyberRangeId: number | null;
  outcome: string;
  action: string;
  entityType: string;
  entityId: number | null;
  metadataJson: string | null;
  createdAt: string;
}

// Read of the compliance trail (Phase 5). CONFIG data — deliberately readable across event resets,
// since that's the whole point of it surviving them (see CLAUDE/invariants.md).
// Scoped per reader (RBAC §4.7): an admin sees everything; an instructor sees a row whose
// (organization, scenario) pair is theirs, an organization-only row of an assigned organization, or a
// scenario-only row (content edits) of an assigned scenario. Rows with neither (sign-ins, accounts,
// system actions) are admin-only. Students never reach this (no audit.read).
export function listAuditLog(
  options: { entityType?: string; limit?: number; before?: number; search?: string } = {},
  reader: Principal,
): AuditLogEntry[] {
  const limit = Math.min(options.limit ?? 100, 500);
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (!isAdmin(reader.role)) {
    const accountId = reader.accountId ?? -1;
    clauses.push(`(
      (organization_id IS NOT NULL AND cyber_range_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM instructor_assignments ia WHERE ia.account_id = ?
           AND ia.organization_id = audit_log.organization_id AND ia.cyber_range_id = audit_log.cyber_range_id))
      OR (organization_id IS NOT NULL AND cyber_range_id IS NULL AND organization_id IN (
         SELECT ia.organization_id FROM instructor_assignments ia WHERE ia.account_id = ?))
      OR (organization_id IS NULL AND cyber_range_id IS NOT NULL AND cyber_range_id IN (
         SELECT ia.cyber_range_id FROM instructor_assignments ia WHERE ia.account_id = ?))
    )`);
    params.push(accountId, accountId, accountId);
  }

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
      `SELECT id, actor_username AS actorUsername, actor_role AS actorRole, organization_id AS organizationId,
              cyber_range_id AS cyberRangeId, outcome, action, entity_type AS entityType, entity_id AS entityId,
              metadata_json AS metadataJson, created_at AS createdAt
       FROM audit_log ${where} ORDER BY id DESC LIMIT ?`,
    )
    .all(...params, limit) as unknown as AuditLogRow[];

  return rows.map((r) => ({
    id: r.id,
    actorUsername: r.actorUsername,
    actorRole: r.actorRole,
    organizationId: r.organizationId,
    cyberRangeId: r.cyberRangeId,
    outcome: r.outcome,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    metadata: r.metadataJson ? JSON.parse(r.metadataJson) : null,
    createdAt: r.createdAt,
  }));
}
