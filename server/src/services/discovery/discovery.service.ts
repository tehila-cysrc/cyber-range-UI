import { db } from '../../db/index.js';
import { getResolvedCredential } from '../environments.service.js';
import { writeAudit } from '../audit.service.js';
import { classifyAzureError } from '../azureErrors.js';
import { AzureDiscoveryProvider } from './azureDiscoveryProvider.js';
import { TopologyLayoutPlanner } from './topologyLayout.js';
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

  // Environment-wide infrastructure facts, not tied to any one linked cyber range — persisted even if
  // this run happens to have zero cyber ranges linked. COALESCE so a run that doesn't (re-)discover a
  // Bastion host/Key Vault (e.g. a resource-group-scoped query that briefly missed it) doesn't erase
  // an already-known value.
  db.prepare('UPDATE cloud_environments SET bastion_host_id = COALESCE(?, bastion_host_id), key_vault_uri = COALESCE(?, key_vault_uri) WHERE id = ?').run(
    discovery.bastionHostId,
    discovery.keyVaultUri,
    run.environmentId,
  );

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
  // Zones first — nodes below need each zone's DB id (not its external key) for their zone_id column.
  // `name` is deliberately omitted from the ON CONFLICT SET clause: an instructor's rename must
  // survive a re-discovery, same write-once-then-preserved rule as pos_x/pos_y/role/zone_id below.
  const insertZone = db.prepare(
    `INSERT INTO topology_zones (cyber_range_id, external_key, name, cidr, environment_id, discovery_run_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (cyber_range_id, external_key) WHERE external_key IS NOT NULL DO UPDATE SET
       cidr = excluded.cidr,
       environment_id = excluded.environment_id,
       discovery_run_id = excluded.discovery_run_id`,
  );
  const selectZoneId = db.prepare('SELECT id FROM topology_zones WHERE cyber_range_id = ? AND external_key = ?');

  const zoneIdByExternalKey = new Map<string, number>();
  for (const zone of discovery.zones) {
    insertZone.run(cyberRangeId, zone.externalKey, zone.name, zone.cidr, environmentId, runId);
    const row = selectZoneId.get(cyberRangeId, zone.externalKey) as { id: number };
    zoneIdByExternalKey.set(zone.externalKey, row.id);
  }

  const nodeIdByExternalKey = new Map<string, number>();

  // A freshly-imported topology must come out fully organized with zero required manual step — the
  // planner assigns every brand-new node a non-overlapping grid slot within its zone (see
  // topologyLayout.ts). An already-existing node's position is never touched here regardless of what
  // the planner would compute for it — that's what the ON CONFLICT clause below omitting pos_x/pos_y
  // guarantees, same write-once-then-preserved rule as zone_id/role/is_visible_to_students.
  const planner = new TopologyLayoutPlanner(cyberRangeId);
  const existingExternalKeys = new Set(
    (db.prepare('SELECT external_key AS externalKey FROM topology_nodes WHERE cyber_range_id = ?').all(cyberRangeId) as { externalKey: string }[]).map(
      (r) => r.externalKey,
    ),
  );
  const resolvedZoneIdByResourceKey = new Map<string, number | null>();
  const newResourceCountByZoneId = new Map<number | null, number>();
  for (const resource of discovery.resources) {
    const zoneId = resource.zoneExternalKey ? (zoneIdByExternalKey.get(resource.zoneExternalKey) ?? null) : null;
    resolvedZoneIdByResourceKey.set(resource.externalKey, zoneId);
    if (!existingExternalKeys.has(resource.externalKey)) {
      newResourceCountByZoneId.set(zoneId, (newResourceCountByZoneId.get(zoneId) ?? 0) + 1);
    }
  }

  // zone_id, role, and is_visible_to_students are set only on first insert (omitted from the SET
  // clause below) so an instructor's manual zone reassignment / role fix / visibility override
  // survives every later re-discovery.
  const insertNode = db.prepare(
    `INSERT INTO topology_nodes
       (cyber_range_id, external_key, label, node_type, pos_x, pos_y, metadata_json, environment_id, discovery_run_id, zone_id, role, is_visible_to_students)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (cyber_range_id, external_key) WHERE external_key IS NOT NULL DO UPDATE SET
       label = excluded.label,
       node_type = excluded.node_type,
       metadata_json = excluded.metadata_json,
       environment_id = excluded.environment_id,
       discovery_run_id = excluded.discovery_run_id`,
  );
  const selectNodeId = db.prepare('SELECT id FROM topology_nodes WHERE cyber_range_id = ? AND external_key = ?');

  for (const resource of discovery.resources) {
    const zoneId = resolvedZoneIdByResourceKey.get(resource.externalKey) ?? null;
    let posX = 0;
    let posY = 0;
    if (!existingExternalKeys.has(resource.externalKey)) {
      const pos = planner.nextPosition(zoneId, newResourceCountByZoneId.get(zoneId) ?? 1);
      posX = pos.x;
      posY = pos.y;
    }
    insertNode.run(
      cyberRangeId,
      resource.externalKey,
      resource.label,
      resource.nodeType,
      posX,
      posY,
      JSON.stringify(resource.metadata),
      environmentId,
      runId,
      zoneId,
      resource.role,
      resource.isVisibleToStudents ? 1 : 0,
    );
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
  // A node kept by this run (e.g. its zone_id was set on an earlier run and is write-once-preserved,
  // see upsertForCyberRange) could still point at a zone that's about to be pruned below (its backing
  // subnet was deleted in Azure) — null that out first so the zone delete never trips a dangling FK.
  db.prepare(
    `UPDATE topology_nodes SET zone_id = NULL WHERE zone_id IN (
       SELECT id FROM topology_zones WHERE cyber_range_id = ? AND environment_id = ? AND discovery_run_id != ?
     )`,
  ).run(cyberRangeId, environmentId, runId);
  db.prepare('DELETE FROM topology_zones WHERE cyber_range_id = ? AND environment_id = ? AND discovery_run_id != ?').run(
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
