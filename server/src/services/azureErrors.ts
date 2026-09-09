// Shared by environments.service.ts (connectivity check) and discovery/discovery.service.ts —
// maps an Azure SDK error to a small, safe enum + message. Never pass a raw SDK error object
// through to an API response or the DB: it can echo request details (see CLAUDE/invariants.md).
export type AzureErrorReason = 'auth' | 'not_found' | 'network' | 'unknown';

export function classifyAzureError(err: unknown): { reason: AzureErrorReason; message: string } {
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
  return { reason: 'unknown', message: 'operation failed for an unexpected reason' };
}
