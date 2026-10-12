import { db } from '../db/index.js';
import { getActiveEventRunId } from '../db/seed.js';

// Staff identities (admin / instructor) live in `accounts` (CONFIG) and survive an event reset. Each
// run holds one `users` membership row per account (role 'instructor', account_id set, no password),
// created at first sign-in, so every existing FK to users(id) keeps working. Students never have an
// account. See CLAUDE/db.md → accounts.

export type StaffRole = 'admin' | 'instructor';

export interface AccountRow {
  id: number;
  username: string;
  password: string;
  role: StaffRole;
  displayName: string;
  avatar: string | null;
  createdAt: string;
  disabledAt: string | null;
}

const ACCOUNT_COLUMNS = `id, username, password, role, display_name AS displayName, avatar,
  created_at AS createdAt, disabled_at AS disabledAt`;

export function getAccount(id: number): AccountRow | undefined {
  return db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`).get(id) as AccountRow | undefined;
}

// accounts.username is UNIQUE COLLATE NOCASE, so this lookup is case-insensitive.
export function findAccountByUsername(username: string): AccountRow | undefined {
  return db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE username = ?`).get(username) as AccountRow | undefined;
}

// Staff sign-in for instructor accounts can be switched off as a whole (ENABLE_SCOPED_INSTRUCTORS=false)
// without touching admins or students. Fail-closed: a disabled instructor is refused, never upgraded.
// Any common "off" spelling switches them off (false/0/off/no, any case) — a typo must not fail open.
export function scopedInstructorsEnabled(): boolean {
  const raw = (process.env.ENABLE_SCOPED_INSTRUCTORS ?? '').trim().toLowerCase();
  return !['false', '0', 'off', 'no'].includes(raw);
}

export function activeAdminCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin' AND disabled_at IS NULL").get() as { n: number }).n;
}

// A username is one namespace across staff accounts and the active run's students — otherwise a
// student could register as "Instructor" and be confused with (or shadow) a staff login.
export function usernameTaken(username: string, except: { accountId?: number; userId?: number } = {}): boolean {
  const account = db
    .prepare('SELECT id FROM accounts WHERE username = ? AND id IS NOT ?')
    .get(username, except.accountId ?? null);
  if (account) return true;
  const runId = getActiveEventRunId();
  if (runId === null) return false;
  return !!db
    .prepare(
      `SELECT 1 FROM users WHERE event_run_id = ? AND username = ? COLLATE NOCASE AND id IS NOT ?
         AND (account_id IS NULL OR account_id IS NOT ?)`,
    )
    .get(runId, username, except.userId ?? null, except.accountId ?? null);
}

// The account's users row in the active run, created on first use and kept in sync with the account's
// name/avatar. Returns null when there is no active run.
export function ensureStaffMembership(account: AccountRow): number | null {
  const runId = getActiveEventRunId();
  if (runId === null) return null;
  const existing = db
    .prepare('SELECT id FROM users WHERE event_run_id = ? AND account_id = ?')
    .get(runId, account.id) as { id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE users SET username = ?, display_name = ?, avatar = ?, deactivated_at = NULL WHERE id = ?').run(
      account.username,
      account.displayName,
      account.avatar,
      existing.id,
    );
    return existing.id;
  }
  const result = db
    .prepare(
      `INSERT INTO users (event_run_id, username, password, role, team_id, display_name, avatar, account_id)
       VALUES (?, ?, '', 'instructor', NULL, ?, ?, ?)`,
    )
    .run(runId, account.username, account.displayName, account.avatar, account.id);
  return Number(result.lastInsertRowid);
}

// Name/avatar changes of an account show up wherever its membership row is joined (timelines, awards).
export function syncMembership(accountId: number) {
  const account = getAccount(accountId);
  if (!account) return;
  db.prepare('UPDATE users SET username = ?, display_name = ?, avatar = ? WHERE account_id = ?').run(
    account.username,
    account.displayName,
    account.avatar,
    accountId,
  );
}

// Signs the account out everywhere (every run's membership row). Callers kick sockets afterwards.
export function revokeAccountTokens(accountId: number, exceptToken?: string) {
  db.prepare(
    'DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE account_id = ?) AND token IS NOT ?',
  ).run(accountId, exceptToken ?? null);
}

export function insertAccount(
  input: { username: string; password: string; role: StaffRole; displayName: string; avatar: string | null },
  createdByAccountId: number | null,
): number {
  const result = db
    .prepare(
      `INSERT INTO accounts (username, password, role, display_name, avatar, created_at, created_by_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.username, input.password, input.role, input.displayName, input.avatar, new Date().toISOString(), createdByAccountId);
  return Number(result.lastInsertRowid);
}

export const DEFAULT_ADMIN_USERNAME = 'instructor';
export const DEFAULT_ADMIN_PASSWORD = 'instructor123';

// A deployment always needs one admin to sign in with. Only a database with no active admin at all (a
// first start) gets one: INITIAL_ADMIN_PASSWORD if set, else the documented dev default. An event reset
// never calls this — accounts survive it.
export function ensureInitialAdmin(): { created: boolean; username?: string } {
  if (activeAdminCount() > 0) return { created: false };
  let username = DEFAULT_ADMIN_USERNAME;
  for (let n = 1; findAccountByUsername(username); n++) username = n === 1 ? 'admin' : `admin${n}`;
  insertAccount(
    {
      username,
      password: process.env.INITIAL_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,
      role: 'admin',
      displayName: 'Administrator',
      avatar: null,
    },
    null,
  );
  return { created: true, username };
}
