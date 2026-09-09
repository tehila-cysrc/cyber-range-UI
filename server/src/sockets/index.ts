import type { Server, Socket } from 'socket.io';
import { db } from '../db/index.js';
import { teamRoom, INSTRUCTOR_ROOM } from './rooms.js';

interface AuthedUser {
  id: number;
  role: 'student' | 'instructor';
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
       WHERE at.token = ?`,
    )
    .get(token) as TokenRow | undefined;

  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;

  return { id: row.id, role: row.role as 'student' | 'instructor', teamId: row.teamId };
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
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthedUser;

    if (user.role === 'instructor') {
      socket.join(INSTRUCTOR_ROOM);
    } else if (user.teamId != null) {
      socket.join(teamRoom(user.teamId));
    }
  });
}
