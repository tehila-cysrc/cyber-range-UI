import { ClientSecretCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import type { ResolvedCloudCredential } from './discovery/discoveryProvider.js';

// Phase 2 credential storage for VM login secrets — replaces the local AES-256-GCM `credentials`
// table for this one kind (`vm_login`) going forward. The platform's own Service Principal secret
// (`kind='service_principal'`) is NOT migrated here — it's the bootstrap credential needed to reach
// Azure/Key Vault in the first place, so it stays in the local encrypted store (see
// credential.service.ts). Requires the environment's SP to hold a Key Vault data-plane role
// (`Key Vault Secrets Officer`, scoped to the vault resource — never the whole subscription) in
// addition to the narrowly-scoped Bastion role (see bastionConnect.service.ts) — never Contributor,
// per CLAUDE/invariants.md.

// Secret names must be alphanumeric/hyphen only — this keeps the name deterministic and collision-free
// per topology node without leaking anything about the exercise into Key Vault's own audit/metadata.
export function vmLoginSecretName(topologyNodeId: number): string {
  return `vm-login-node-${topologyNodeId}`;
}

function client(credential: ResolvedCloudCredential, keyVaultUri: string): SecretClient {
  const azureCredential = new ClientSecretCredential(credential.tenantId, credential.clientId, credential.clientSecret);
  return new SecretClient(keyVaultUri, azureCredential);
}

export async function storeVmLoginSecret(
  credential: ResolvedCloudCredential,
  keyVaultUri: string,
  secretName: string,
  plaintextPassword: string,
): Promise<void> {
  const secrets = client(credential, keyVaultUri);
  try {
    await secrets.setSecret(secretName, plaintextPassword);
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode !== 409) throw err;
    // 409 = a secret with this (deterministic, per-node) name is soft-deleted — i.e. the node's access
    // target was removed earlier and is now being configured again. Soft-delete is mandatory on Key
    // Vault, so recover it (Secrets Officer allows Recover; purge may be blocked by purge protection)
    // and write the new password as a fresh version on top.
    await recoverDeletedSecret(secrets, secretName);
    await secrets.setSecret(secretName, plaintextPassword);
  }
}

// Recovery itself returns 409 while the delete is still in flight, so retry briefly until the secret
// lands in the recoverable state.
async function recoverDeletedSecret(secrets: SecretClient, secretName: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const poller = await secrets.beginRecoverDeletedSecret(secretName);
      await poller.pollUntilDone();
      return;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 409 || attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// The only function in this file that ever produces plaintext secret material — same rule as
// credential.service.ts#readCredentialPlaintext: use the result immediately, never log/store it.
export async function readVmLoginSecret(credential: ResolvedCloudCredential, keyVaultUri: string, secretName: string): Promise<string> {
  const secret = await client(credential, keyVaultUri).getSecret(secretName);
  if (!secret.value) throw new Error(`Key Vault secret '${secretName}' has no value`);
  return secret.value;
}

export async function deleteVmLoginSecret(credential: ResolvedCloudCredential, keyVaultUri: string, secretName: string): Promise<void> {
  const poller = await client(credential, keyVaultUri).beginDeleteSecret(secretName);
  await poller.pollUntilDone();
}
