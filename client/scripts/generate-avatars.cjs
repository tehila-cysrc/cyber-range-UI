// Regenerates the preset avatar SVGs + manifest in client/src/assets/avatars/ (committed; the app has
// no runtime dependency on DiceBear). Run from client/ after
// `npm i --no-save @dicebear/core @dicebear/collection`:   node scripts/generate-avatars.cjs
// Seeds were hand-picked from a contact sheet (6 per style) — changing a seed changes that preset's face
// for every user who chose it. Keys are `<style>-NN`; the server's allow-list (server/src/services/
// avatar.service.ts) must match STYLES below. CC BY 4.0 styles need the credits line the picker shows
// from manifest.json.
const fs = require('fs');
const path = require('path');
const { createAvatar } = require('@dicebear/core');
const c = require('@dicebear/collection');

const LIGHT = ['cfe9d4', 'f1f1f1', 'd9def5', 'f3dfc4', 'e6d5f0', 'cde7ea'];
// bg: 'light' = rotating pastel tints (dark hair would vanish on the dark UI), 'dark' = surface tile,
// 'default' = the style's own background colors.
const STYLES = [
  { id: 'open-peeps', fn: 'openPeeps', label: 'Open Peeps', bg: 'light', seeds: [0, 3, 6, 8, 9, 10] },
  { id: 'notionists', fn: 'notionists', label: 'Notionists', bg: 'light', seeds: [0, 3, 5, 6, 9, 11] },
  { id: 'lorelei', fn: 'lorelei', label: 'Lorelei', bg: 'light', seeds: [0, 4, 5, 6, 8, 9] },
  { id: 'adventurer', fn: 'adventurer', label: 'Adventurer', bg: 'light', seeds: [0, 2, 3, 4, 6, 9] },
  { id: 'avataaars', fn: 'avataaars', label: 'Avataaars', bg: 'light', seeds: [0, 2, 4, 5, 6, 9] },
  { id: 'micah', fn: 'micah', label: 'Micah', bg: 'light', seeds: [0, 2, 4, 6, 9, 11] },
  { id: 'toon-head', fn: 'toonHead', label: 'Toon Head', bg: 'light', seeds: [0, 2, 6, 7, 10, 11] },
  { id: 'big-smile', fn: 'bigSmile', label: 'Big Smile', bg: 'light', seeds: [0, 3, 4, 6, 8, 9] },
  { id: 'miniavs', fn: 'miniavs', label: 'Miniavs', bg: 'light', seeds: [0, 2, 3, 5, 9, 11] },
  { id: 'dylan', fn: 'dylan', label: 'Dylan', bg: 'light', seeds: [0, 2, 5, 6, 9, 10] },
  { id: 'pixel-art', fn: 'pixelArt', label: 'Pixel Art', bg: 'light', seeds: [0, 2, 4, 6, 9, 11] },
  { id: 'bottts', fn: 'bottts', label: 'Robots', bg: 'dark', seeds: [0, 3, 5, 7, 9, 11] },
  { id: 'bottts-neutral', fn: 'botttsNeutral', label: 'Robot faces', bg: 'default', seeds: [0, 3, 6, 8, 10, 11] },
  { id: 'thumbs', fn: 'thumbs', label: 'Thumbs', bg: 'default', seeds: [0, 4, 5, 6, 7, 9] },
];

const out = path.join(__dirname, '..', 'src', 'assets', 'avatars');
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith('.svg')) fs.unlinkSync(path.join(out, f));
const pad = (n) => String(n).padStart(2, '0');

const manifest = STYLES.map((s) => {
  const style = c[s.fn];
  const keys = s.seeds.map((seed, i) => {
    const opts = { seed: `cr-${s.fn}-${seed}` };
    if (s.bg === 'light') opts.backgroundColor = [LIGHT[i % LIGHT.length]];
    if (s.bg === 'dark') opts.backgroundColor = ['26313a'];
    const key = `${s.id}-${pad(i + 1)}`;
    fs.writeFileSync(path.join(out, `${key}.svg`), createAvatar(style, opts).toString());
    return key;
  });
  const m = style.meta ?? {};
  return {
    id: s.id,
    label: s.label,
    keys,
    title: m.title ?? s.label,
    creator: m.creator ?? '',
    source: m.source ?? '',
    license: m.license?.name ?? '',
    licenseUrl: m.license?.url ?? '',
  };
});
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${manifest.reduce((n, s) => n + s.keys.length, 0)} avatars in ${manifest.length} styles to ${out}`);
