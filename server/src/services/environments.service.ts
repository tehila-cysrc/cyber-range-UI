import { ClientSecretCredential } from '@azure/identity';
import { ResourceManagementClient } from '@azure/arm-resources';
import { db } from '../db/index.js';
import { copyCredential, readCredentialPlaintext, rotateCredential, storeCredential, updateCredentialMetadata } from './credential.service.js';
import { writeAudit } from './audit.service.js';
import { insertCyberRange, type NewCyberRangeInput } from './cyberRangeCatalog.service.js';
import { classifyAzureError } from './azureErrors.js';
import type { ResolvedCloudCredential } from './discovery/discoveryProvider.js';

export interface CloudEnvironmentInput {
  provider: 'azure' | 'aws';
  name: string;
  externalAccountId: string;
  externalScope: string | null;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  // Reuse that environment's stored secret instead of clientSecret (see copyCredential).
  copySecretFromEnvironmentId?: number;
  discoveryMode?: 'on_demand' | 'scheduled';
  discoveryIntervalMinutes?: number | null;
}

export interface CloudEnvironmentSummary {
  id: number;
  provider: string;
  name: string;
  externalAccountId: string;
  externalScope: string | null;
  tenantId: string | null;
  clientId: string | null;
  hasSecret: boolean;
  discoveryMode: string;
  discoveryIntervalMinutes: number | null;
  createdAt: string;
  createdByUsername: string | null;
}

interface EnvironmentRow {
  id: number;
  provider: string;
  name: string;
  externalAccountId: string;
  externalScope: string | null;
  credentialId: number;
  discoveryMode: string;
  discoveryIntervalMinutes: number | null;
  createdAt: string;
  createdByUsername: string | null;
  credentialMetadataJson: string | null;
}

const SELECT_SUMMARY = `
  SELECT e.id AS id, e.provider AS provider, e.name AS name,
         e.external_account_id AS externalAccountId, e.external_scope AS externalScope,
         e.credential_id AS credentialId, e.discovery_mode AS discoveryMode,
         e.discovery_interval_minutes AS discoveryIntervalMinutes,
         e.created_at AS createdAt, e.created_by_username AS createdByUsername,
         c.metadata_json AS credentialMetadataJson
  FROM cloud_environments e
  JOIN credentials c ON c.id = e.credential_id
`;

function toSummary(row: EnvironmentRow): CloudEnvironmentSummary {
  const meta = row.credentialMetadataJson ? JSON.parse(row.credentialMetadataJson) : {};
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    externalAccountId: row.externalAccountId,
    externalScope: row.externalScope,
    tenantId: meta.tenantId ?? null,
    clientId: meta.clientId ?? null,
    hasSecret: true,
    discoveryMode: row.discoveryMode,
    discoveryIntervalMinutes: row.discoveryIntervalMinutes,
    createdAt: row.createdAt,
    createdByUsername: row.createdByUsername,
  };
}

export function listEnvironments(): CloudEnvironmentSummary[] {
  const rows = db.prepare(SELECT_SUMMARY).all() as unknown as EnvironmentRow[];
  return rows.map(toSummary);
}

export function getEnvironment(id: number): CloudEnvironmentSummary | null {
  const row = db.prepare(`${SELECT_SUMMARY} WHERE e.id = ?`).get(id) as EnvironmentRow | undefined;
  return row ? toSummary(row) : null;
}

export function createEnvironment(input: CloudEnvironmentInput, actorUsername: string): CloudEnvironmentSummary {
  const metadata = { tenantId: input.tenantId, clientId: input.clientId };
  let credentialId: number;
  if (input.copySecretFromEnvironmentId !== undefined) {
    const source = db
      .prepare('SELECT credential_id AS credentialId FROM cloud_environments WHERE id = ?')
      .get(input.copySecretFromEnvironmentId) as { credentialId: number } | undefined;
    if (!source) throw new Error(`no environment with id ${input.copySecretFromEnvironmentId}`);
    credentialId = copyCredential(source.credentialId, metadata, actorUsername);
  } else {
    credentialId = storeCredential('service_principal', input.clientSecret, metadata, actorUsername);
  }

  const result = db
    .prepare(
      `INSERT INTO cloud_environments
         (provider, name, external_account_id, external_scope, credential_id, discovery_mode, discovery_interval_minutes, created_at, created_by_username)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.provider,
      input.name,
      input.externalAccountId,
      input.externalScope,
      credentialId,
      input.discoveryMode ?? 'on_demand',
      input.discoveryIntervalMinutes ?? null,
      new Date().toISOString(),
      actorUsername,
    );

  const id = result.lastInsertRowid as number;
  writeAudit(actorUsername, 'environment.registered', 'cloud_environment', id, {
    name: input.name,
    ...(input.copySecretFromEnvironmentId !== undefined && { secretCopiedFromEnvironmentId: input.copySecretFromEnvironmentId }),
  });

  return getEnvironment(id)!;
}

// The Environments page registers an environment together with the new Cyber Range it backs. One
// transaction, so a failure in any step (e.g. a missing CREDENTIAL_MASTER_KEY) leaves nothing behind —
// the three separate client calls this replaces left an orphaned Cyber Range on every failed attempt.
export function registerEnvironmentWithCyberRange(
  input: CloudEnvironmentInput,
  cyberRange: NewCyberRangeInput,
  actorUsername: string,
): { environment: CloudEnvironmentSummary; cyberRangeId: number } {
  db.exec('BEGIN');
  try {
    const cyberRangeId = insertCyberRange(cyberRange);
    const environment = createEnvironment(input, actorUsername);
    linkEnvironmentToCyberRange(cyberRangeId, environment.id, actorUsername);
    db.exec('COMMIT');
    return { environment, cyberRangeId };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function updateEnvironment(
  id: number,
  input: Partial<CloudEnvironmentInput>,
  actorUsername: string,
): CloudEnvironmentSummary | null {
  const existing = db.prepare('SELECT id, credential_id AS credentialId, name FROM cloud_environments WHERE id = ?').get(id) as
    | { id: number; credentialId: number; name: string }
    | undefined;
  if (!existing) return null;

  // Registering an environment creates its Cyber Range under the same name, and every other page
  // shows the Cyber Range's name — so a rename carries over to the linked ranges that still share
  // the old name. A range renamed on its own (Scenarios page) keeps its name.
  if (input.name && input.name !== existing.name) {
    db.prepare(
      `UPDATE cyber_ranges SET name = ?
       WHERE name = ? AND id IN (SELECT cyber_range_id FROM cyber_range_environments WHERE environment_id = ?)`,
    ).run(input.name, existing.name, id);
  }

  db.prepare(
    `UPDATE cloud_environments SET
       name = COALESCE(?, name),
       external_account_id = COALESCE(?, external_account_id),
       external_scope = COALESCE(?, external_scope),
       discovery_mode = COALESCE(?, discovery_mode),
       discovery_interval_minutes = COALESCE(?, discovery_interval_minutes)
     WHERE id = ?`,
  ).run(
    input.name ?? null,
    input.externalAccountId ?? null,
    input.externalScope ?? null,
    input.discoveryMode ?? null,
    input.discoveryIntervalMinutes ?? null,
    id,
  );

  // tenantId/clientId aren't secret (see toSummary/CLAUDE/invariants.md) — they live in the
  // credential row's metadata alongside the actual secret only because that's where the Service
  // Principal's identity was first captured, so correcting a mistyped one is a metadata merge, not
  // a rotation.
  if (input.tenantId || input.clientId) {
    updateCredentialMetadata(existing.credentialId, {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
    });
  }

  if (input.clientSecret) {
    rotateCredential(existing.credentialId, input.clientSecret);
    writeAudit(actorUsername, 'environment.credential_rotated', 'cloud_environment', id, null);
  }

  writeAudit(actorUsername, 'environment.updated', 'cloud_environment', id, null);
  return getEnvironment(id);
}

// Everything an environment owns, as id lists. Hosts are its discovered topology nodes; the history
// recorded on them (access sessions, script runs) goes with them. Ids are passed to SQL as one JSON
// array (`IN (SELECT value FROM json_each(?))`) so a large environment never hits SQLite's
// bound-parameter limit.
interface EnvironmentFootprint {
  nodeIds: number[];
  zoneIds: number[];
  runIds: number[];
  cyberRangeIds: number[];
}

function environmentFootprint(id: number): EnvironmentFootprint {
  const ids = (sql: string, ...params: (number | string)[]) => (db.prepare(sql).all(...params) as { id: number }[]).map((r) => r.id);
  const runIds = ids('SELECT id FROM environment_discovery_runs WHERE environment_id = ?', id);
  const runs = JSON.stringify(runIds);
  return {
    runIds,
    nodeIds: ids('SELECT id FROM topology_nodes WHERE environment_id = ? OR discovery_run_id IN (SELECT value FROM json_each(?))', id, runs),
    zoneIds: ids('SELECT id FROM topology_zones WHERE environment_id = ? OR discovery_run_id IN (SELECT value FROM json_each(?))', id, runs),
    cyberRangeIds: ids(
      `SELECT cyber_range_id AS id FROM cyber_range_environments WHERE environment_id = ?
       UNION SELECT cyber_range_id FROM topology_nodes WHERE environment_id = ?`,
      id,
      id,
    ),
  };
}

export interface EnvironmentDeletionImpact {
  hosts: number;
  zones: number;
  edges: number;
  discoveryRuns: number;
  accessTargets: number;
  accessSessions: number;
  scriptExecutions: number;
  ttpOccurrences: number; // MTTD occurrences recorded by those script runs (FK cascade)
  expectedTtpsUnlinked: number; // expected techniques that pointed at a host — kept, host link cleared
  publishedSnapshots: number; // student snapshots the hosts are stripped from
  linkedCyberRanges: { id: number; name: string; deactivated: boolean }[];
  // VM-login secrets stored in the environment's Key Vault. Never deleted from Azure here.
  keyVaultSecretsLeftInAzure: string[];
  // Live operations that block the delete: ending a session revokes its Bastion link with this
  // environment's credential, and a running script/discovery would write rows for deleted hosts.
  blockers: { activeAccessSessions: number; runningScripts: number; activeDiscoveryRuns: number };
}

function measureDeletion(id: number, fp: EnvironmentFootprint): EnvironmentDeletionImpact {
  const nodes = JSON.stringify(fp.nodeIds);
  const zones = JSON.stringify(fp.zoneIds);
  const runs = JSON.stringify(fp.runIds);
  const count = (sql: string, ...params: (number | string)[]) => (db.prepare(sql).get(...params) as { n: number }).n;
  const inNodes = 'IN (SELECT value FROM json_each(?))';

  const snapshotIds = new Set(fp.nodeIds);
  const publications = db
    .prepare(`SELECT snapshot_json AS snapshotJson FROM cyber_range_topology_publications WHERE cyber_range_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(fp.cyberRangeIds)) as { snapshotJson: string }[];

  return {
    hosts: fp.nodeIds.length,
    zones: fp.zoneIds.length,
    edges: count(
      `SELECT COUNT(*) AS n FROM topology_edges WHERE environment_id = ? OR discovery_run_id ${inNodes}
         OR from_node_id ${inNodes} OR to_node_id ${inNodes} OR from_zone_id ${inNodes} OR to_zone_id ${inNodes}`,
      id, runs, nodes, nodes, zones, zones,
    ),
    discoveryRuns: fp.runIds.length,
    accessTargets: count(`SELECT COUNT(*) AS n FROM access_targets WHERE topology_node_id ${inNodes}`, nodes),
    accessSessions: count(`SELECT COUNT(*) AS n FROM access_sessions WHERE topology_node_id ${inNodes}`, nodes),
    scriptExecutions: count(`SELECT COUNT(*) AS n FROM script_executions WHERE topology_node_id ${inNodes}`, nodes),
    ttpOccurrences: count(
      `SELECT COUNT(*) AS n FROM ttp_occurrences WHERE script_execution_id IN
         (SELECT id FROM script_executions WHERE topology_node_id ${inNodes})`,
      nodes,
    ),
    expectedTtpsUnlinked: count(`SELECT COUNT(*) AS n FROM cyber_range_expected_ttps WHERE topology_node_id ${inNodes}`, nodes),
    publishedSnapshots: publications.filter((p) =>
      (JSON.parse(p.snapshotJson) as { nodes: { id: number }[] }).nodes.some((n) => snapshotIds.has(n.id)),
    ).length,
    linkedCyberRanges: (
      db
        .prepare(
          `SELECT cr.id AS id, cr.name AS name,
                  NOT EXISTS (SELECT 1 FROM cyber_range_environments o WHERE o.cyber_range_id = cr.id AND o.environment_id != ?) AS deactivated
           FROM cyber_ranges cr JOIN cyber_range_environments l ON l.cyber_range_id = cr.id AND l.environment_id = ?
           ORDER BY cr.name`,
        )
        .all(id, id) as { id: number; name: string; deactivated: number }[]
    ).map((r) => ({ id: r.id, name: r.name, deactivated: r.deactivated === 1 })),
    keyVaultSecretsLeftInAzure: (
      db
        .prepare(`SELECT key_vault_secret_name AS name FROM access_targets WHERE key_vault_secret_name IS NOT NULL AND topology_node_id ${inNodes}`)
        .all(nodes) as { name: string }[]
    ).map((r) => r.name),
    blockers: {
      activeAccessSessions: count(`SELECT COUNT(*) AS n FROM access_sessions WHERE outcome = 'active' AND topology_node_id ${inNodes}`, nodes),
      runningScripts: count(`SELECT COUNT(*) AS n FROM script_executions WHERE status = 'running' AND topology_node_id ${inNodes}`, nodes),
      activeDiscoveryRuns: count(`SELECT COUNT(*) AS n FROM environment_discovery_runs WHERE environment_id = ? AND status IN ('queued', 'running')`, id),
    },
  };
}

// What deleting this environment would remove — shown in the confirm dialog before the admin agrees.
export function previewEnvironmentDeletion(id: number): EnvironmentDeletionImpact | null {
  if (!db.prepare('SELECT 1 FROM cloud_environments WHERE id = ?').get(id)) return null;
  return measureDeletion(id, environmentFootprint(id));
}

const isBlocked = (b: EnvironmentDeletionImpact['blockers']) => b.activeAccessSessions + b.runningScripts + b.activeDiscoveryRuns > 0;

export type DeleteEnvironmentResult =
  | { status: 'not_found' }
  | { status: 'busy'; blockers: EnvironmentDeletionImpact['blockers'] }
  | { status: 'deleted'; impact: EnvironmentDeletionImpact };

// Deletes the environment and everything recorded against its hosts, in ONE transaction: its
// discovered nodes/zones/edges and discovery runs, the hosts' access targets, access-session and
// script-execution history (and the TTP occurrences those runs recorded), its credentials, and the
// hosts' entries in published student snapshots. Never touches another environment's rows, any
// account/team/user, other event data, or anything in Azure (VMs, resource groups, Key Vault secrets).
export function deleteEnvironment(id: number, actorUsername: string): DeleteEnvironmentResult {
  const existing = db
    .prepare('SELECT id, credential_id AS credentialId, default_vm_credential_id AS defaultVmCredentialId, name FROM cloud_environments WHERE id = ?')
    .get(id) as { id: number; credentialId: number; defaultVmCredentialId: number | null; name: string } | undefined;
  if (!existing) return { status: 'not_found' };

  let impact: EnvironmentDeletionImpact;
  db.exec('BEGIN');
  try {
    // Measured inside the transaction so the blocker check and the delete see the same rows.
    const fp = environmentFootprint(id);
    impact = measureDeletion(id, fp);
    if (isBlocked(impact.blockers)) {
      db.exec('ROLLBACK');
      return { status: 'busy', blockers: impact.blockers };
    }
    const nodes = JSON.stringify(fp.nodeIds);
    const zones = JSON.stringify(fp.zoneIds);
    const runs = JSON.stringify(fp.runIds);
    const inList = 'IN (SELECT value FROM json_each(?))';

    // Host-level history first (it references the nodes). ttp_occurrences rows go with their
    // script_executions via ON DELETE CASCADE.
    const vmCredentialIds = (
      db.prepare(`SELECT credential_id AS id FROM access_targets WHERE credential_id IS NOT NULL AND topology_node_id ${inList}`).all(nodes) as {
        id: number;
      }[]
    ).map((r) => r.id);
    db.prepare(`DELETE FROM script_executions WHERE topology_node_id ${inList}`).run(nodes);
    db.prepare(`DELETE FROM access_sessions WHERE topology_node_id ${inList}`).run(nodes);
    db.prepare(`DELETE FROM access_targets WHERE topology_node_id ${inList}`).run(nodes);
    // An expected technique is scenario config, not host data — keep it, just drop the host link.
    db.prepare(`UPDATE cyber_range_expected_ttps SET topology_node_id = NULL WHERE topology_node_id ${inList}`).run(nodes);


    // Cyber ranges linked only to this environment lose their last reason to still be pickable —
    // soft-hide them (is_active=0) the same way the seeded example catalog is retired, rather than
    // deleting the range itself: real history (progress/documentation/scores) may already reference
    // it and can't be cascaded away (see CLAUDE/db.md). A range linked to more than one environment
    // stays active as long as at least one other link survives. Captured before the unlink below,
    // since that's what removes the rows this check depends on.
    const linkedCyberRangeIds = db
      .prepare('SELECT cyber_range_id AS cyberRangeId FROM cyber_range_environments WHERE environment_id = ?')
      .all(id) as { cyberRangeId: number }[];

    // Delete order matters: topology rows discovered by this environment reference it (and, for
    // nodes, the discovery run that wrote them), so they must go before the run history, which must
    // go before the environment itself — otherwise this trips the same FK constraint that protects
    // the reset operation elsewhere in this schema. Edges go by endpoint too: an instructor-drawn
    // edge (environment_id NULL) to one of these hosts/zones would otherwise block the node delete.
    db.prepare(
      `DELETE FROM topology_edges WHERE environment_id = ? OR discovery_run_id ${inList}
         OR from_node_id ${inList} OR to_node_id ${inList} OR from_zone_id ${inList} OR to_zone_id ${inList}`,
    ).run(id, runs, nodes, nodes, zones, zones);
    db.prepare(`DELETE FROM topology_nodes WHERE id ${inList}`).run(nodes);
    // A node of another environment (or hand-added) placed in one of these zones stays, unzoned.
    db.prepare(`UPDATE topology_nodes SET zone_id = NULL WHERE zone_id ${inList}`).run(zones);
    db.prepare(`DELETE FROM topology_zones WHERE id ${inList}`).run(zones);
    db.prepare('DELETE FROM environment_discovery_runs WHERE environment_id = ?').run(id);
    db.prepare('DELETE FROM cyber_range_environments WHERE environment_id = ?').run(id);
    db.prepare('DELETE FROM cloud_environments WHERE id = ?').run(id);
    // Credentials are per environment / per access target; still guarded so a row referenced
    // anywhere else is never removed.
    const deleteIfUnreferenced = db.prepare(
      `DELETE FROM credentials WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM cloud_environments WHERE credential_id = ?1 OR default_vm_credential_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM access_targets WHERE credential_id = ?1)`,
    );
    for (const credentialId of new Set([existing.credentialId, existing.defaultVmCredentialId, ...vmCredentialIds])) {
      if (credentialId != null) deleteIfUnreferenced.run(credentialId);
    }

    // Published student snapshots are frozen JSON, not FK rows — strip the deleted hosts/zones (and
    // edges touching them) so students don't keep seeing hosts that no longer exist.
    const goneNodes = new Set(fp.nodeIds);
    const goneZones = new Set(fp.zoneIds);
    const publications = db
      .prepare(`SELECT cyber_range_id AS cyberRangeId, snapshot_json AS snapshotJson FROM cyber_range_topology_publications WHERE cyber_range_id ${inList}`)
      .all(JSON.stringify(fp.cyberRangeIds)) as { cyberRangeId: number; snapshotJson: string }[];
    for (const p of publications) {
      const snap = JSON.parse(p.snapshotJson) as {
        zones: { id: number }[];
        nodes: { id: number }[];
        edges: { fromNodeId: number | null; toNodeId: number | null; fromZoneId: number | null; toZoneId: number | null }[];
      };
      const next = {
        ...snap,
        zones: snap.zones.filter((z) => !goneZones.has(z.id)),
        nodes: snap.nodes.filter((n) => !goneNodes.has(n.id)),
        edges: snap.edges.filter(
          (e) =>
            !goneNodes.has(e.fromNodeId as number) &&
            !goneNodes.has(e.toNodeId as number) &&
            !goneZones.has(e.fromZoneId as number) &&
            !goneZones.has(e.toZoneId as number),
        ),
      };
      const json = JSON.stringify(next);
      if (json !== p.snapshotJson) {
        db.prepare('UPDATE cyber_range_topology_publications SET snapshot_json = ? WHERE cyber_range_id = ?').run(json, p.cyberRangeId);
      }
    }

    const deactivateIfOrphaned = db.prepare(
      `UPDATE cyber_ranges SET is_active = 0
       WHERE id = ? AND NOT EXISTS (SELECT 1 FROM cyber_range_environments WHERE cyber_range_id = ?)`,
    );
    for (const { cyberRangeId } of linkedCyberRangeIds) {
      deactivateIfOrphaned.run(cyberRangeId, cyberRangeId);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // The audit trail (CONFIG, survives resets) keeps what was removed, since the rows themselves are gone.
  const { blockers: _blockers, ...removed } = impact;
  writeAudit(actorUsername, 'environment.deleted', 'cloud_environment', id, { name: existing.name, ...removed });
  return { status: 'deleted', impact };
}

export function linkEnvironmentToCyberRange(cyberRangeId: number, environmentId: number, actorUsername: string): boolean {
  const cyberRange = db.prepare('SELECT id FROM cyber_ranges WHERE id = ?').get(cyberRangeId);
  const environment = db.prepare('SELECT id FROM cloud_environments WHERE id = ?').get(environmentId);
  if (!cyberRange || !environment) return false;

  db.prepare('INSERT OR IGNORE INTO cyber_range_environments (cyber_range_id, environment_id) VALUES (?, ?)').run(cyberRangeId, environmentId);
  writeAudit(actorUsername, 'environment.linked', 'cyber_range_environment', null, { cyberRangeId, environmentId });
  return true;
}

export function unlinkEnvironmentFromCyberRange(cyberRangeId: number, environmentId: number, actorUsername: string): boolean {
  const result = db
    .prepare('DELETE FROM cyber_range_environments WHERE cyber_range_id = ? AND environment_id = ?')
    .run(cyberRangeId, environmentId);
  if (result.changes === 0) return false;
  writeAudit(actorUsername, 'environment.unlinked', 'cyber_range_environment', null, { cyberRangeId, environmentId });
  return true;
}

export interface LinkedCyberRange {
  cyberRangeId: number;
  name: string;
}

export function listLinkedCyberRanges(environmentId: number): LinkedCyberRange[] {
  return db
    .prepare(
      `SELECT cr.id AS cyberRangeId, cr.name AS name
       FROM cyber_range_environments cre JOIN cyber_ranges cr ON cr.id = cre.cyber_range_id
       WHERE cre.environment_id = ?`,
    )
    .all(environmentId) as unknown as LinkedCyberRange[];
}

export type ConnectivityResult =
  | { ok: true; latencyMs: number; resourceGroupId: string }
  | { ok: false; latencyMs: number; reason: 'not_configured' | 'auth' | 'not_found' | 'network' | 'unknown'; message: string };

export async function checkConnectivity(id: number, actorUsername: string): Promise<ConnectivityResult> {
  const start = Date.now();
  const credential = getResolvedCredential(id);

  if (!credential || !credential.externalScope) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      reason: 'not_configured',
      message: !credential ? 'environment credential is missing tenantId/clientId' : 'environment has no resource group configured',
    };
  }

  try {
    const azureCredential = new ClientSecretCredential(credential.tenantId, credential.clientId, credential.clientSecret);
    const client = new ResourceManagementClient(azureCredential, credential.externalAccountId);
    const rg = await client.resourceGroups.get(credential.externalScope);

    writeAudit(actorUsername, 'environment.connectivity_checked', 'cloud_environment', id, { ok: true });
    return { ok: true, latencyMs: Date.now() - start, resourceGroupId: rg.id ?? '' };
  } catch (err) {
    const { reason, message } = classifyAzureError(err);
    writeAudit(actorUsername, 'environment.connectivity_checked', 'cloud_environment', id, { ok: false, reason });
    return { ok: false, latencyMs: Date.now() - start, reason, message };
  }
}

// Shared with discovery.service.ts so both callers resolve a usable Azure credential the same way.
export function getResolvedCredential(environmentId: number): ResolvedCloudCredential | null {
  const row = db
    .prepare(
      `SELECT e.external_account_id AS externalAccountId, e.external_scope AS externalScope,
              e.credential_id AS credentialId, c.metadata_json AS credentialMetadataJson
       FROM cloud_environments e JOIN credentials c ON c.id = e.credential_id WHERE e.id = ?`,
    )
    .get(environmentId) as
    | { externalAccountId: string; externalScope: string | null; credentialId: number; credentialMetadataJson: string | null }
    | undefined;

  if (!row) return null;
  const meta = row.credentialMetadataJson ? JSON.parse(row.credentialMetadataJson) : {};
  if (!meta.tenantId || !meta.clientId) return null;

  return {
    tenantId: meta.tenantId,
    clientId: meta.clientId,
    clientSecret: readCredentialPlaintext(row.credentialId),
    externalAccountId: row.externalAccountId,
    externalScope: row.externalScope,
  };
}
