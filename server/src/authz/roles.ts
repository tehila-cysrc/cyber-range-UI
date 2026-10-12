// The three roles. `admin` is the full system administrator; `instructor` is a training operator
// scoped to (organization, scenario) pairs; `student` belongs to one team. Role comparisons live in
// server/src/authz/ only — everywhere else asks `isStaff` or a permission (see permissions.ts).
export type Role = 'admin' | 'instructor' | 'student';

export function isStaff(role: Role): boolean {
  return role !== 'student';
}

// Until the accounts table exists, every staff row in `users` (role 'instructor') is a full admin.
export function roleFromUsersRow(dbRole: string): Role {
  return dbRole === 'student' ? 'student' : 'admin';
}
