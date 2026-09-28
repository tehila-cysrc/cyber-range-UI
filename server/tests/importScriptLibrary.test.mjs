import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'import-script-library-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const { importScriptLibraryIfEmpty } = await import('../dist/db/importScriptLibrary.js');

const count = () => Number(db.prepare('SELECT COUNT(*) AS n FROM scripts').get().n);

test('fills an empty Script Library from script-library/catalog.json', () => {
  seed();
  assert.equal(count(), 0);
  importScriptLibraryIfEmpty();
  assert.ok(count() > 0);
});

test('leaves a non-empty library alone, so deleted scripts are not re-imported', () => {
  const before = count();
  db.prepare('DELETE FROM scripts WHERE id = (SELECT MIN(id) FROM scripts)').run();
  importScriptLibraryIfEmpty();
  assert.equal(count(), before - 1);
});
