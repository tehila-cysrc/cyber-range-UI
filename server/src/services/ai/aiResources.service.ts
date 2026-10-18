// Admin "AI resources" screen (platform phase P1, 2026-10-18): the configuration summary and a read-only
// view of what exists in the Foundry project, matched against the app's own registry
// (ai_foundry_resources). Nothing here creates, changes or deletes anything — deletion stays the explicit,
// re-checked executeCleanup() in scenarioAiDocuments.service.ts, which only accepts registry ids, so an
// untracked resource (test resources created by scripts, other people's stores) can never be deleted
// from the app.
import { ACCEPTED_CONTRACT_VERSIONS } from './assessmentContract.js';
import { getAiConfig } from './aiConfig.js';
import { FoundryError, getFoundryClient } from './foundryClient.js';
import { listFoundryResources, type FoundryResourceDTO } from './scenarioAiDocuments.service.js';

export interface AiConfigView {
  switchOn: boolean;
  configured: boolean;
  enabled: boolean;
  missing: string[]; // setting NAMES only
  agentName: string | null;
  agentVersion: string | null;
  requestTimeoutMs: number;
  maxConcurrent: number;
  acceptedContractVersions: string[];
}

// Admin-only: no endpoint, tenant/client ids or secret material.
export function aiConfigView(): AiConfigView {
  const c = getAiConfig();
  return {
    switchOn: c.switchOn,
    configured: c.configured,
    enabled: c.enabled,
    missing: c.missing,
    agentName: c.agentName,
    agentVersion: c.agentVersion,
    requestTimeoutMs: c.requestTimeoutMs,
    maxConcurrent: c.maxConcurrent,
    acceptedContractVersions: [...ACCEPTED_CONTRACT_VERSIONS],
  };
}

type Tracked = Pick<FoundryResourceDTO, 'id' | 'scenarioName' | 'documentVersion' | 'inUse' | 'cleanupReason'> & { deleted: boolean };

export interface InventoryView {
  fetchedAt: string;
  agentName: string | null;
  pinnedVersion: string | null;
  vectorStores: { id: string; name: string | null; status: string | null; createdAt: string | null; usageBytes: number | null; fileCount: number | null; tracked: Tracked | null }[];
  files: { id: string; filename: string | null; bytes: number | null; purpose: string | null; createdAt: string | null; tracked: Tracked | null }[];
  agentVersions: { version: string; description: string | null; createdAt: string | null; pinned: boolean }[];
  truncated: { vectorStores: boolean; files: boolean; agentVersions: boolean };
  // Registry rows (not deleted) that Foundry did not list — already gone, or beyond the first page.
  missingFromFoundry: { id: number; kind: string; foundryId: string }[];
}

export type InventoryResult = { ok: true; value: InventoryView } | { ok: false; status: number; error: string; reason: string };

export async function foundryInventory(): Promise<InventoryResult> {
  const config = getAiConfig();
  if (!config.configured) return { ok: false, status: 503, error: 'AI assessment is not configured on this server', reason: 'ai_not_configured' };
  let inv;
  try {
    inv = await getFoundryClient().listInventory();
  } catch (e) {
    const code = e instanceof FoundryError ? e.code : 'ai_unavailable';
    return { ok: false, status: 502, error: 'Microsoft Foundry could not be listed', reason: code };
  }
  const registry = listFoundryResources('all');
  const byFoundryId = new Map(registry.map((r) => [r.foundryId, r]));
  const tracked = (id: string): Tracked | null => {
    const r = byFoundryId.get(id);
    return r ? { id: r.id, scenarioName: r.scenarioName, documentVersion: r.documentVersion, inUse: r.inUse, cleanupReason: r.cleanupReason, deleted: r.deletedAt !== null } : null;
  };
  const listed = new Set([...inv.vectorStores.map((v) => v.id), ...inv.files.map((f) => f.id)]);
  return {
    ok: true,
    value: {
      fetchedAt: new Date().toISOString(),
      agentName: config.agentName,
      pinnedVersion: config.agentVersion,
      vectorStores: inv.vectorStores.map((v) => ({ ...v, tracked: tracked(v.id) })),
      files: inv.files.map((f) => ({ ...f, tracked: tracked(f.id) })),
      agentVersions: inv.agentVersions.map((a) => ({ ...a, pinned: a.version === config.agentVersion })),
      truncated: inv.truncated,
      missingFromFoundry: registry.filter((r) => r.deletedAt === null && !listed.has(r.foundryId)).map((r) => ({ id: r.id, kind: r.kind, foundryId: r.foundryId })),
    },
  };
}
