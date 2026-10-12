// Admins: every staff event. Instructors: joined to STAFF_ROOM only so scopedEmit can find their
// sockets — nothing is ever emitted to STAFF_ROOM as a whole. Students: their team's room.
export const ADMIN_ROOM = 'admin';
export const STAFF_ROOM = 'staff';

export function teamRoom(teamId: number): string {
  return `team:${teamId}`;
}

export function userRoom(userId: number): string {
  return `user:${userId}`;
}
