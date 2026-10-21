// AI Investigation Assessment configuration (docs/ai-investigation-assessment-plan.md §D-C).
// Read from the environment on every call (cheap) so a restart-free env change in tests is honoured.
// The client secret is never returned from here — only whether it is present. It is read exclusively by
// foundryClient.ts when building the credential.

import { ACCEPTED_CONTRACT_VERSIONS } from './assessmentContract.js';

// The ONE Foundry agent the app calls, pinned in code (user decision 2026-10-21): the agent name, its
// version and the reply contract that version speaks. A Foundry agent version is immutable — its model,
// instructions, temperature and response schema are fixed when the version is created — so pinning the
// version pins all of them. Changing any of it = a reviewed code change + a controlled deploy; nothing
// in the environment or the admin UI can select another agent or version.
export const PINNED_AGENT = { name: 'cyber-range-assessor', version: '7', contractVersion: '3' } as const;

export interface AiConfig {
  enabled: boolean; // AI_ASSESSMENT_ENABLED switch AND fully configured
  switchOn: boolean; // AI_ASSESSMENT_ENABLED alone
  configured: boolean;
  missing: string[]; // names of missing/invalid settings — never their values
  projectEndpoint: string | null;
  agentName: string; // PINNED_AGENT — never from the environment
  agentVersion: string; // PINNED_AGENT — never Foundry's unpinned "latest"
  requestContractVersion: string; // PINNED_AGENT — the reply format that version speaks
  tenantId: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  requestTimeoutMs: number;
  maxConcurrent: number;
}

// Fail-closed: the feature is OFF unless explicitly switched on. Any unrecognised value is off.
function switchOn(): boolean {
  const raw = (process.env.AI_ASSESSMENT_ENABLED ?? '').trim().toLowerCase();
  return ['true', '1', 'on', 'yes'].includes(raw);
}

function intInRange(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// A Foundry project endpoint: https://<resource>.services.ai.azure.com/api/projects/<project>
const ENDPOINT_RE = /^https:\/\/[a-z0-9-]+\.services\.ai\.azure\.com\/api\/projects\/[A-Za-z0-9._-]+$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getAiConfig(): AiConfig {
  const env = process.env;
  const endpoint = (env.FOUNDRY_PROJECT_ENDPOINT ?? '').trim().replace(/\/+$/, '') || null;
  const tenantId = (env.AZURE_TENANT_ID ?? '').trim() || null;
  const clientId = (env.AZURE_CLIENT_ID ?? '').trim() || null;
  const hasClientSecret = !!(env.AZURE_CLIENT_SECRET ?? '').trim();

  const missing: string[] = [];
  if (!endpoint || !ENDPOINT_RE.test(endpoint)) missing.push('FOUNDRY_PROJECT_ENDPOINT');
  if (!tenantId || !GUID_RE.test(tenantId)) missing.push('AZURE_TENANT_ID');
  if (!clientId || !GUID_RE.test(clientId)) missing.push('AZURE_CLIENT_ID');
  if (!hasClientSecret) missing.push('AZURE_CLIENT_SECRET');
  // Guards a bad PINNED_AGENT edit: a contract the app cannot parse keeps AI off.
  if (!(ACCEPTED_CONTRACT_VERSIONS as readonly string[]).includes(PINNED_AGENT.contractVersion)) missing.push('PINNED_AGENT.contractVersion');

  const configured = missing.length === 0;
  const on = switchOn();
  return {
    enabled: on && configured,
    switchOn: on,
    configured,
    missing,
    projectEndpoint: endpoint,
    agentName: PINNED_AGENT.name,
    agentVersion: PINNED_AGENT.version,
    requestContractVersion: PINNED_AGENT.contractVersion,
    tenantId,
    clientId,
    hasClientSecret,
    requestTimeoutMs: intInRange(env.AI_REQUEST_TIMEOUT_MS, 120_000, 10_000, 600_000),
    maxConcurrent: intInRange(env.AI_MAX_CONCURRENT, 3, 1, 10),
  };
}

export function isAiEnabled(): boolean {
  return getAiConfig().enabled;
}

// What staff UI may see (GET /admin/ai/status): whether AI is usable — nothing about the agent.
export function aiStatusSummary(): { enabled: boolean; configured: boolean } {
  const c = getAiConfig();
  return { enabled: c.enabled, configured: c.configured };
}

// One line at startup for whoever deploys: the switch and the NAMES of missing settings (never values).
// The admin UI shows only a plain readiness status.
export function logAiConfigAtStartup(): void {
  const c = getAiConfig();
  if (!c.switchOn) console.log('[ai] AI assessment is off (AI_ASSESSMENT_ENABLED not set to true)');
  else if (!c.configured) console.warn(`[ai] AI_ASSESSMENT_ENABLED is on but AI stays off — missing or invalid: ${c.missing.join(', ')}`);
  else console.log(`[ai] AI assessment on — agent ${c.agentName} v${c.agentVersion} (contract ${c.requestContractVersion}, pinned in code)`);
}
