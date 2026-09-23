import { ClientSecretCredential } from '@azure/identity';
import type { ResolvedCloudCredential } from '../discovery/discoveryProvider.js';

// Azure Bastion Shareable Links — replaces the guacamole-lite token stub (see guacamoleToken.service.ts,
// now unused) as the real Connect mechanism. Verified against a live Bastion host during the Phase 2
// PoC (2026-09-10): the operation isn't exposed by the stable @azure/arm-network SDK or the `az` CLI as
// of this writing, so this goes through raw ARM REST calls directly.
const ARM_BASE = 'https://management.azure.com';
const API_VERSION = '2023-09-01';
const ARM_SCOPE = 'https://management.azure.com/.default';

export interface ShareableLink {
  url: string;
  vmId: string;
}

async function getArmToken(credential: ResolvedCloudCredential): Promise<string> {
  const azureCredential = new ClientSecretCredential(credential.tenantId, credential.clientId, credential.clientSecret);
  const token = await azureCredential.getToken(ARM_SCOPE);
  if (!token) throw new Error('failed to acquire an Azure ARM access token');
  return token.token;
}

// Every shareable-link create/delete puts the whole Bastion host into an "Updating" provisioning state
// for a while (well over a minute after a burst of operations — observed live 2026-09-23). While it's
// busy, Bastion rejects ALL link calls, reads included: 409 AnotherOperationInProgress, or 400
// OperationNotAllowedWhenResourceInUpgradingState. That's "wait until idle, then retry", not a failure:
// each call first waits for provisioningState=Succeeded, and re-waits on a busy answer, within a
// bounded budget (BUSY_BUDGET_MS) so a truly stuck host still surfaces as an error.
const BUSY_CODES = ['AnotherOperationInProgress', 'OperationNotAllowedWhenResourceInUpgradingState'];
const BUSY_BUDGET_MS = 3 * 60_000;
const BUSY_POLL_MS = 5000;

// The Bastion host resource id is the prefix of every link-operation path.
function bastionIdFromPath(path: string): string {
  return path.split('/').slice(0, 9).join('/');
}

// Read-only ARM GET of the Bastion host (covered by the app SP's Reader role).
async function bastionProvisioningState(token: string, bastionHostId: string): Promise<string | null> {
  const res = await fetch(`${ARM_BASE}${bastionHostId}?api-version=${API_VERSION}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { properties?: { provisioningState?: string } } | null;
  return data?.properties?.provisioningState ?? null;
}

async function waitUntilIdle(token: string, bastionHostId: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const state = await bastionProvisioningState(token, bastionHostId);
    // null = couldn't read it (e.g. no permission on a custom-role SP) — fall back to just trying.
    if (state === null || state === 'Succeeded' || state === 'Failed') return;
    await sleep(BUSY_POLL_MS);
  }
}

async function armFetch(credential: ResolvedCloudCredential, path: string, body: string, busyBudgetMs = BUSY_BUDGET_MS): Promise<Response> {
  const token = await getArmToken(credential);
  const bastionHostId = bastionIdFromPath(path);
  const deadline = Date.now() + busyBudgetMs;
  await waitUntilIdle(token, bastionHostId, deadline);
  for (;;) {
    const res = await fetch(`${ARM_BASE}${path}`, {
      method: 'POST',
      body,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if ((res.status !== 409 && res.status !== 400) || Date.now() >= deadline) return res;
    const text = await safeText(res.clone());
    if (!BUSY_CODES.some((c) => text.includes(c))) return res;
    await sleep(BUSY_POLL_MS);
    await waitUntilIdle(token, bastionHostId, deadline);
  }
}

// Bastion answers "this VM has no shareable link" with 400 + this (misspelled, verbatim) error code
// rather than an empty list — observed live 2026-09-23. Treated as "none", never as a failure.
const LINKS_NOT_FOUND_CODE = 'BastionShareabeLinksNotFound';

async function isLinksNotFound(res: Response): Promise<boolean> {
  if (res.status !== 400) return false;
  const text = await safeText(res);
  return text.includes(LINKS_NOT_FOUND_CODE);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// createShareableLinks is async (202 Accepted, no guaranteed-ready body) — this polls
// getShareableLinks until the link shows up, rather than trusting a fixed delay. Bastion's own docs
// give a `Retry-After: 10` hint; ~3s then ~2s steps up to 8 attempts comfortably covers that in
// practice (observed ~12-15s during the PoC) without a long worst-case wait on failure.
export async function createShareableLink(credential: ResolvedCloudCredential, bastionHostId: string, vmResourceId: string): Promise<ShareableLink> {
  const body = JSON.stringify({ vms: [{ vm: { id: vmResourceId } }] });

  const createRes = await armFetch(credential, `${bastionHostId}/createShareableLinks?api-version=${API_VERSION}`, body);
  if (!createRes.ok && createRes.status !== 202) {
    throw new Error(`Bastion createShareableLinks failed: ${createRes.status} ${await safeText(createRes)}`);
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(attempt === 0 ? 3000 : 2000);
    const getRes = await armFetch(credential, `${bastionHostId}/getShareableLinks?api-version=${API_VERSION}`, body);
    if (getRes.ok) {
      const data = (await getRes.json()) as { value?: Array<{ bsl: string; vm: { id: string } }> };
      const link = data.value?.[0];
      if (link) return { url: link.bsl, vmId: link.vm.id };
    }
  }
  throw new Error('Bastion shareable link was not ready in time');
}

// Read-only: the live shareable links Bastion currently holds for the given VMs (Bastion keeps at most
// one per VM). Used to restore a student's still-authorized session after a page refresh without ever
// persisting the link URL, and to confirm a revoke actually took effect.
// `busyBudgetMs`: how long to wait out a busy (Updating) host — the event-reset job passes a much longer
// budget than an interactive Connect, since Bastion can stay busy for many minutes after a burst.
export async function listShareableLinks(
  credential: ResolvedCloudCredential,
  bastionHostId: string,
  vmResourceIds: string[],
  busyBudgetMs?: number,
): Promise<ShareableLink[]> {
  if (vmResourceIds.length === 0) return [];
  const body = JSON.stringify({ vms: vmResourceIds.map((id) => ({ vm: { id } })) });
  const res = await armFetch(credential, `${bastionHostId}/getShareableLinks?api-version=${API_VERSION}`, body, busyBudgetMs);
  if (!res.ok) {
    if (await isLinksNotFound(res.clone())) return [];
    throw new Error(`Bastion getShareableLinks failed: ${res.status} ${await safeText(res)}`);
  }
  // A batched request answers 206 with an entry for EVERY requested VM; only VMs that really have a link
  // carry `bsl` (observed live 2026-09-23). Entries without one are not links.
  const data = (await res.json()) as { value?: Array<{ bsl?: string; vm: { id: string } }> };
  return (data.value ?? []).filter((l) => !!l.bsl).map((l) => ({ url: l.bsl!, vmId: l.vm.id }));
}

// Revokes the links for many VMs in one ARM call (the API takes a list). Same tolerance as the single
// delete: a VM with no link is a no-op, not an error.
export async function deleteShareableLinks(
  credential: ResolvedCloudCredential,
  bastionHostId: string,
  vmResourceIds: string[],
  busyBudgetMs?: number,
): Promise<void> {
  if (vmResourceIds.length === 0) return;
  const body = JSON.stringify({ vms: vmResourceIds.map((id) => ({ vm: { id } })) });
  const res = await armFetch(credential, `${bastionHostId}/deleteShareableLinks?api-version=${API_VERSION}`, body, busyBudgetMs);
  if (!res.ok && res.status !== 202 && res.status !== 404 && !(await isLinksNotFound(res.clone()))) {
    throw new Error(`Bastion deleteShareableLinks failed: ${res.status} ${await safeText(res)}`);
  }
}

export async function deleteShareableLink(credential: ResolvedCloudCredential, bastionHostId: string, vmResourceId: string): Promise<void> {
  const body = JSON.stringify({ vms: [{ vm: { id: vmResourceId } }] });
  const res = await armFetch(credential, `${bastionHostId}/deleteShareableLinks?api-version=${API_VERSION}`, body);
  if (!res.ok && res.status !== 202 && res.status !== 404 && !(await isLinksNotFound(res.clone()))) {
    throw new Error(`Bastion deleteShareableLinks failed: ${res.status} ${await safeText(res)}`);
  }
}
