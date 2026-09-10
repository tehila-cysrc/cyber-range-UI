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

async function armFetch(credential: ResolvedCloudCredential, path: string, body: string): Promise<Response> {
  const token = await getArmToken(credential);
  return fetch(`${ARM_BASE}${path}`, {
    method: 'POST',
    body,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
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

export async function deleteShareableLink(credential: ResolvedCloudCredential, bastionHostId: string, vmResourceId: string): Promise<void> {
  const body = JSON.stringify({ vms: [{ vm: { id: vmResourceId } }] });
  const res = await armFetch(credential, `${bastionHostId}/deleteShareableLinks?api-version=${API_VERSION}`, body);
  if (!res.ok && res.status !== 202 && res.status !== 404) {
    throw new Error(`Bastion deleteShareableLinks failed: ${res.status} ${await safeText(res)}`);
  }
}
