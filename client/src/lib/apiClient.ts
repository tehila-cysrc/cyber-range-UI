import { useAuthStore } from '../stores/authStore';

// In `vite dev` (local dev server), stay same-origin so vite.config.ts's own proxy
// (/api, /socket.io -> http://localhost:4000) handles routing to the local backend — an absolute
// URL here would bypass that proxy entirely and always hit a remote backend, even locally.
// A production bundle served by this API (Coolify / Docker) is also same-origin, so the origin
// stays empty. A split static host sets VITE_API_ORIGIN to the API origin at build time.
export const API_ORIGIN = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');
const API_BASE_URL = `${API_ORIGIN}/api`;

export const SIGNED_OUT_NOTE_KEY = 'cyber-range-signed-out';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    // A signed-in user losing their session (account deleted, event reset, token expired) used to be
    // bounced to the login page with no explanation — the login page shows this note once.
    if (token) {
      try {
        sessionStorage.setItem(SIGNED_OUT_NOTE_KEY, '1');
      } catch {
        // storage blocked — the redirect still happens, just without the note
      }
    }
    useAuthStore.getState().clear();
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `Request failed with status ${res.status}`);
  }

  return body as T;
}
