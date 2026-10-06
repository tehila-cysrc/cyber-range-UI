import { db } from '../db/index.js';

// Optional preset avatar per user (users.avatar). NULL = the default initials circle. The client ships
// the matching SVGs (client/src/assets/avatars/people-01..16, robot-01..08); the server only stores
// and validates the key so a typo or stale client can't save something that renders as a broken image.
const AVATAR_KEY = /^(people-(0[1-9]|1[0-6])|robot-0[1-8])$/;

export type AvatarParse = { ok: true; avatar: string | null } | { ok: false; error: string };

// undefined/null/'' all mean "no avatar" — creation forms send nothing when the user skips the picker.
export function parseAvatar(value: unknown): AvatarParse {
  if (value === undefined || value === null || value === '') return { ok: true, avatar: null };
  if (typeof value === 'string' && AVATAR_KEY.test(value)) return { ok: true, avatar: value };
  return { ok: false, error: 'unknown avatar' };
}

// Cosmetic, so unlike the rest of the profile it doesn't ask for the current password.
export function setOwnAvatar(userId: number, value: unknown): AvatarParse {
  const parsed = parseAvatar(value);
  if (parsed.ok) db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(parsed.avatar, userId);
  return parsed;
}
