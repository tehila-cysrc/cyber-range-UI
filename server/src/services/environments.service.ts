import { ClientSecretCredential } from '@azure/identity';
import { ResourceManagementClient } from '@azure/arm-resources';
import { db } from '../db/index.js';
import { deleteCredential, readCredentialPlaintext, rotateCredential, storeCredential } from './credential.service.js';
import { writeAudit } from './audit.service.js';
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
  const credentialId = storeCredential(
    'service_principal',
    input.clientSecret,
    { tenantId: input.tenantId, clientId: input.clientId },
    actorUsername,
  );

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
  writeAudit(actorUsername, 'environment.registered', 'cloud_environment', id, { name: input.name });

  return getEnvironment(id)!;
}

export function updateEnvironment(
  id: number,
  input: Partial<CloudEnvironmentInput>,
  actorUsername: string,
): CloudEnvironmentSummary | null {
  const existing = db.prepare('SELECT id, credential_id AS credentialId FROM cloud_environments WHERE id = ?').get(id) as
    | { id: number; credentialId: number }
    | undefined;
  if (!existing) return null;

  db.prepare(
    `UPDATE cloud_environments SET
       name = COALESCE(?, name),
       external_scope = COALESCE(?, external_scope),
       discovery_mode = COALESCE(?, discovery_mode),
       discovery_interval_minutes = COALESCE(?, discovery_interval_minutes)
     WHERE id = ?`,
  ).run(input.name ?? null, input.externalScope ?? null, input.discoveryMode ?? null, input.discoveryIntervalMinutes ?? null, id);

  if (input.clientSecret) {
    rotateCredential(existing.credentialId, input.clientSecret);
    writeAudit(actorUsername, 'environment.credential_rotated', 'cloud_environment', id, null);
  }

  writeAudit(actorUsername, 'environment.updated', 'cloud_environment', id, null);
  return getEnvironment(id);
}

export function deleteEnvironment(id: number, actorUsername: string): boolean {
  const existing = db.prepare('SELECT id, credential_id AS credentialId, name FROM cloud_environments WHERE id = ?').get(id) as
    | { id: number; credentialId: number; name: string }
    | undefined;
  if (!existing) return false;

  db.exec('BEGIN');
  try {
    // Delete order matters: topology rows discovered by this environment reference it (and, for
    // nodes, the discovery run that wrote them), so they must go before the run history, which must
    // go before the environment itself — otherwise this trips the same FK constraint that protects
    // the reset operation elsewhere in this schema.
    db.prepare('DELETE FROM topology_edges WHERE environment_id = ?').run(id);
    db.prepare('DELETE FROM topology_nodes WHERE environment_id = ?').run(id);
    db.prepare('DELETE FROM environment_discovery_runs WHERE environment_id = ?').run(id);
    db.prepare('DELETE FROM cyber_range_environments WHERE environment_id = ?').run(id);
    db.prepare('DELETE FROM cloud_environments WHERE id = ?').run(id);
    deleteCredential(existing.credentialId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  writeAudit(actorUsername, 'environment.deleted', 'cloud_environment', id, { name: existing.name });
  return true;
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
