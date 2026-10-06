// Regenerates the preset avatar SVGs in client/src/assets/avatars/ (committed; the app has no runtime
// dependency on DiceBear). Run from client/ after `npm i --no-save @dicebear/core @dicebear/collection`:
//   node scripts/generate-avatars.cjs
// Seeds were hand-picked from a contact sheet — changing a seed changes that preset's face for every
// user who chose it. Licenses: Open Peeps (Pablo Stanley) CC0 1.0; Bottts (Pablo Stanley) free for
// personal and commercial use — both via DiceBear.
const fs = require('fs');
const path = require('path');
const { createAvatar } = require('@dicebear/core');
const { openPeeps, bottts } = require('@dicebear/collection');

const PEOPLE = [0, 3, 6, 8, 10, 14, 19, 20, 24, 25, 30, 32, 33, 36, 37, 38];
const ROBOTS = [0, 3, 5, 7, 9, 13, 16, 17];
// Light tints so dark hair doesn't vanish into the dark UI; robots are bright enough for a dark tile.
const PEOPLE_BG = ['cfe9d4', 'f1f1f1', 'd9def5', 'f3dfc4', 'e6d5f0', 'cde7ea'];
const ROBOT_BG = '26313a';

const out = path.join(__dirname, '..', 'src', 'assets', 'avatars');
fs.mkdirSync(out, { recursive: true });
const pad = (n) => String(n).padStart(2, '0');

PEOPLE.forEach((seed, i) => {
  const svg = createAvatar(openPeeps, { seed: `cr-openPeeps-${seed}`, backgroundColor: [PEOPLE_BG[i % PEOPLE_BG.length]] }).toString();
  fs.writeFileSync(path.join(out, `people-${pad(i + 1)}.svg`), svg);
});
ROBOTS.forEach((seed, i) => {
  const svg = createAvatar(bottts, { seed: `cr-bottts-${seed}`, backgroundColor: [ROBOT_BG] }).toString();
  fs.writeFileSync(path.join(out, `robot-${pad(i + 1)}.svg`), svg);
});
console.log(`wrote ${PEOPLE.length + ROBOTS.length} avatars to ${out}`);
