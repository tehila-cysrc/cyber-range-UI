// Shared by environments.service.ts (connectivity check), discovery, and script execution.
// Maps an Azure SDK error to a small, safe enum + message. Never pass a raw SDK error object
// through to an API response or the DB: it can echo request URLs, headers, and credentials
// (see CLAUDE/invariants.md). Only an Azure error code and a sanitized message are copied out.

export type AzureErrorReason = 'auth' | 'not_found' | 'network' | 'unknown';

export interface ClassifiedAzureError {
  reason: AzureErrorReason;
  // Azure's error code (VMAgentStatusCommunicationError, AuthorizationFailed, …) when the body has one.
  code: string | null;
  // Sanitized text from the Azure error body, with URLs and tokens removed. Null when Azure sent none.
  detail: string | null;
  message: string;
}

// Outer ARM failures that wrap the specific reason in `details`. Prefer the inner code when present.
const WRAPPER_CODES = new Set(['Conflict', 'ResourceOperationFailure', 'InternalOperationError']);

const CODE_RE = /^[A-Za-z][A-Za-z0-9_.]{0,80}$/;

interface AzurePart {
  statusCode: number | null;
  code: string | null;
  message: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!CODE_RE.test(text)) return null;
  if (text === 'Error' || text === 'RestError' || text === 'TypeError') return null;
  return text;
}

// Drop URLs, tokens, and embedded request dumps. Azure messages sometimes append a management-plane
// URL or a JSON body that repeats the request id / resource path.
export function sanitizeAzureMessage(raw: string): string {
  let text = raw.replace(/\{[\s\S]*"error"[\s\S]*$/m, ' ');
  text = text.replace(/https?:\/\/\S+/gi, ' ');
  text = text.replace(/\bBearer\s+\S+/gi, ' ');
  text = text.replace(/\b(client_secret|password|sig)=[^\s&]+/gi, ' ');
  text = text.replace(/\/subscriptions\/[0-9a-f-]{36}\S*/gi, ' ');
  text = text.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if (text.length > 400) text = `${text.slice(0, 400)}…`;
  return text;
}

function usefulMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = sanitizeAzureMessage(value);
  if (!text) return null;
  if (/^unexpected status code: \d+$/i.test(text)) return null;
  if (text.includes(' at ') && text.includes('.js:')) return null;
  return text;
}

function pushPart(parts: AzurePart[], statusCode: number | null, node: unknown, depth: number): void {
  if (depth > 6) return;
  const obj = asRecord(node);
  if (!obj) return;

  if (obj.error) pushPart(parts, statusCode, obj.error, depth + 1);

  const code = readCode(obj.code) ?? readCode(obj.error);
  const message = usefulMessage(obj.message) ?? usefulMessage(obj.error_description);
  if (code || message) parts.push({ statusCode, code, message });

  if (Array.isArray(obj.details)) {
    for (const detail of obj.details) pushPart(parts, statusCode, detail, depth + 1);
  }
}

function collectParts(err: unknown, depth = 0): AzurePart[] {
  if (depth > 4) return [];
  const obj = asRecord(err);
  if (!obj) {
    const message = err instanceof Error ? usefulMessage(err.message) : usefulMessage(err);
    return [{ statusCode: null, code: null, message }];
  }

  const statusCode = typeof obj.statusCode === 'number' ? obj.statusCode : null;
  const parts: AzurePart[] = [];

  // Body fields only. `request` carries the URL and Authorization header and is intentionally skipped.
  pushPart(parts, statusCode, obj.details, 0);
  const response = asRecord(obj.response);
  if (response) {
    pushPart(parts, statusCode, response.parsedBody, 0);
    if (typeof response.bodyAsText === 'string' && response.bodyAsText.trim().startsWith('{')) {
      try {
        pushPart(parts, statusCode, JSON.parse(response.bodyAsText), 0);
      } catch {
        // not JSON — ignore
      }
    }
  }
  pushPart(parts, statusCode, obj.errorResponse, 0);

  // Prefer a code from the response body over the JS error name (RestError / AuthenticationError).
  const bodyHasCode = parts.some((part) => part.code);
  parts.push({
    statusCode,
    code: readCode(obj.code) ?? (bodyHasCode ? null : readCode(obj.name)),
    message: usefulMessage(obj.message),
  });

  if (obj.cause && obj.cause !== err) {
    for (const part of collectParts(obj.cause, depth + 1)) parts.push({ ...part, statusCode: part.statusCode ?? statusCode });
  }

  return parts;
}

function bestPart(parts: AzurePart[]): AzurePart {
  const specific = parts.filter((part) => part.code && !WRAPPER_CODES.has(part.code));
  const chosen = specific.at(-1) ?? parts.at(-1) ?? { statusCode: null, code: null, message: null };
  if (!chosen.message) {
    const withMessage = [...parts].reverse().find((part) => part.message);
    if (withMessage) return { ...chosen, message: withMessage.message, statusCode: chosen.statusCode ?? withMessage.statusCode };
  }
  return chosen;
}

function detailSuffix(part: AzurePart): string {
  if (part.code && part.message) return `${part.code}: ${part.message}`;
  if (part.code) return part.code;
  if (part.message) return part.message;
  if (part.statusCode) return `HTTP ${part.statusCode}`;
  return '';
}

export function classifyAzureError(err: unknown): ClassifiedAzureError {
  const part = bestPart(collectParts(err));
  const code = part.code;
  const name = readCode(asRecord(err)?.name);
  const authCode =
    code === 'AuthenticationRequiredError' ||
    code === 'CredentialUnavailableError' ||
    code === 'AuthenticationFailed' ||
    code === 'AuthorizationFailed' ||
    code === 'InvalidAuthenticationToken' ||
    name === 'AuthenticationError' ||
    name === 'CredentialUnavailableError' ||
    code === 'invalid_client' ||
    code === 'unauthorized_client' ||
    code === 'invalid_grant';

  if (part.statusCode === 401 || part.statusCode === 403 || authCode) {
    const suffix = detailSuffix(part);
    const base =
      part.statusCode === 403 || code === 'AuthorizationFailed'
        ? 'the registered credential is not allowed to perform this action'
        : 'authentication to the cloud provider failed — check the registered credential';
    return { reason: 'auth', code, detail: part.message, message: suffix && !base.includes(suffix) ? `${base} (${suffix})` : base };
  }

  if (part.statusCode === 404 || code === 'ResourceGroupNotFound' || code === 'ResourceNotFound' || code === 'ParentResourceNotFound') {
    const suffix = detailSuffix(part);
    const base =
      code === 'ResourceGroupNotFound'
        ? 'the configured resource group was not found (or is not visible to this credential)'
        : 'the Azure resource was not found (or is not visible to this credential)';
    return { reason: 'not_found', code, detail: part.message, message: suffix ? `${base} (${suffix})` : base };
  }

  if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') {
    return { reason: 'network', code, detail: part.message, message: 'could not reach the cloud provider (network/DNS/timeout)' };
  }

  const suffix = detailSuffix(part);
  return {
    reason: 'unknown',
    code,
    detail: part.message,
    message: suffix ? `Azure rejected the request (${suffix})` : 'operation failed for an unexpected reason',
  };
}
