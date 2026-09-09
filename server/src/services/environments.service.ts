import { ClientSecretCredential } from '@azure/identity';
import { ResourceManagementClient } from '@azure/arm-resources';
import { db } from '../db/index.js';
import { deleteCredential, readCredentialPlaintext, rotateCredential, storeCredential } from './credential.service.js';
import { writeAudit } from './audit.service.js';

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

export type ConnectivityResult =
  | { ok: true; latencyMs: number; resourceGroupId: string }
  | { ok: false; latencyMs: number; reason: 'not_configured' | 'auth' | 'not_found' | 'network' | 'unknown'; message: string };

export async function checkConnectivity(id: number, actorUsername: string): Promise<ConnectivityResult> {
  const start = Date.now();
  const row = db
    .prepare(
      `SELECT e.external_account_id AS externalAccountId, e.external_scope AS externalScope,
              e.credential_id AS credentialId, c.metadata_json AS credentialMetadataJson
       FROM cloud_environments e JOIN credentials c ON c.id = e.credential_id WHERE e.id = ?`,
    )
    .get(id) as
    | { externalAccountId: string; externalScope: string | null; credentialId: number; credentialMetadataJson: string | null }
    | undefined;

  if (!row || !row.externalScope) {
    return { ok: false, latencyMs: Date.now() - start, reason: 'not_configured', message: 'environment has no resource group configured' };
  }

  const meta = row.credentialMetadataJson ? JSON.parse(row.credentialMetadataJson) : {};
  if (!meta.tenantId || !meta.clientId) {
    return { ok: false, latencyMs: Date.now() - start, reason: 'not_configured', message: 'environment credential is missing tenantId/clientId' };
  }

  try {
    const clientSecret = readCredentialPlaintext(row.credentialId);
    const credential = new ClientSecretCredential(meta.tenantId, meta.clientId, clientSecret);
    const client = new ResourceManagementClient(credential, row.externalAccountId);
    const rg = await client.resourceGroups.get(row.externalScope);

    writeAudit(actorUsername, 'environment.connectivity_checked', 'cloud_environment', id, { ok: true });
    return { ok: true, latencyMs: Date.now() - start, resourceGroupId: rg.id ?? '' };
  } catch (err) {
    const { reason, message } = classifyAzureError(err);
    writeAudit(actorUsername, 'environment.connectivity_checked', 'cloud_environment', id, { ok: false, reason });
    return { ok: false, latencyMs: Date.now() - start, reason, message };
  }
}

function classifyAzureError(err: unknown): { reason: 'auth' | 'not_found' | 'network' | 'unknown'; message: string } {
  const statusCode = (err as { statusCode?: number })?.statusCode;
  const code = (err as { code?: string; name?: string })?.code ?? (err as { name?: string })?.name;

  if (statusCode === 401 || statusCode === 403 || code === 'AuthenticationRequiredError' || code === 'CredentialUnavailableError') {
    return { reason: 'auth', message: 'authentication to the cloud provider failed — check the registered credential' };
  }
  if (statusCode === 404 || code === 'ResourceGroupNotFound') {
    return { reason: 'not_found', message: 'the configured resource group was not found (or is not visible to this credential)' };
  }
  if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') {
    return { reason: 'network', message: 'could not reach the cloud provider (network/DNS/timeout)' };
  }
  return { reason: 'unknown', message: 'connectivity check failed for an unexpected reason' };
}
