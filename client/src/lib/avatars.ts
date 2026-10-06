// Optional preset avatars a user can pick instead of the default initials circle. The SVGs are
// generated once by client/scripts/generate-avatars.cjs and committed. The server only stores the key
// (users.avatar) and validates it against the same people-NN / robot-NN pattern.
const files = import.meta.glob<string>('../assets/avatars/*.svg', { eager: true, query: '?url', import: 'default' });

const urls = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  urls.set(path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), url);
}

export const AVATAR_KEYS = [...urls.keys()].sort((a, b) => {
  // People first, then robots, each in numeric order.
  const group = (k: string) => (k.startsWith('people') ? 0 : 1);
  return group(a) - group(b) || a.localeCompare(b);
});

export function avatarUrl(key: string | null | undefined): string | null {
  return key ? (urls.get(key) ?? null) : null;
}
