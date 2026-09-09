export const INSTRUCTOR_ROOM = 'instructor';

export function teamRoom(teamId: number): string {
  return `team:${teamId}`;
}
