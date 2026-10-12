import { useAuthStore, type AuthUser } from '../stores/authStore';

export type Role = AuthUser['role'];

// Mirrors server/src/authz/permissions.ts — names only. Which ones the user holds always comes from
// the server (login / GET /auth/me); the UI uses them to show or hide things, never to grant access.
export type Permission =
  | 'org.read'
  | 'org.manage'
  | 'registration.manage'
  | 'account.manage'
  | 'assignment.manage'
  | 'team.read'
  | 'team.manage'
  | 'student.manage'
  | 'team.self'
  | 'progress.manage'
  | 'dashboard.read'
  | 'documentation.read'
  | 'documentation.write'
  | 'documentation.feedback'
  | 'canvas.read'
  | 'canvas.write'
  | 'history.read'
  | 'score.read'
  | 'score.award'
  | 'ttp.manage'
  | 'ttp.occurrence.mark'
  | 'leaderboard.read'
  | 'help.request'
  | 'help.manage'
  | 'access_session.self'
  | 'access_session.manage'
  | 'scenario.read'
  | 'scenario.inspect'
  | 'scenario.create'
  | 'scenario.delete'
  | 'scenario.author'
  | 'environment.manage'
  | 'environment.operate'
  | 'script.read'
  | 'script.write'
  | 'script.adhoc'
  | 'audit.read'
  | 'event.reset'
  | 'event.export'
  | 'remote_access.revoke_all'
  | 'mitre.read'
  | 'profile.self';

// Admin and instructor both use the staff UI; the server decides what each may actually do.
export function isStaff(role: Role | null | undefined): boolean {
  return role != null && role !== 'student';
}

// Until the server has sent the list (a session stored before permissions existed, first paint),
// an admin is assumed to hold everything and anyone else nothing — only ever hides UI, never grants.
export function hasPermission(permissions: string[] | null, role: Role | undefined, permission: Permission): boolean {
  if (permissions) return permissions.includes(permission);
  return role === 'admin';
}

export function useCan(permission: Permission): boolean {
  return useAuthStore((s) => hasPermission(s.permissions, s.user?.role, permission));
}
