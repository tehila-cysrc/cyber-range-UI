// Microsoft Foundry client for the AI Investigation Assessment (docs/ai-investigation-assessment-plan.md §E).
//
// Raw REST + @azure/identity — the exact wire format verified live in Phase 0
// (docs/ai-assessment-foundry-poc.md); no Foundry SDK dependency. Every invocation:
//   - names the ONE configured agent (agent_reference) — assessment instructions and the output schema
//     live on the agent in Foundry; this file never sends `instructions` or `text` (a per-request
//     `text.format` is rejected for agents);
//   - selects the scenario document version's vector store via structured_inputs.vector_store_id
//     (the agent declares it required, so a missing id is refused by the service too);
//   - forces retrieval with tool_choice:'required' (without it the agent skipped File Search in Phase 0);
//   - sends store:false (nothing kept server-side in Foundry).
//
// Safety: never logs or returns request/response bodies, tokens, the client secret or raw SDK errors —
// failures become a FoundryError with a small code enum and a fixed message.
import { ClientSecretCredential } from '@azure/identity';
import { getAiConfig, type AiConfig } from './aiConfig.js';

export type FoundryErrorCode =
  | 'ai_not_configured'
  | 'ai_auth_failed'
  | 'ai_timeout'
  | 'ai_rate_limited'
  | 'ai_unavailable'
  | 'ai_bad_request'
  | 'ai_not_found'
  | 'ai_content_filtered';

const MESSAGES: Record<FoundryErrorCode, string> = {
  ai_not_configured: 'AI assessment is not configured on this server',
  ai_auth_failed: 'the server could not authenticate to Microsoft Foundry',
  ai_timeout: 'Microsoft Foundry did not answer in time',
  ai_rate_limited: 'Microsoft Foundry is rate limiting requests',
  ai_unavailable: 'Microsoft Foundry is temporarily unavailable',
  ai_bad_request: 'Microsoft Foundry rejected the request',
  ai_not_found: 'the Foundry resource was not found',
  ai_content_filtered: 'Azure content safety blocked this request',
};

export class FoundryError extends Error {
  readonly code: FoundryErrorCode;
  readonly httpStatus: number | null;
  readonly requestId: string | null;
  readonly filterCategories: string[]; // e.g. ['jailbreak'] — category names only, never content
  constructor(code: FoundryErrorCode, opts: { httpStatus?: number | null; requestId?: string | null; filterCategories?: string[] } = {}) {
    super(MESSAGES[code]);
    this.name = 'FoundryError';
    this.code = code;
    this.httpStatus = opts.httpStatus ?? null;
    this.requestId = opts.requestId ?? null;
    this.filterCategories = opts.filterCategories ?? [];
  }
}

export interface InvokeAssessmentInput {
  vectorStoreId: string;
  input: string; // the JSON request message built by the app (§I.2)
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface InvokeAssessmentResult {
  outputText: string;
  responseId: string | null;
  responseStatus: string | null; // 'completed' | 'incomplete' | …
  incompleteReason: string | null;
  model: string | null;
  agentName: string | null;
  agentVersion: string | null; // reported by Foundry (agent_reference.version) — recorded per assessment
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number } | null;
  fileSearchCalls: number; // 0 = the agent did not retrieve; the validator rejects that (ai_no_retrieval)
}

export interface VectorStoreState {
  ok: boolean;
  storeStatus: string | null;
  fileStatus: string | null;
  errorCode: string | null; // Foundry's last_error.code for the file, if any
  usageBytes: number | null;
}

export interface FoundryClient {
  uploadFile(input: { bytes: Uint8Array; filename: string; mimeType: string }): Promise<{ fileId: string }>;
  createVectorStore(input: { name: string; fileIds: string[] }): Promise<{ vectorStoreId: string }>;
  waitForVectorStore(vectorStoreId: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<VectorStoreState>;
  deleteVectorStore(vectorStoreId: string): Promise<void>; // 404 = already gone = success
  deleteFile(fileId: string): Promise<void>; // 404 = already gone = success
  invokeAssessment(input: InvokeAssessmentInput): Promise<InvokeAssessmentResult>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RestFoundryClientDeps {
  config: AiConfig;
  fetchImpl?: FetchLike;
  getToken?: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const VECTOR_STORE_ID_RE = /^vs_[A-Za-z0-9]+$/;
const FILE_ID_RE = /^[A-Za-z0-9_-]+$/;
const NON_INVOKE_TIMEOUT_MS = 60_000;
const MAX_RETRY_DELAY_MS = 20_000;

// ---------------------------------------------------------------------------------------------
// Pure helpers (exported for tests)

export function extractOutputText(body: unknown): string {
  const b = body as { output_text?: unknown; output?: { content?: { text?: unknown }[] }[] } | null;
  if (typeof b?.output_text === 'string') return b.output_text;
  const parts: string[] = [];
  for (const item of b?.output ?? []) for (const c of item.content ?? []) if (typeof c.text === 'string') parts.push(c.text);
  return parts.join('');
}

export function countFileSearchCalls(body: unknown): number {
  const out = (body as { output?: { type?: unknown }[] } | null)?.output;
  return Array.isArray(out) ? out.filter((o) => o?.type === 'file_search_call').length : 0;
}

function contentFilterCategories(body: unknown): string[] {
  const filters = (body as { error?: { content_filters?: unknown }; content_filters?: unknown } | null);
  const list = (filters?.error?.content_filters ?? filters?.content_filters) as { content_filter_results?: Record<string, { filtered?: boolean }> }[] | undefined;
  const names = new Set<string>();
  for (const f of Array.isArray(list) ? list : []) {
    for (const [name, r] of Object.entries(f.content_filter_results ?? {})) if (r?.filtered) names.add(name);
  }
  return [...names].sort();
}

export function classifyFoundryResponse(status: number, body: unknown, headers?: Headers): FoundryError {
  const err = (body as { error?: { code?: unknown; additionalInfo?: { request_id?: unknown } } } | null)?.error;
  const requestId =
    (typeof err?.additionalInfo?.request_id === 'string' ? err.additionalInfo.request_id : null) ??
    headers?.get('x-request-id') ??
    headers?.get('apim-request-id') ??
    null;
  if (err?.code === 'content_filter') {
    return new FoundryError('ai_content_filtered', { httpStatus: status, requestId, filterCategories: contentFilterCategories(body) });
  }
  const code: FoundryErrorCode =
    status === 401 || status === 403 ? 'ai_auth_failed'
    : status === 404 ? 'ai_not_found'
    : status === 408 ? 'ai_timeout'
    : status === 429 ? 'ai_rate_limited'
    : status >= 500 ? 'ai_unavailable'
    : 'ai_bad_request';
  return new FoundryError(code, { httpStatus: status, requestId });
}

function retryDelayMs(attempt: number, headers: Headers | null): number {
  const ms = Number(headers?.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_RETRY_DELAY_MS);
  const s = Number(headers?.get('retry-after'));
  if (Number.isFinite(s) && s > 0) return Math.min(s * 1000, MAX_RETRY_DELAY_MS);
  return Math.min(1000 * 2 ** attempt + Math.floor(Math.random() * 250), MAX_RETRY_DELAY_MS);
}

// ---------------------------------------------------------------------------------------------

export function createRestFoundryClient(deps: RestFoundryClientDeps): FoundryClient {
  const { config } = deps;
  if (!config.configured || !config.projectEndpoint || !config.agentName) throw new FoundryError('ai_not_configured');
  const endpoint = config.projectEndpoint;
  const agentName = config.agentName;
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = deps.maxRetries ?? 2;

  let getToken = deps.getToken;
  if (!getToken) {
    // The ONLY place the client secret is read. Used immediately to build the credential; never stored
    // elsewhere, logged or returned.
    const credential = new ClientSecretCredential(config.tenantId!, config.clientId!, process.env.AZURE_CLIENT_SECRET!);
    getToken = async () => {
      const t = await credential.getToken('https://ai.azure.com/.default');
      if (!t?.token) throw new Error('no token');
      return t.token;
    };
  }
  const tokenFn = getToken;

  // One HTTP exchange with retries. `retryServerErrors` is false for non-idempotent creates: only a 429
  // (definitely not processed) is retried there, so an ambiguous 5xx never uploads a file twice.
  async function send(
    method: string,
    path: string,
    opts: { json?: unknown; form?: FormData; timeoutMs?: number; signal?: AbortSignal; retryServerErrors: boolean },
  ): Promise<{ status: number; body: unknown }> {
    for (let attempt = 0; ; attempt++) {
      let token: string;
      try {
        token = await tokenFn();
      } catch {
        throw new FoundryError('ai_auth_failed');
      }
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? NON_INVOKE_TIMEOUT_MS);
      const init: RequestInit = {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.form,
        signal: opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout,
      };
      let res: Response;
      try {
        res = await fetchImpl(`${endpoint}${path}`, init);
      } catch (e) {
        if (opts.signal?.aborted) throw new FoundryError('ai_timeout');
        const isTimeout = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
        if (opts.retryServerErrors && attempt < maxRetries) {
          await sleep(retryDelayMs(attempt, null));
          continue;
        }
        throw new FoundryError(isTimeout ? 'ai_timeout' : 'ai_unavailable');
      }
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null; // non-JSON bodies are never surfaced
      }
      if (res.ok) return { status: res.status, body };
      const error = classifyFoundryResponse(res.status, body, res.headers);
      const retryable = error.code === 'ai_rate_limited' || (opts.retryServerErrors && (error.code === 'ai_unavailable' || error.code === 'ai_timeout'));
      if (retryable && attempt < maxRetries) {
        await sleep(retryDelayMs(attempt, res.headers));
        continue;
      }
      throw error;
    }
  }

  const ignoreNotFound = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (!(e instanceof FoundryError && e.code === 'ai_not_found')) throw e;
    }
  };

  return {
    async uploadFile({ bytes, filename, mimeType }) {
      const form = new FormData();
      form.append('purpose', 'assistants');
      form.append('file', new Blob([bytes], { type: mimeType }), filename);
      const r = await send('POST', '/openai/v1/files', { form, retryServerErrors: false });
      const id = (r.body as { id?: unknown })?.id;
      if (typeof id !== 'string' || !FILE_ID_RE.test(id)) throw new FoundryError('ai_bad_request', { httpStatus: r.status });
      return { fileId: id };
    },

    async createVectorStore({ name, fileIds }) {
      const r = await send('POST', '/openai/v1/vector_stores', { json: { name, file_ids: fileIds }, retryServerErrors: false });
      const id = (r.body as { id?: unknown })?.id;
      if (typeof id !== 'string' || !VECTOR_STORE_ID_RE.test(id)) throw new FoundryError('ai_bad_request', { httpStatus: r.status });
      return { vectorStoreId: id };
    },

    async waitForVectorStore(vectorStoreId, opts = {}) {
      if (!VECTOR_STORE_ID_RE.test(vectorStoreId)) throw new FoundryError('ai_bad_request');
      const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
      for (;;) {
        const r = await send('GET', `/openai/v1/vector_stores/${vectorStoreId}`, { retryServerErrors: true });
        const s = r.body as { status?: string; usage_bytes?: number; file_counts?: { completed?: number; failed?: number; in_progress?: number } } | null;
        const counts = s?.file_counts ?? {};
        const settled = s?.status === 'completed' || s?.status === 'expired' || (counts.in_progress === 0 && (counts.completed ?? 0) + (counts.failed ?? 0) > 0);
        if (settled) {
          const files = await send('GET', `/openai/v1/vector_stores/${vectorStoreId}/files`, { retryServerErrors: true });
          const f = (files.body as { data?: { status?: string; last_error?: { code?: string } | null }[] } | null)?.data?.[0];
          const fileStatus = f?.status ?? null;
          return {
            ok: s?.status === 'completed' && fileStatus === 'completed' && (counts.failed ?? 0) === 0,
            storeStatus: s?.status ?? null,
            fileStatus,
            errorCode: f?.last_error?.code ?? null,
            usageBytes: typeof s?.usage_bytes === 'number' ? s.usage_bytes : null,
          };
        }
        if (Date.now() >= deadline) throw new FoundryError('ai_timeout');
        await sleep(opts.intervalMs ?? 3000);
      }
    },

    async deleteVectorStore(vectorStoreId) {
      if (!VECTOR_STORE_ID_RE.test(vectorStoreId)) throw new FoundryError('ai_bad_request');
      await ignoreNotFound(send('DELETE', `/openai/v1/vector_stores/${vectorStoreId}`, { retryServerErrors: true }));
    },

    async deleteFile(fileId) {
      if (!FILE_ID_RE.test(fileId)) throw new FoundryError('ai_bad_request');
      await ignoreNotFound(send('DELETE', `/openai/v1/files/${fileId}`, { retryServerErrors: true }));
    },

    async invokeAssessment({ vectorStoreId, input, maxOutputTokens = 4000, signal }) {
      // Never call without a resolved scenario-document store: an empty value would be stripped by
      // Foundry, leaving the agent with no ground truth.
      if (!VECTOR_STORE_ID_RE.test(vectorStoreId)) throw new FoundryError('ai_bad_request');
      const agentReference: Record<string, string> = { type: 'agent_reference', name: agentName };
      if (config.agentVersion) agentReference.version = config.agentVersion;
      const r = await send('POST', '/openai/v1/responses', {
        json: {
          agent_reference: agentReference,
          structured_inputs: { vector_store_id: vectorStoreId },
          tool_choice: 'required',
          store: false,
          max_output_tokens: maxOutputTokens,
          input,
        },
        timeoutMs: config.requestTimeoutMs,
        signal,
        retryServerErrors: true, // store:false — a retry has no side effect beyond cost
      });
      const b = r.body as {
        id?: unknown; status?: unknown; model?: unknown;
        incomplete_details?: { reason?: unknown } | null;
        agent_reference?: { name?: unknown; version?: unknown } | null;
        usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | null;
      } | null;
      const str = (v: unknown) => (typeof v === 'string' ? v : null);
      return {
        outputText: extractOutputText(b),
        responseId: str(b?.id),
        responseStatus: str(b?.status),
        incompleteReason: str(b?.incomplete_details?.reason),
        model: str(b?.model),
        agentName: str(b?.agent_reference?.name),
        agentVersion: str(b?.agent_reference?.version),
        usage: b?.usage
          ? {
              inputTokens: b.usage.input_tokens ?? 0,
              cachedInputTokens: b.usage.input_tokens_details?.cached_tokens ?? 0,
              outputTokens: b.usage.output_tokens ?? 0,
            }
          : null,
        fileSearchCalls: countFileSearchCalls(b),
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Process-wide accessor with a test seam. Tests inject a fake; production builds a REST client from the
// current configuration on first use.

let override: FoundryClient | null = null;
let cached: { key: string; client: FoundryClient } | null = null;

export function setFoundryClientForTests(client: FoundryClient | null): void {
  override = client;
  cached = null;
}

export function getFoundryClient(): FoundryClient {
  if (override) return override;
  const config = getAiConfig();
  if (!config.configured) throw new FoundryError('ai_not_configured');
  // Rebuild if the (non-secret) configuration changed.
  const key = [config.projectEndpoint, config.agentName, config.agentVersion, config.tenantId, config.clientId, config.requestTimeoutMs].join('|');
  if (!cached || cached.key !== key) cached = { key, client: createRestFoundryClient({ config }) };
  return cached.client;
}
