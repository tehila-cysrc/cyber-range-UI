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


test('socket events leave only through sockets/ (scoped delivery), never a raw getIo() emit', () => {
  const raw = outsideAuthz.filter((f) => !f.path.startsWith('sockets/') && /getIo\(\)|INSTRUCTOR_ROOM/.test(f.text)).map((f) => f.path);
  assert.deepEqual(raw, []);
  const sockets = files.filter((f) => f.path.startsWith('sockets/'));
  assert.ok(!sockets.some((f) => /INSTRUCTOR_ROOM|\.to\(STAFF_ROOM\)/.test(f.text)), 'nothing may emit to the whole staff room');
});
