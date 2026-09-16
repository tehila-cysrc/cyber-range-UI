import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { API_ORIGIN } from './apiClient';

let socket: Socket | null = null;

// Lazily creates the socket on first use (whichever component asks for it first —
// mount order between AppShell and a feature page's useSocketEvent is not guaranteed).
export function getSocket(): Socket | null {
  const token = useAuthStore.getState().token;
  if (!token) return null;

  if (!socket) {
    // API_ORIGIN is '' in dev (see apiClient.ts) — pass undefined so socket.io-client connects to
    // the current page's own origin (proxied to the local backend by vite.config.ts), not the
    // literal empty string.
    socket = io(API_ORIGIN || undefined, { auth: { token } });
  }

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
