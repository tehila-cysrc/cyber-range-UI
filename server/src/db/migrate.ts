import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function runSchemaFile(relativePath: string) {
  const sql = readFileSync(join(__dirname, relativePath), 'utf-8');
  db.exec(sql);
}

export function migrate() {
  // Order matters: run.sql's foreign keys reference config.sql's tables.
  runSchemaFile('schema/config.sql');
  runSchemaFile('schema/run.sql');
  console.log('[migrate] schema applied');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  migrate();
}
