import { db } from '../db/index.js';

export const MIN_PASSWORD_LENGTH = 8;

export interface ProfileUpdateInput {
  currentPassword?: unknown;
  username?: unknown;
  displayName?: unknown;
  newPassword?: unknown;
}

export interface ProfileUser {
  id: number;
  username: string;
  role: string;
  teamId: number | null;
  displayName: string;
  avatar: string | null;
}

export type ProfileUpdateResult =
  | { ok: true; user: ProfileUser; passwordChanged: boolean }
  | { ok: false; status: number; error: string };

// Self-service account edit (any role): username, display name, password. The current password is
// always required — a token left signed in on a shared lab machine must not be enough to take over
// the account. Plaintext compare/storage is the documented decision (CLAUDE/invariants.md → Auth).
export function updateOwnProfile(userId: number, currentToken: string, input: ProfileUpdateInput): ProfileUpdateResult {
  const user = db
    .prepare(
      `SELECT id, event_run_id AS runId, username, password, role, team_id AS teamId, display_name AS displayName, avatar
       FROM users WHERE id = ?`,
    )
    .get(userId) as (ProfileUser & { runId: number; password: string }) | undefined;
  if (!user) return { ok: false, status: 404, error: 'user not found' };

  if (typeof input.currentPassword !== 'string' || input.currentPassword !== user.password) {
    return { ok: false, status: 403, error: 'current password is incorrect' };
  }

  let username = user.username;
  if (input.username !== undefined) {
    if (typeof input.username !== 'string' || !input.username.trim()) {
      return { ok: false, status: 400, error: 'username cannot be empty' };
    }
    username = input.username.trim();
  }

  let displayName = user.displayName;
  if (input.displayName !== undefined) {
    if (typeof input.displayName !== 'string' || !input.displayName.trim()) {
      return { ok: false, status: 400, error: 'display name cannot be empty' };
    }
    displayName = input.displayName.trim();
  }

  let password = user.password;
  if (input.newPassword !== undefined && input.newPassword !== '') {
    if (typeof input.newPassword !== 'string' || input.newPassword.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, status: 400, error: `new password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }
    password = input.newPassword;
  }
  const passwordChanged = password !== user.password;

  if (username !== user.username) {
    const taken = db
      .prepare('SELECT 1 FROM users WHERE event_run_id = ? AND username = ? AND id != ?')
      .get(user.runId, username, userId);
    if (taken) return { ok: false, status: 409, error: `username "${username}" is already taken this run` };
  }

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET username = ?, display_name = ?, password = ? WHERE id = ?').run(
      username,
      displayName,
      password,
      userId,
    );
    // A password change signs the account out everywhere else (e.g. a forgotten lab-machine
    // session), but keeps the session that made the change.
    if (passwordChanged) {
      db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND token != ?').run(userId, currentToken);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    ok: true,
    user: { id: user.id, username, role: user.role, teamId: user.teamId, displayName, avatar: user.avatar },
    passwordChanged,
  };
}
