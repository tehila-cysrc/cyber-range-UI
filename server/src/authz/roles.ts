// The three roles. `admin` is the full system administrator; `instructor` is a training operator
// scoped to (organization, scenario) pairs; `student` belongs to one team. Role comparisons live in
// server/src/authz/ only — everywhere else uses these helpers or a permission (see permissions.ts);
// tests/staticGuards.test.mjs fails the build on a role string comparison anywhere else.
export type Role = 'admin' | 'instructor' | 'student';

// `unknown` on purpose: also used on account rows and request bodies, not just principals.
export function isStaff(role: unknown): boolean {
  return role === 'admin' || role === 'instructor';
}

export function isAdmin(role: unknown): boolean {
  return role === 'admin';
}

export function isInstructor(role: unknown): boolean {
  return role === 'instructor';
}

export function isStudent(role: unknown): boolean {
  return role === 'student';
}
