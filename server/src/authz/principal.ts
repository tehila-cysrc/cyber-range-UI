import { db } from '../db/index.js';
import { scopedInstructorsEnabled } from '../services/accounts.service.js';
import type { Role } from './roles.js';

// Who is calling. `id` is the users row of the active run (what every RUN table references);
// `accountId` is set for staff only. The role is read from accounts for staff — users.role
// 'instructor' only marks a staff membership row and is never trusted as a role on its own.
export interface Principal {
  id: number;
  accountId: number | null;
  role: Role;
  teamId: number | null;
  username: string;
}

interface TokenRow {
  id: number;
  usersRole: string;
  teamId: number | null;
  username: string;
  accountId: number | null;
  accountRole: 'admin' | 'instructor' | null;
  accountDisabledAt: string | null;
  expiresAt: string;
}

// The one place a bearer token becomes a principal — shared by requireAuth (HTTP) and the socket
// handshake/revalidation, so both always agree. Read fresh on every call: a disabled account, a role
// change or a deleted token takes effect on the next request.
export function authenticateToken(token: string | null | undefined): Principal | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id AS id, u.role AS usersRole, u.team_id AS teamId, u.username AS username, u.account_id AS accountId,
              a.role AS accountRole, a.disabled_at AS accountDisabledAt, at.expires_at AS expiresAt
       FROM auth_tokens at
       JOIN users u ON u.id = at.user_id
       LEFT JOIN accounts a ON a.id = u.account_id
       WHERE at.token = ? AND u.deactivated_at IS NULL`,
    )
    .get(token) as TokenRow | undefined;
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;

  if (row.accountId !== null) {
    if (!row.accountRole || row.accountDisabledAt) return null;
    if (row.accountRole === 'instructor' && !scopedInstructorsEnabled()) return null;
    return { id: row.id, accountId: row.accountId, role: row.accountRole, teamId: null, username: row.username };
  }
  // A staff row without an account (pre-accounts data) is refused rather than guessed at.
  if (row.usersRole !== 'student') return null;
  return { id: row.id, accountId: null, role: 'student', teamId: row.teamId, username: row.username };
}
