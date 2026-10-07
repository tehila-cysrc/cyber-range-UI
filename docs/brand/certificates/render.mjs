// Renders every designs/*.html certificate to output/<name>.pdf (A4 landscape, vector)
// and output/<name>.png (3x, ~290 dpi) using headless Chrome/Edge.
// Usage: node docs/brand/certificates/render.mjs   (set CHROME_PATH to override the browser)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const designs = join(here, 'designs');
const out = join(here, 'output');
mkdirSync(out, { recursive: true });

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) throw new Error('No Chrome/Edge found; set CHROME_PATH');

const common = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--virtual-time-budget=3000'];

for (const file of readdirSync(designs).filter((f) => f.endsWith('.html'))) {
  const name = file.replace(/\.html$/, '');
  const url = pathToFileURL(join(designs, file)).href;
  execFileSync(chrome, [...common, '--no-pdf-header-footer', `--print-to-pdf=${resolve(out, name + '.pdf')}`, url], { stdio: 'ignore' });
  // 297x210mm at 96 dpi = 1123x794 CSS px
  execFileSync(chrome, [...common, '--window-size=1123,794', '--force-device-scale-factor=3', `--screenshot=${resolve(out, name + '.png')}`, url], { stdio: 'ignore' });
  console.log(`rendered ${name}`);
}
