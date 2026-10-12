import type { Server } from 'socket.io';
import { getIo } from './io.js';
import { ADMIN_ROOM, STAFF_ROOM, teamRoom, userRoom } from './rooms.js';
import type { Principal } from '../authz/principal.js';
import { pairInScope, teamInScope } from '../authz/scope.js';

// Scoped delivery (RBAC design review §4.5). Admins share ADMIN_ROOM and get every staff event.
// Instructors sit in STAFF_ROOM, which is never emitted to as a whole: each instructor socket gets a
// team's event only when that team's (organization, scenario) pair — or, for an event with no
// scenario, the team itself — is in its scope, evaluated with the SAME functions as the HTTP layer and
// read fresh at emit time, so an assignment change applies to the very next event.

function io(): Server | null {
  try {
    return getIo();
  } catch {
    return null; // no socket server (unit tests, scripts)
  }
}

// Instructor sockets of STAFF_ROOM that may see (teamId, cyberRangeId). Scope is evaluated once per
// account per emit (several tabs of one instructor share the answer).
function staffSocketIdsInScope(server: Server, teamId: number, cyberRangeId: number | null): string[] {
  const room = server.sockets.adapter.rooms.get(STAFF_ROOM);
  if (!room) return [];
  const verdicts = new Map<number, boolean>();
  const out: string[] = [];
  for (const socketId of room) {
    const principal = server.sockets.sockets.get(socketId)?.data.user as Principal | undefined;
    if (!principal || principal.accountId === null) continue;
    let ok = verdicts.get(principal.accountId);
    if (ok === undefined) {
      ok = cyberRangeId === null ? teamInScope(principal, teamId) : pairInScope(principal, teamId, cyberRangeId);
      verdicts.set(principal.accountId, ok);
    }
    if (ok) out.push(socketId);
  }
  return out;
}

export interface ScopedTargets {
  team?: boolean; // also the team's own room (students)
  staff?: boolean; // admins + in-scope instructors
}

// One event about one team's work. `cyberRangeId` null = a team-level event (scope by organization).
export function emitScoped(
  teamId: number,
  cyberRangeId: number | null,
  event: string,
  payload: unknown,
  targets: ScopedTargets = { team: true, staff: true },
) {
  const server = io();
  if (!server) return;
  const rooms: string[] = [];
  if (targets.team) rooms.push(teamRoom(teamId));
  if (targets.staff) rooms.push(ADMIN_ROOM, ...staffSocketIdsInScope(server, teamId, cyberRangeId));
  if (rooms.length) server.to(rooms).emit(event, payload);
}

// A staff member's own thing (their diagnostic Connect session): the owner and admins only.
export function emitToUserAndAdmins(userId: number, event: string, payload: unknown) {
  io()?.to([userRoom(userId), ADMIN_ROOM]).emit(event, payload);
}

// Payload-free signals that every viewer re-reads through its own scoped GET.
export function emitBroadcastSignal(event: string, payload: unknown) {
  io()?.emit(event, payload);
}
