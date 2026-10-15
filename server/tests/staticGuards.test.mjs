import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Static guards (RBAC design review §6): authorization decisions live in server/src/authz/ only. A role
// compared to a string anywhere else is how the old "instructor = admin" assumption spread through
// the code, so it fails the build instead of waiting for review.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((f) => ({ path: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf-8') }));
const outsideAuthz = files.filter((f) => !f.path.startsWith('authz/'));

function offenders(pattern) {
  return outsideAuthz.flatMap((f) =>
    f.text
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => pattern.test(line) && !line.trim().startsWith('//'))
      .map(({ n, line }) => `${f.path}:${n}: ${line.trim()}`),
  );
}

test('no role string comparison outside server/src/authz/', () => {
  const ROLE = "'(?:admin|instructor|student)'";
  const pattern = new RegExp(`role\\s*[!=]==\\s*${ROLE}|${ROLE}\\s*[!=]==\\s*[\\w.!?]*role\\b`);
  assert.deepEqual(offenders(pattern), []);
});

test('no requireRole() — routes declare a permission instead', () => {
  assert.deepEqual(offenders(/requireRole\(/), []);
});


// AI Investigation Assessment: the Foundry client secret is read in exactly one place (the credential
// builder) and its presence checked in aiConfig — nowhere else may touch it, so it can't leak into a
// response, a log line or another integration by accident.
test('AZURE_CLIENT_SECRET is read only by services/ai/foundryClient.ts (and checked for presence in aiConfig.ts)', () => {
  const allowed = ['services/ai/foundryClient.ts', 'services/ai/aiConfig.ts'];
  const readers = files.filter((f) => /AZURE_CLIENT_SECRET/.test(f.text.replace(/^\s*\/\/.*$/gm, ''))).map((f) => f.path);
  assert.deepEqual(readers.filter((p) => !allowed.includes(p)), []);
});

// The AI assessment never writes official scores: only the existing scoring paths insert into `scores`.
test('services/ai/ never writes the scores table', () => {
  const ai = files.filter((f) => f.path.startsWith('services/ai/'));
  assert.ok(ai.length > 0);
  assert.deepEqual(ai.filter((f) => /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+scores\b/i.test(f.text)).map((f) => f.path), []);
});

test('socket events leave only through sockets/ (scoped delivery), never a raw getIo() emit', () => {
  const raw = outsideAuthz.filter((f) => !f.path.startsWith('sockets/') && /getIo\(\)|INSTRUCTOR_ROOM/.test(f.text)).map((f) => f.path);
  assert.deepEqual(raw, []);
  const sockets = files.filter((f) => f.path.startsWith('sockets/'));
  assert.ok(!sockets.some((f) => /INSTRUCTOR_ROOM|\.to\(STAFF_ROOM\)/.test(f.text)), 'nothing may emit to the whole staff room');
});
