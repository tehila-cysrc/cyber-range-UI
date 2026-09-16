import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';
import { db } from './index.js';
import { createScript, type ScriptType } from '../services/scriptExecution.service.js';

// Imports the curated script-library/ catalog (repo root, sibling to server/) into the CONFIG
// `scripts` table so the Instructor Console's Script Library gets the MVP catalog without manual
// paste. catalog.json is the machine index; script content/description are read from the actual
// files it points at. See script-library/README.md's mapping table and BACKLOG.md's 2026-09-15 entry.
const IMPORT_ACTOR = 'script-library-import';

interface CatalogEntry {
  id: string;
  name: string;
  path: string;
  script_type: ScriptType;
  category: string;
}

interface Catalog {
  scripts: CatalogEntry[];
}

function scriptLibraryRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // here = server/src/db -> up 3 levels reaches the repo root (server/src/db -> server/src -> server -> repo root).
  return path.resolve(here, '../../../script-library');
}

function extractDescription(fileContent: string, fallback: string): string {
  const match = fileContent.match(/^#\s*description:\s*(.*)$/m);
  const description = match?.[1]?.trim();
  return description && description.length > 0 ? description : fallback;
}

function scriptExists(name: string): boolean {
  const row = db.prepare('SELECT id FROM scripts WHERE name = ?').get(name);
  return row !== undefined;
}

export function importScriptLibrary(): { imported: number; skipped: number } {
  migrate();

  const root = scriptLibraryRoot();
  const catalog = JSON.parse(readFileSync(path.join(root, 'catalog.json'), 'utf-8')) as Catalog;

  let imported = 0;
  let skipped = 0;

  for (const entry of catalog.scripts) {
    if (scriptExists(entry.name)) {
      skipped++;
      continue;
    }

    const content = readFileSync(path.join(root, entry.path), 'utf-8');
    const description = extractDescription(content, entry.name);

    createScript(
      {
        name: entry.name,
        description,
        content,
        scriptType: entry.script_type,
        category: entry.category,
      },
      IMPORT_ACTOR,
    );
    imported++;
  }

  console.log(`[import-script-library] imported ${imported}, skipped ${skipped} (already present)`);
  return { imported, skipped };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  importScriptLibrary();
}
