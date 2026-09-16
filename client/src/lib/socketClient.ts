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
    socket = io(API_ORIGIN, { auth: { token } });
  }

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
