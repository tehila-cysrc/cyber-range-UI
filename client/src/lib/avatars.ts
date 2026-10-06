// Optional preset avatars a user can pick instead of the default initials circle — 14 styles, 6 each.
// The SVGs + manifest are generated once by client/scripts/generate-avatars.cjs and committed. The
// server only stores the key (users.avatar) and validates it against the same style list.
import manifest from '../assets/avatars/manifest.json';

export interface AvatarStyle {
  id: string;
  label: string;
  keys: string[];
  title: string;
  creator: string;
  source: string;
  license: string;
  licenseUrl: string;
}

export const AVATAR_STYLES = manifest as AvatarStyle[];

const files = import.meta.glob<string>('../assets/avatars/*.svg', { eager: true, query: '?url', import: 'default' });

const urls = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  urls.set(path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), url);
}

export function avatarUrl(key: string | null | undefined): string | null {
  return key ? (urls.get(key) ?? null) : null;
}
