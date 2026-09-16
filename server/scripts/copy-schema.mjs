import { cpSync } from 'node:fs';

// TypeScript does not emit the SQL files used by the compiled migration/seed code.
cpSync(new URL('../src/db/schema/', import.meta.url), new URL('../dist/db/schema/', import.meta.url), {
  recursive: true,
});
