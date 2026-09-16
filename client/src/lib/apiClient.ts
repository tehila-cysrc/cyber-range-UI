import { useAuthStore } from '../stores/authStore';

// In `vite dev` (local dev server), stay same-origin so vite.config.ts's own proxy
// (/api, /socket.io -> http://localhost:4000) handles routing to the local backend — an absolute
// URL here would bypass that proxy entirely and always hit the deployed backend, even locally.
// The built production bundle (Vercel, a static site with no backend of its own) has no such proxy,
// so it needs the real deployed origin.
export const API_ORIGIN = import.meta.env.DEV ? '' : 'https://cyber-range-ui.onrender.com';
const API_BASE_URL = `${API_ORIGIN}/api`;

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
    useAuthStore.getState().clear();
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `Request failed with status ${res.status}`);
  }

  return body as T;
}
