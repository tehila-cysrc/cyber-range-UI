import { db } from '../../db/index.js';
import { getResolvedCredential } from '../environments.service.js';
import { writeAudit } from '../audit.service.js';
import { classifyAzureError } from '../azureErrors.js';
import { AzureDiscoveryProvider } from './azureDiscoveryProvider.js';
import type { DiscoveredResource, DiscoveryProvider, DiscoveryResult, DiscoveryWarning } from './discoveryProvider.js';

// Adding a provider (AWS, ...) is writing an implementation of DiscoveryProvider and registering it
// here — everything below this map is provider-neutral.
const PROVIDERS: Record<string, DiscoveryProvider> = {
  azure: new AzureDiscoveryProvider(),
};

export interface DiscoveryRunSummary {
  id: number;
  environmentId: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredByUsername: string | null;
  resourceCounts: Record<string, number> | null;
  errors: DiscoveryWarning[] | null;
}

export type TriggerOutcome = { ok: true; runId: number } | { ok: false; status: number; error: string };

export function triggerDiscovery(environmentId: number, actorUsername: string): TriggerOutcome {
  const env = db.prepare('SELECT id FROM cloud_environments WHERE id = ?').get(environmentId);
  if (!env) return { ok: false, status: 404, error: 'environment not found' };

  try {
    const result = db
      .prepare(
        `INSERT INTO environment_discovery_runs (environment_id, status, started_at, triggered_by_username)
         VALUES (?, 'running', ?, ?)`,
      )
      .run(environmentId, new Date().toISOString(), actorUsername);
    const runId = result.lastInsertRowid as number;

    writeAudit(actorUsername, 'environment.discovery_triggered', 'cloud_environment', environmentId, { runId });

    // Fire-and-forget: the HTTP response returns immediately with the run id; the run's own status
    // row is how the caller/UI polls for completion (GET .../discovery-runs/:runId). This catch is a
    // last resort for a genuine bug (e.g. a DB error) — real Azure SDK failures are already routed
    // through classifyAzureError inside runDiscovery before reaching here, so `err` at this point is
    // never a raw SDK error carrying credential/request details.
    void runDiscovery(runId).catch((err) => {
      console.error(`[discovery] unhandled error running discovery run ${runId}:`, err);
    });

    return { ok: true, runId };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return { ok: false, status: 409, error: 'a discovery run is already in progress for this environment' };
    }
    throw err;
  }
}

export function listDiscoveryRuns(environmentId: number): DiscoveryRunSummary[] {
  const rows = db
    .prepare(
      `SELECT id, environment_id AS environmentId, status, started_at AS startedAt, finished_at AS finishedAt,
              triggered_by_username AS triggeredByUsername, resource_counts_json AS resourceCountsJson, errors_json AS errorsJson
       FROM environment_discovery_runs WHERE environment_id = ? ORDER BY id DESC`,
    )
    .all(environmentId) as unknown as RunRow[];
  return rows.map(toRunSummary);
}

export function getDiscoveryRun(runId: number): DiscoveryRunSummary | null {
  const row = db
    .prepare(
      `SELECT id, environment_id AS environmentId, status, started_at AS startedAt, finished_at AS finishedAt,
              triggered_by_username AS triggeredByUsername, resource_counts_json AS resourceCountsJson, errors_json AS errorsJson
       FROM environment_discovery_runs WHERE id = ?`,
    )
    .get(runId) as RunRow | undefined;
  return row ? toRunSummary(row) : null;
}

interface RunRow {
  id: number;
  environmentId: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredByUsername: string | null;
  resourceCountsJson: string | null;
  errorsJson: string | null;
}

function toRunSummary(row: RunRow): DiscoveryRunSummary {
  return {
    id: row.id,
    environmentId: row.environmentId,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    triggeredByUsername: row.triggeredByUsername,
    resourceCounts: row.resourceCountsJson ? JSON.parse(row.resourceCountsJson) : null,
    errors: row.errorsJson ? JSON.parse(row.errorsJson) : null,
  };
}

async function runDiscovery(runId: number): Promise<void> {
  const run = db
    .prepare('SELECT environment_id AS environmentId, triggered_by_username AS triggeredByUsername FROM environment_discovery_runs WHERE id = ?')
    .get(runId) as { environmentId: number; triggeredByUsername: string | null } | undefined;
  if (!run) return;

  const providerKey = (db.prepare('SELECT provider FROM cloud_environments WHERE id = ?').get(run.environmentId) as { provider: string } | undefined)
    ?.provider;
  const provider = providerKey ? PROVIDERS[providerKey] : undefined;
  if (!provider) {
    finishRun(runId, 'failed', null, [{ message: `no discovery provider registered for '${providerKey ?? 'unknown'}'` }]);
    return;
  }

  const credential = getResolvedCredential(run.environmentId);
  if (!credential) {
    finishRun(runId, 'failed', null, [{ message: 'environment credential is missing tenantId/clientId' }]);
    return;
  }

  let discovery: DiscoveryResult;
  try {
    discovery = await provider.discover(credential);
  } catch (err) {
    const { message } = classifyAzureError(err);
    finishRun(runId, 'failed', null, [{ message }]);
    writeAudit(run.triggeredByUsername, 'environment.discovery_completed', 'cloud_environment', run.environmentId, { status: 'failed' });
    return;
  }

  const linkedRangeIds = (
    db.prepare('SELECT cyber_range_id AS id FROM cyber_range_environments WHERE environment_id = ?').all(run.environmentId) as { id: number }[]
  ).map((r) => r.id);

  let status: 'succeeded' | 'partial_failure' = discovery.warnings.length > 0 ? 'partial_failure' : 'succeeded';
  const warnings = [...discovery.warnings];

  if (linkedRangeIds.length === 0) {
    warnings.push({ message: 'no cyber range is linked to this environment — resources were discovered but nothing was written to any topology' });
    status = 'partial_failure';
  } else {
    try {
      db.exec('BEGIN');
      for (const cyberRangeId of linkedRangeIds) {
        upsertForCyberRange(cyberRangeId, discovery, run.environmentId, runId);
        // Pruning (deleting previously-discovered nodes this run didn't touch) only happens on a
        // fully successful run — never on partial_failure, so a resource type that merely failed to
        // map this time isn't wrongly treated as "no longer exists".
        if (status === 'succeeded') pruneStale(cyberRangeId, run.environmentId, runId);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      finishRun(runId, 'failed', null, [{ message: `failed writing discovered topology: ${(err as Error).message}` }]);
      writeAudit(run.triggeredByUsername, 'environment.discovery_completed', 'cloud_environment', run.environmentId, { status: 'failed' });
      return;
    }
  }

  const counts = countByNodeType(discovery.resources);
  finishRun(runId, status, counts, warnings);
  writeAudit(run.triggeredByUsername, 'environment.discovery_completed', 'cloud_environment', run.environmentId, { status, counts });
}

// Exported for direct testing of the upsert/prune SQL against a real DB without needing live Azure
// credentials (see PROGRESS.txt) — not used outside this module in normal operation.
export function upsertForCyberRange(cyberRangeId: number, discovery: DiscoveryResult, environmentId: number, runId: number) {
  const nodeIdByExternalKey = new Map<string, number>();

  const insertNode = db.prepare(
    `INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type, pos_x, pos_y, metadata_json, environment_id, discovery_run_id)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)
     ON CONFLICT (cyber_range_id, external_key) WHERE external_key IS NOT NULL DO UPDATE SET
       label = excluded.label,
       node_type = excluded.node_type,
       metadata_json = excluded.metadata_json,
       environment_id = excluded.environment_id,
       discovery_run_id = excluded.discovery_run_id`,
  );
  const selectNodeId = db.prepare('SELECT id FROM topology_nodes WHERE cyber_range_id = ? AND external_key = ?');

  for (const resource of discovery.resources) {
    insertNode.run(cyberRangeId, resource.externalKey, resource.label, resource.nodeType, JSON.stringify(resource.metadata), environmentId, runId);
    const row = selectNodeId.get(cyberRangeId, resource.externalKey) as { id: number };
    nodeIdByExternalKey.set(resource.externalKey, row.id);
  }

  const insertEdge = db.prepare(
    `INSERT INTO topology_edges (cyber_range_id, from_node_id, to_node_id, label, external_key, relation_type, environment_id, discovery_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (cyber_range_id, external_key) WHERE external_key IS NOT NULL DO UPDATE SET
       from_node_id = excluded.from_node_id,
       to_node_id = excluded.to_node_id,
       label = excluded.label,
       relation_type = excluded.relation_type,
       environment_id = excluded.environment_id,
       discovery_run_id = excluded.discovery_run_id`,
  );

  for (const rel of discovery.relationships) {
    const fromId = nodeIdByExternalKey.get(rel.fromExternalKey);
    const toId = nodeIdByExternalKey.get(rel.toExternalKey);
    if (!fromId || !toId) continue; // the mapper already drops dangling relationships; defensive only
    const edgeExternalKey = `${rel.relationType}:${rel.fromExternalKey}=>${rel.toExternalKey}`;
    insertEdge.run(cyberRangeId, fromId, toId, rel.relationType, edgeExternalKey, rel.relationType, environmentId, runId);
  }
}

export function pruneStale(cyberRangeId: number, environmentId: number, runId: number) {
  db.prepare('DELETE FROM topology_edges WHERE cyber_range_id = ? AND environment_id = ? AND discovery_run_id != ?').run(
    cyberRangeId,
    environmentId,
    runId,
  );
  db.prepare('DELETE FROM topology_nodes WHERE cyber_range_id = ? AND environment_id = ? AND discovery_run_id != ?').run(
    cyberRangeId,
    environmentId,
    runId,
  );
}

function finishRun(runId: number, status: string, counts: Record<string, number> | null, errors: DiscoveryWarning[]) {
  db.prepare('UPDATE environment_discovery_runs SET status = ?, finished_at = ?, resource_counts_json = ?, errors_json = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    counts ? JSON.stringify(counts) : null,
    errors.length ? JSON.stringify(errors) : null,
    runId,
  );
}

function countByNodeType(resources: DiscoveredResource[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of resources) counts[r.nodeType] = (counts[r.nodeType] ?? 0) + 1;
  return counts;
}

function isUniqueConstraintError(err: unknown): boolean {
  const message = (err as Error)?.message ?? '';
  return message.includes('UNIQUE constraint failed');
}
