// AI Investigation Assessment configuration (docs/ai-investigation-assessment-plan.md §D-C).
// Read from the environment on every call (cheap) so a restart-free env change in tests is honoured.
// The client secret is never returned from here — only whether it is present. It is read exclusively by
// foundryClient.ts when building the credential.

export interface AiConfig {
  enabled: boolean; // AI_ASSESSMENT_ENABLED switch AND fully configured
  switchOn: boolean; // AI_ASSESSMENT_ENABLED alone
  configured: boolean;
  missing: string[]; // names of missing/invalid settings — never their values
  projectEndpoint: string | null;
  agentName: string | null;
  agentVersion: string | null; // REQUIRED: the pinned agent version (never Foundry's unpinned "latest")
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
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

export function getAiConfig(): AiConfig {
  const env = process.env;
  const endpoint = (env.FOUNDRY_PROJECT_ENDPOINT ?? '').trim().replace(/\/+$/, '') || null;
  const agentName = (env.FOUNDRY_AGENT_NAME ?? '').trim() || null;
  const agentVersion = (env.FOUNDRY_AGENT_VERSION ?? '').trim() || null;
  const tenantId = (env.AZURE_TENANT_ID ?? '').trim() || null;
  const clientId = (env.AZURE_CLIENT_ID ?? '').trim() || null;
  const hasClientSecret = !!(env.AZURE_CLIENT_SECRET ?? '').trim();

  const missing: string[] = [];
  if (!endpoint || !ENDPOINT_RE.test(endpoint)) missing.push('FOUNDRY_PROJECT_ENDPOINT');
  if (!agentName || !AGENT_NAME_RE.test(agentName)) missing.push('FOUNDRY_AGENT_NAME');
  // Pinned on purpose (user decision 2026-10-18): an unset version would route to whatever version is
  // "latest" in Foundry, so a new, unreviewed agent version could go live by accident. Unset = not configured.
  if (!agentVersion || !/^\d{1,6}$/.test(agentVersion)) missing.push('FOUNDRY_AGENT_VERSION');
  if (!tenantId || !GUID_RE.test(tenantId)) missing.push('AZURE_TENANT_ID');
  if (!clientId || !GUID_RE.test(clientId)) missing.push('AZURE_CLIENT_ID');
  if (!hasClientSecret) missing.push('AZURE_CLIENT_SECRET');

  const configured = missing.length === 0;
  const on = switchOn();
  return {
    enabled: on && configured,
    switchOn: on,
    configured,
    missing,
    projectEndpoint: endpoint,
    agentName,
    agentVersion,
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

// What staff UI may see (GET /admin/ai/status, Phase 2+): no endpoint, ids or secret material.
export function aiStatusSummary(): { enabled: boolean; configured: boolean; agentName: string | null } {
  const c = getAiConfig();
  return { enabled: c.enabled, configured: c.configured, agentName: c.agentName };
}
