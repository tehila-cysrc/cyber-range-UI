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

// The socket's room (team:{id} / instructor) is fixed at handshake time from the token it was opened
// with. If the token changes — sign-out, a 401 auto-clear, or a different user signing in on the
// same lab machine — the old socket would keep delivering the PREVIOUS user's team events, so drop it
// and let the next getSocket() reconnect with the new identity.
useAuthStore.subscribe((state, prev) => {
  if (state.token !== prev.token) disconnectSocket();
});
