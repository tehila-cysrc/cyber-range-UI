// Scenario ground-truth documents for the AI Investigation Assessment (plan §E, Phase 2).
//
// - Versions: every upload is a new scenario_ai_documents row; the bytes are kept server-side.
// - Indexing: in the background, each version gets its own Foundry file + vector store. Every Foundry id
//   is recorded in ai_foundry_resources the moment it exists, so none is ever lost.
// - Current vs pinned: the newest READY version is `is_current` (what NEW sessions get). A team's
//   session keeps the version pinned on team_cyber_range_progress.ai_document_id; resolveSessionVersion
//   is the only resolver of the store an assessment may use.
// - Cleanup: NEVER automatic. listFoundryResources('candidates') computes which recorded resources are
//   unused; executeCleanup deletes only the ids an admin explicitly submits, re-checked server-side.
import { db } from '../../db/index.js';
import type { Principal } from '../../authz/principal.js';
import { scopeWhere } from '../../authz/scope.js';
import { writeAudit } from '../audit.service.js';
import { isAiEnabled } from './aiConfig.js';
import { FoundryError, getFoundryClient } from './foundryClient.js';
import { validateScenarioDocument } from './documentValidation.js';

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------------------------
// Rubric (plan §5 / §G): optional per-scenario weights; NULL = default.

export const RUBRIC_KEYS = ['identification', 'understanding', 'connections', 'clarity'] as const;
export type RubricKey = (typeof RUBRIC_KEYS)[number];
export const RUBRIC_LABELS: Record<RubricKey, string> = {
  identification: 'Identifying important attack events and actions',
  understanding: 'Understanding the meaning of identified events',
  connections: 'Connecting related findings and attack stages',
  clarity: 'Documentation clarity',
};
export const DEFAULT_RUBRIC: Record<RubricKey, number> = { identification: 40, understanding: 30, connections: 20, clarity: 10 };

export interface Rubric {
  criteria: { key: RubricKey; label: string; maxPoints: number }[];
  isDefault: boolean;
}

// The rubric is defined in code (user decision 2026-10-21): the same DEFAULT_RUBRIC for every scenario,
// changed only by a reviewed code change + deploy. The cyber_ranges.ai_rubric_json column is no longer
// read or written (no environment had a saved custom rubric when this changed). The parameter stays so
// call sites and assessment records keep their shape.
export function getRubric(_cyberRangeId: number): Rubric {
  return { criteria: RUBRIC_KEYS.map((key) => ({ key, label: RUBRIC_LABELS[key], maxPoints: DEFAULT_RUBRIC[key] })), isDefault: true };
}


// ---------------------------------------------------------------------------------------------
// Read model. The DTO never carries bytes or Foundry ids.

export interface DocumentDTO {
  id: number;
  version: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: 'processing' | 'ready' | 'failed' | 'superseded';
  isCurrent: boolean;
  errorCode: string | null;
  uploadedBy: string;
  createdAt: string;
  readyAt: string | null;
  supersededAt: string | null;
  pinnedSessionCount: number; // only sessions the caller may see (pair scope)
  pinnedTeams: string[]; // names of those teams (platform P2, 2026-10-18)
  assessmentCount: number; // AI assessments that used this version, in the caller's scope
  foundryDeleted: boolean; // its Foundry copy is gone (bytes kept) — rebuildable if sessions need it
  rebuilding: boolean;
}

const DOC_COLUMNS = `d.id, d.version, d.original_filename AS originalFilename, d.mime_type AS mimeType, d.size_bytes AS sizeBytes,
  d.sha256, d.status, d.is_current AS isCurrent, d.error_code AS errorCode, d.uploaded_by_username AS uploadedBy,
  d.created_at AS createdAt, d.ready_at AS readyAt, d.superseded_at AS supersededAt`;

export function listDocuments(p: Principal, cyberRangeId: number): { current: DocumentDTO | null; versions: DocumentDTO[] } {
  const scope = scopeWhere(p, 't.organization_id', 'tcp.cyber_range_id');
  const aScope = scopeWhere(p, 'a.organization_id', 'a.cyber_range_id');
  const rows = db
    .prepare(
      `SELECT ${DOC_COLUMNS}, d.foundry_deleted_at AS foundryDeletedAt,
         (SELECT COUNT(*) FROM ai_assessments a WHERE a.document_id = d.id AND ${aScope.sql}) AS assessmentCount
       FROM scenario_ai_documents d WHERE d.cyber_range_id = ? ORDER BY d.version DESC`,
    )
    .all(...aScope.params, cyberRangeId) as (Omit<DocumentDTO, 'isCurrent' | 'pinnedTeams' | 'pinnedSessionCount' | 'foundryDeleted' | 'rebuilding'> & { isCurrent: number; foundryDeletedAt: string | null })[];
  const teamsFor = db.prepare(
    `SELECT t.name FROM team_cyber_range_progress tcp JOIN teams t ON t.id = tcp.team_id
     WHERE tcp.ai_document_id = ? AND ${scope.sql} ORDER BY t.sort_order, t.name`,
  );
  const versions = rows.map(({ foundryDeletedAt, ...r }) => {
    const pinnedTeams = (teamsFor.all(r.id, ...scope.params) as { name: string }[]).map((t) => t.name);
    return { ...r, isCurrent: r.isCurrent === 1, pinnedTeams, pinnedSessionCount: pinnedTeams.length, foundryDeleted: foundryDeletedAt !== null, rebuilding: rebuilding.has(r.id) };
  }) as DocumentDTO[];
  return { current: versions.find((v) => v.isCurrent) ?? null, versions };
}

function loadDocument(id: number) {
  return db
    .prepare(
      `SELECT id, cyber_range_id AS cyberRangeId, version, original_filename AS filename, mime_type AS mimeType, content,
              status, foundry_file_id AS fileId, foundry_vector_store_id AS vectorStoreId
       FROM scenario_ai_documents WHERE id = ?`,
    )
    .get(id) as
    | { id: number; cyberRangeId: number; version: number; filename: string; mimeType: string; content: Uint8Array; status: string; fileId: string | null; vectorStoreId: string | null }
    | undefined;
}

function documentDTO(p: Principal, id: number): DocumentDTO | null {
  const row = db.prepare('SELECT cyber_range_id AS r FROM scenario_ai_documents WHERE id = ?').get(id) as { r: number } | undefined;
  return row ? (listDocuments(p, row.r).versions.find((v) => v.id === id) ?? null) : null;
}

// ---------------------------------------------------------------------------------------------
// Upload / retry

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string; reason?: string };

function processingFor(cyberRangeId: number): boolean {
  return !!db.prepare("SELECT 1 FROM scenario_ai_documents WHERE cyber_range_id = ? AND status = 'processing'").get(cyberRangeId);
}

export function uploadVersion(p: Principal, cyberRangeId: number, body: unknown): ServiceResult<DocumentDTO> {
  if (!isAiEnabled()) return { ok: false, status: 503, error: 'AI assessment is disabled on this server', reason: 'ai_disabled' };
  const v = validateScenarioDocument((body ?? {}) as { filename?: unknown; contentBase64?: unknown });
  if (!v.ok) return { ok: false, status: v.status, error: v.error, reason: v.reason };
  if (processingFor(cyberRangeId)) {
    return { ok: false, status: 409, error: 'a document for this scenario is still being processed', reason: 'already_processing' };
  }
  const current = db.prepare('SELECT sha256 FROM scenario_ai_documents WHERE cyber_range_id = ? AND is_current = 1').get(cyberRangeId) as { sha256: string } | undefined;
  if (current?.sha256 === v.sha256) {
    return { ok: false, status: 409, error: 'this document is identical to the current version', reason: 'duplicate_document' };
  }
  const version = ((db.prepare('SELECT MAX(version) AS m FROM scenario_ai_documents WHERE cyber_range_id = ?').get(cyberRangeId) as { m: number | null }).m ?? 0) + 1;
  const id = Number(
    db
      .prepare(
        `INSERT INTO scenario_ai_documents (cyber_range_id, version, original_filename, mime_type, size_bytes, sha256, content,
           status, is_current, uploaded_by_account_id, uploaded_by_username, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 0, ?, ?, ?)`,
      )
      .run(cyberRangeId, version, v.filename, v.mimeType, v.bytes.length, v.sha256, v.bytes, p.accountId, p.username, now()).lastInsertRowid,
  );
  writeAudit(p.username, 'ai_document.uploaded', 'scenario_ai_document', id, { version, sizeBytes: v.bytes.length, sha256: v.sha256, mimeType: v.mimeType }, { cyberRangeId });
  startIndexing(id, p.username);
  return { ok: true, value: documentDTO(p, id)! };
}

export function retryVersion(p: Principal, cyberRangeId: number, documentId: number): ServiceResult<DocumentDTO> {
  if (!isAiEnabled()) return { ok: false, status: 503, error: 'AI assessment is disabled on this server', reason: 'ai_disabled' };
  const doc = db.prepare('SELECT cyber_range_id AS r, status FROM scenario_ai_documents WHERE id = ?').get(documentId) as { r: number; status: string } | undefined;
  if (!doc || doc.r !== cyberRangeId) return { ok: false, status: 404, error: 'document not found' };
  if (doc.status !== 'failed') return { ok: false, status: 409, error: 'only a failed document can be retried', reason: 'not_failed' };
  if (processingFor(cyberRangeId)) {
    return { ok: false, status: 409, error: 'a document for this scenario is still being processed', reason: 'already_processing' };
  }
  // A newer version may have become current since; retrying an older one would never make it current.
  const newer = db.prepare("SELECT 1 FROM scenario_ai_documents WHERE cyber_range_id = ? AND is_current = 1 AND version > (SELECT version FROM scenario_ai_documents WHERE id = ?)").get(cyberRangeId, documentId);
  if (newer) return { ok: false, status: 409, error: 'a newer version is already current — upload again instead', reason: 'superseded_by_newer' };
  // The previous attempt's Foundry resources stay recorded (ai_foundry_resources) and become cleanup
  // candidates; the doc row's ids are cleared so they no longer count as in use.
  db.prepare("UPDATE scenario_ai_documents SET status = 'processing', error_code = NULL, foundry_file_id = NULL, foundry_vector_store_id = NULL WHERE id = ?").run(documentId);
  writeAudit(p.username, 'ai_document.retried', 'scenario_ai_document', documentId, null, { cyberRangeId });
  startIndexing(documentId, p.username);
  return { ok: true, value: documentDTO(p, documentId)! };
}

// ---------------------------------------------------------------------------------------------
// Rebuild (platform P2): a ready/superseded version whose Foundry copy is gone (deleted after use, or
// removed in Foundry) is re-uploaded from the stored bytes, so the sessions pinned to it can be assessed
// again. Status, version and pins never change; the new file/store are recorded like any other.

const rebuilding = new Set<number>();

export function rebuildVersion(p: Principal, cyberRangeId: number, documentId: number): ServiceResult<DocumentDTO> {
  if (!isAiEnabled()) return { ok: false, status: 503, error: 'AI assessment is disabled on this server', reason: 'ai_disabled' };
  const doc = db
    .prepare('SELECT cyber_range_id AS r, status, foundry_vector_store_id AS vs, foundry_deleted_at AS deletedAt FROM scenario_ai_documents WHERE id = ?')
    .get(documentId) as { r: number; status: string; vs: string | null; deletedAt: string | null } | undefined;
  if (!doc || doc.r !== cyberRangeId) return { ok: false, status: 404, error: 'document not found' };
  if (doc.status !== 'ready' && doc.status !== 'superseded') return { ok: false, status: 409, error: 'only a ready or replaced version can be rebuilt', reason: 'not_rebuildable' };
  if (!doc.deletedAt && doc.vs) return { ok: false, status: 409, error: 'this version is available in Microsoft Foundry', reason: 'not_missing' };
  if (rebuilding.has(documentId)) return { ok: false, status: 409, error: 'this version is already being rebuilt', reason: 'already_processing' };
  rebuilding.add(documentId);
  writeAudit(p.username, 'ai_document.rebuild_requested', 'scenario_ai_document', documentId, null, { cyberRangeId });
  const job = rebuildDocument(documentId, p.username).finally(() => {
    rebuilding.delete(documentId);
    inFlight.delete(documentId);
  });
  inFlight.set(documentId, job);
  return { ok: true, value: documentDTO(p, documentId)! };
}

async function rebuildDocument(documentId: number, actorUsername: string): Promise<void> {
  const doc = loadDocument(documentId);
  if (!doc) return;
  try {
    const client = getFoundryClient();
    const { fileId } = await client.uploadFile({ bytes: doc.content, filename: doc.filename, mimeType: doc.mimeType });
    recordResource('file', fileId, doc);
    const { vectorStoreId } = await client.createVectorStore({ name: `cr-${doc.cyberRangeId}-v${doc.version}-d${doc.id}-r`, fileIds: [fileId] });
    recordResource('vector_store', vectorStoreId, doc);
    const state = await client.waitForVectorStore(vectorStoreId);
    if (!state.ok) {
      writeAudit(actorUsername, 'ai_document.rebuild_failed', 'scenario_ai_document', documentId, { errorCode: safeCode(`indexing_failed${state.errorCode ? `:${state.errorCode}` : ''}`) }, { cyberRangeId: doc.cyberRangeId });
      return;
    }
    db.prepare('UPDATE scenario_ai_documents SET foundry_deleted_at = NULL WHERE id = ?').run(documentId);
    writeAudit(actorUsername, 'ai_document.rebuilt', 'scenario_ai_document', documentId, { version: doc.version }, { cyberRangeId: doc.cyberRangeId });
  } catch (e) {
    writeAudit(actorUsername, 'ai_document.rebuild_failed', 'scenario_ai_document', documentId, { errorCode: e instanceof FoundryError ? e.code : 'indexing_error' }, { cyberRangeId: doc.cyberRangeId });
  }
}

// Original bytes for staff who author the scenario (decision F). Never served under a student route.
export function documentContent(cyberRangeId: number, documentId: number, actorUsername: string): ServiceResult<{ filename: string; mimeType: string; bytes: Uint8Array }> {
  const doc = loadDocument(documentId);
  if (!doc || doc.cyberRangeId !== cyberRangeId) return { ok: false, status: 404, error: 'document not found' };
  writeAudit(actorUsername, 'ai_document.downloaded', 'scenario_ai_document', documentId, { version: doc.version }, { cyberRangeId });
  return { ok: true, value: { filename: doc.filename, mimeType: doc.mimeType, bytes: doc.content } };
}

// ---------------------------------------------------------------------------------------------
// Background indexing

const inFlight = new Map<number, Promise<void>>();

function startIndexing(documentId: number, actorUsername: string) {
  const job = indexDocument(documentId, actorUsername).finally(() => inFlight.delete(documentId));
  inFlight.set(documentId, job);
}

// Tests await this instead of sleeping.
export async function waitForAiIndexingIdle(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight.values()]);
}

function recordResource(kind: 'file' | 'vector_store', foundryId: string, doc: { id: number; cyberRangeId: number; version: number }) {
  // Same statement batch as setting the doc's id: from this point the resource is either "in use" by
  // its document or a listed cleanup candidate — never untracked.
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO ai_foundry_resources (kind, foundry_id, document_id, cyber_range_id, document_version, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(kind, foundryId, doc.id, doc.cyberRangeId, doc.version, now());
    db.prepare(`UPDATE scenario_ai_documents SET ${kind === 'file' ? 'foundry_file_id' : 'foundry_vector_store_id'} = ? WHERE id = ?`).run(foundryId, doc.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const safeCode = (s: string) => s.replace(/[^a-z0-9_:.-]/gi, '').slice(0, 100);

function markFailed(documentId: number, code: string, cyberRangeId: number, actorUsername: string) {
  db.prepare("UPDATE scenario_ai_documents SET status = 'failed', error_code = ? WHERE id = ? AND status = 'processing'").run(safeCode(code), documentId);
  writeAudit(actorUsername, 'ai_document.failed', 'scenario_ai_document', documentId, { errorCode: safeCode(code) }, { cyberRangeId });
}

async function indexDocument(documentId: number, actorUsername: string): Promise<void> {
  const doc = loadDocument(documentId);
  if (!doc || doc.status !== 'processing') return;
  try {
    const client = getFoundryClient();
    const { fileId } = await client.uploadFile({ bytes: doc.content, filename: doc.filename, mimeType: doc.mimeType });
    recordResource('file', fileId, doc);
    const { vectorStoreId } = await client.createVectorStore({ name: `cr-${doc.cyberRangeId}-v${doc.version}-d${doc.id}`, fileIds: [fileId] });
    recordResource('vector_store', vectorStoreId, doc);
    const state = await client.waitForVectorStore(vectorStoreId);
    if (!state.ok) {
      markFailed(documentId, `indexing_failed${state.errorCode ? `:${state.errorCode}` : ''}`, doc.cyberRangeId, actorUsername);
      return;
    }
    // Promote atomically: previous current -> superseded; this -> ready + current; sessions that started
    // before ANY version existed get this one (first-ready backfill). Pinned sessions never move.
    db.exec('BEGIN');
    try {
      const t = now();
      const still = db.prepare("SELECT 1 FROM scenario_ai_documents WHERE id = ? AND status = 'processing'").get(documentId);
      if (!still) {
        db.exec('ROLLBACK');
        return;
      }
      const previous = db.prepare('SELECT id FROM scenario_ai_documents WHERE cyber_range_id = ? AND is_current = 1').get(doc.cyberRangeId) as { id: number } | undefined;
      if (previous) {
        db.prepare("UPDATE scenario_ai_documents SET is_current = 0, status = 'superseded', superseded_at = ? WHERE id = ?").run(t, previous.id);
      }
      db.prepare("UPDATE scenario_ai_documents SET status = 'ready', is_current = 1, ready_at = ?, error_code = NULL WHERE id = ?").run(t, documentId);
      const pinned = db
        .prepare('UPDATE team_cyber_range_progress SET ai_document_id = ? WHERE cyber_range_id = ? AND ai_document_id IS NULL')
        .run(documentId, doc.cyberRangeId).changes;
      db.exec('COMMIT');
      writeAudit(actorUsername, 'ai_document.indexed', 'scenario_ai_document', documentId, { version: doc.version, supersededDocumentId: previous?.id ?? null, sessionsPinned: Number(pinned) }, { cyberRangeId: doc.cyberRangeId });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (e) {
    // Never log the raw error (could carry request details); FoundryError is already a safe code.
    markFailed(documentId, e instanceof FoundryError ? e.code : 'indexing_error', doc.cyberRangeId, actorUsername);
    if (!(e instanceof FoundryError)) console.error(`[ai-documents] indexing failed for document ${documentId} (unexpected error)`);
  }
}

// Startup: a process restart interrupts in-flight work. Mark it failed (retryable) — the Foundry
// resources it may already have created stay recorded and are NOT deleted.
export function recoverInterruptedAiWork(): { documents: number; assessments: number } {
  const documents = Number(db.prepare("UPDATE scenario_ai_documents SET status = 'failed', error_code = 'interrupted' WHERE status = 'processing'").run().changes);
  const assessments = Number(
    db.prepare("UPDATE ai_assessments SET status = 'failed', error_code = 'interrupted', completed_at = ? WHERE status IN ('pending', 'running')").run(now()).changes,
  );
  if (documents || assessments) console.log(`[ai] marked ${documents} document(s) and ${assessments} assessment(s) interrupted by a restart as failed`);
  return { documents, assessments };
}

// ---------------------------------------------------------------------------------------------
// Session pin (used by the assessment runner, Phase 5). The ONLY way to obtain a vector store id.

export interface SessionVersion {
  documentId: number;
  version: number;
  sha256: string;
  status: string;
  vectorStoreId: string | null;
  foundryDeleted: boolean;
}

export function resolveSessionVersion(teamId: number, cyberRangeId: number): SessionVersion | null {
  const row = db
    .prepare(
      `SELECT d.id AS documentId, d.version, d.sha256, d.status, d.foundry_vector_store_id AS vectorStoreId, d.foundry_deleted_at AS deletedAt
       FROM team_cyber_range_progress tcp JOIN scenario_ai_documents d ON d.id = tcp.ai_document_id
       WHERE tcp.team_id = ? AND tcp.cyber_range_id = ? AND d.cyber_range_id = tcp.cyber_range_id`,
    )
    .get(teamId, cyberRangeId) as (Omit<SessionVersion, 'foundryDeleted'> & { deletedAt: string | null }) | undefined;
  if (!row) return null;
  const { deletedAt, ...rest } = row;
  return { ...rest, foundryDeleted: deletedAt !== null };
}

// ---------------------------------------------------------------------------------------------
// Foundry resources: listing and the explicit, admin-approved cleanup.

export type CleanupReason = 'document_deleted' | 'superseded_unpinned' | 'failed_version' | 'replaced_attempt';

export interface FoundryResourceDTO {
  id: number;
  kind: 'file' | 'vector_store';
  foundryId: string;
  cyberRangeId: number | null;
  scenarioName: string | null;
  documentId: number | null;
  documentVersion: number | null;
  documentStatus: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteError: string | null;
  inUse: boolean;
  cleanupReason: CleanupReason | null; // set only for unused, not-yet-deleted resources
}

// A resource is in use while it is its document's current id AND the document is ready/processing, or
// a session pins the document, or an assessment on it is pending/running.
const IN_USE_SQL = `(d.id IS NOT NULL
  AND r.foundry_id IN (COALESCE(d.foundry_file_id, ''), COALESCE(d.foundry_vector_store_id, ''))
  AND (d.status IN ('ready', 'processing')
       OR EXISTS (SELECT 1 FROM team_cyber_range_progress tcp WHERE tcp.ai_document_id = d.id)
       OR EXISTS (SELECT 1 FROM ai_assessments a WHERE a.document_id = d.id AND a.status IN ('pending', 'running'))))`;

export function listFoundryResources(state: 'candidates' | 'all'): FoundryResourceDTO[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.kind, r.foundry_id AS foundryId, r.cyber_range_id AS cyberRangeId, cr.name AS scenarioName,
              r.document_id AS documentId, r.document_version AS documentVersion, d.status AS documentStatus,
              r.created_at AS createdAt, r.deleted_at AS deletedAt, r.deleted_by_username AS deletedBy, r.delete_error AS deleteError,
              ${IN_USE_SQL} AS inUse,
              (d.id IS NOT NULL AND r.foundry_id NOT IN (COALESCE(d.foundry_file_id, ''), COALESCE(d.foundry_vector_store_id, ''))) AS replaced
       FROM ai_foundry_resources r
       LEFT JOIN scenario_ai_documents d ON d.id = r.document_id
       LEFT JOIN cyber_ranges cr ON cr.id = r.cyber_range_id
       ORDER BY r.id`,
    )
    .all() as (Omit<FoundryResourceDTO, 'inUse' | 'cleanupReason'> & { inUse: number; replaced: number })[];
  const out = rows.map(({ replaced, ...r }) => {
    const inUse = r.inUse === 1;
    let cleanupReason: CleanupReason | null = null;
    if (!inUse && r.deletedAt === null) {
      cleanupReason = r.documentId === null ? 'document_deleted' : replaced === 1 ? 'replaced_attempt' : r.documentStatus === 'failed' ? 'failed_version' : 'superseded_unpinned';
    }
    return { ...r, inUse, cleanupReason };
  });
  return state === 'all' ? out : out.filter((r) => r.cleanupReason !== null);
}

let cleanupRunning = false;

export interface CleanupOutcome {
  deleted: { id: number; kind: string; foundryId: string }[];
  failed: { id: number; kind: string; foundryId: string; errorCode: string }[];
}

// Deletes exactly the submitted resources, after re-checking that EVERY one is still an unused,
// undeleted candidate (all-or-nothing validation, so an approval can never reach an in-use store).
export async function executeCleanup(resourceIds: unknown, actorUsername: string): Promise<ServiceResult<CleanupOutcome>> {
  if (!Array.isArray(resourceIds) || resourceIds.length === 0 || resourceIds.length > 200 || !resourceIds.every((x) => Number.isInteger(x) && x > 0)) {
    return { ok: false, status: 400, error: 'resourceIds must be a non-empty list of up to 200 resource ids' };
  }
  const ids = [...new Set(resourceIds as number[])];
  if (cleanupRunning) return { ok: false, status: 409, error: 'a cleanup is already running', reason: 'cleanup_running' };
  const candidates = new Map(listFoundryResources('candidates').map((r) => [r.id, r]));
  const notCandidates = ids.filter((id) => !candidates.has(id));
  if (notCandidates.length) {
    return { ok: false, status: 409, error: `not cleanup candidates (in use, already deleted or unknown): ${notCandidates.join(', ')}`, reason: 'not_candidates' };
  }
  let client;
  try {
    client = getFoundryClient();
  } catch {
    return { ok: false, status: 503, error: 'AI assessment is not configured on this server', reason: 'ai_not_configured' };
  }
  cleanupRunning = true;
  const outcome: CleanupOutcome = { deleted: [], failed: [] };
  try {
    // Vector stores before files: a store is removed before the file it indexes.
    const ordered = ids.map((id) => candidates.get(id)!).sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === 'vector_store' ? -1 : 1));
    for (const r of ordered) {
      try {
        if (r.kind === 'vector_store') await client.deleteVectorStore(r.foundryId);
        else await client.deleteFile(r.foundryId);
        db.prepare('UPDATE ai_foundry_resources SET deleted_at = ?, deleted_by_username = ?, delete_error = NULL WHERE id = ?').run(now(), actorUsername, r.id);
        outcome.deleted.push({ id: r.id, kind: r.kind, foundryId: r.foundryId });
      } catch (e) {
        const code = e instanceof FoundryError ? e.code : 'delete_error';
        db.prepare('UPDATE ai_foundry_resources SET delete_error = ? WHERE id = ?').run(code, r.id);
        outcome.failed.push({ id: r.id, kind: r.kind, foundryId: r.foundryId, errorCode: code });
      }
    }
    // A document whose recorded Foundry resources are all gone is marked as such (its bytes remain).
    db.prepare(
      `UPDATE scenario_ai_documents SET foundry_deleted_at = ?
       WHERE foundry_deleted_at IS NULL AND id IN (SELECT document_id FROM ai_foundry_resources WHERE document_id IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM ai_foundry_resources r WHERE r.document_id = scenario_ai_documents.id AND r.deleted_at IS NULL)`,
    ).run(now());
  } finally {
    cleanupRunning = false;
  }
  writeAudit(actorUsername, 'ai_resources.cleanup', 'ai_foundry_resource', null, {
    requested: ids.length,
    deleted: outcome.deleted.map((d) => d.foundryId),
    failed: outcome.failed.map((f) => ({ foundryId: f.foundryId, errorCode: f.errorCode })),
  });
  return { ok: true, value: outcome };
}
