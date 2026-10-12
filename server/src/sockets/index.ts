import type { Server, Socket } from 'socket.io';
import { authenticateToken, type Principal } from '../authz/principal.js';
import { isAdmin, isInstructor } from '../authz/roles.js';
import { ADMIN_ROOM, STAFF_ROOM, teamRoom, userRoom } from './rooms.js';
import { getIo } from './io.js';

type AuthedUser = Principal;

function authenticate(token: string | undefined): AuthedUser | null {
  return authenticateToken(token);
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
    if (!prev || !now || now.id !== prev.id || now.role !== prev.role || now.teamId !== prev.teamId || now.accountId !== prev.accountId) {
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

    // Rooms are joined here only — there are no client "join" handlers. Instructors never receive a
    // room-wide event: scopedEmit.ts picks their sockets one by one by scope.
    socket.join(userRoom(user.id));
    if (isAdmin(user.role)) {
      socket.join(ADMIN_ROOM);
    } else if (isInstructor(user.role)) {
      socket.join(STAFF_ROOM);
    } else if (user.teamId != null) {
      socket.join(teamRoom(user.teamId));
    }
  });
}
