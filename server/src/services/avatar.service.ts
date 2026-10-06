import { db } from '../db/index.js';

// Optional preset avatar per user (users.avatar). NULL = the default initials circle. The client ships
// the matching SVGs (client/src/assets/avatars/<style>-01..06.svg, from client/scripts/
// generate-avatars.cjs); the server only stores and validates the key so a typo or stale client can't
// save something that renders as a broken image. Keep this list in sync with that script's STYLES.
const STYLES = [
  'open-peeps', 'notionists', 'lorelei', 'adventurer', 'avataaars', 'micah', 'toon-head',
  'big-smile', 'miniavs', 'dylan', 'pixel-art', 'bottts', 'bottts-neutral', 'thumbs',
];
const PER_STYLE = 6;
const AVATAR_KEY = new RegExp(`^(${STYLES.join('|')})-0[1-${PER_STYLE}]$`);

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
