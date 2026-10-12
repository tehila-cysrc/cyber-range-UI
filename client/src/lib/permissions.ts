import type { AuthUser } from '../stores/authStore';

export type Role = AuthUser['role'];

// Admin and instructor both use the staff UI; the server decides what each may actually do.
export function isStaff(role: Role | null | undefined): boolean {
  return role != null && role !== 'student';
}
