import type { Server, Socket } from 'socket.io';
import { db } from '../db/index.js';
import { isStaff, roleFromUsersRow, type Role } from '../authz/roles.js';
import { teamRoom, INSTRUCTOR_ROOM } from './rooms.js';
import { getIo } from './io.js';

interface AuthedUser {
  id: number;
  role: Role;
  teamId: number | null;
}

interface TokenRow {
  id: number;
  role: string;
  teamId: number | null;
  expiresAt: string;
}

function authenticate(token: string | undefined): AuthedUser | null {
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id AS id, u.role AS role, u.team_id AS teamId, at.expires_at AS expiresAt
       FROM auth_tokens at
       JOIN users u ON u.id = at.user_id
       WHERE at.token = ? AND u.deactivated_at IS NULL`,
    )
    .get(token) as TokenRow | undefined;

  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;

  return { id: row.id, role: roleFromUsersRow(row.role), teamId: row.teamId };
}

// A socket's rooms are decided at handshake, so its token is re-checked afterwards: logout, expiry,
// a deleted/moved/deactivated user or an event reset must stop the room events, not just REST calls.
const REVALIDATE_INTERVAL_MS = 15_000;

// Disconnects every socket whose token no longer authenticates to the same user/role/team. Runs on a
// timer (covers expiry and cascades), and is called right after the routes that revoke tokens.
export function revalidateSockets(io: Server) {
  for (const socket of io.sockets.sockets.values()) {
    const prev = socket.data.user as AuthedUser | undefined;
    const now = authenticate(socket.data.token as string | undefined);
    if (!prev || !now || now.id !== prev.id || now.role !== prev.role || now.teamId !== prev.teamId) {
      socket.disconnect(true);
    }
  }
}

// Call right after revoking tokens or removing users/teams so the cut-off is immediate rather than at
// the next timer tick. A no-op before the socket server exists (unit tests, scripts).
export function kickRevokedSockets() {
  let io: Server;
  try {
    io = getIo();
  } catch {
    return;
  }
  revalidateSockets(io);
}

export function setupSockets(io: Server) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const user = authenticate(token);
    if (!user) {
      next(new Error('unauthorized'));
      return;
    }
    socket.data.user = user;
    socket.data.token = token;
    next();
  });

  setInterval(() => revalidateSockets(io), REVALIDATE_INTERVAL_MS).unref();

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthedUser;

    if (isStaff(user.role)) {
      socket.join(INSTRUCTOR_ROOM);
    } else if (user.teamId != null) {
      socket.join(teamRoom(user.teamId));
    }
  });
}
