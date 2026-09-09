import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function runSchemaFile(relativePath: string) {
  const sql = readFileSync(join(__dirname, relativePath), 'utf-8');
  db.exec(sql);
}

// SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so additive columns on tables that
// pre-date this column can't just live as a plain ALTER TABLE statement in config.sql/run.sql —
// running migrate() a second time would fail with "duplicate column name". This guard makes that
// safe, matching this codebase's "re-running migrate/seed is always safe" convention.
function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function migrate() {
  // Order matters: run.sql's foreign keys reference config.sql's tables.
  runSchemaFile('schema/config.sql');
  runSchemaFile('schema/run.sql');

  // Additive columns for discovered (vs. manually-drawn) topology — see the live-cloud-environment
  // plan. NULL environment_id/discovery_run_id = today's manually-drawn nodes, untouched by discovery.
  addColumnIfMissing('topology_nodes', 'environment_id', 'INTEGER REFERENCES cloud_environments(id)');
  addColumnIfMissing('topology_nodes', 'discovery_run_id', 'INTEGER REFERENCES environment_discovery_runs(id)');
  addColumnIfMissing('topology_edges', 'external_key', 'TEXT');
  addColumnIfMissing('topology_edges', 'relation_type', 'TEXT');
  addColumnIfMissing('topology_edges', 'environment_id', 'INTEGER REFERENCES cloud_environments(id)');
  addColumnIfMissing('topology_edges', 'discovery_run_id', 'INTEGER REFERENCES environment_discovery_runs(id)');

  // Optional screenshot/evidence attached to a documentation entry — stored inline as a data: URL
  // rather than on disk/blob storage, matching this app's low-scale internal-tool scope.
  addColumnIfMissing('documentation_entries', 'image_data_url', 'TEXT');

  // external_key is the Azure ARM resource id for discovered nodes/edges — globally unique per
  // cyber range, so a safe upsert target for re-running discovery (INSERT ... ON CONFLICT DO UPDATE)
  // instead of delete-and-recreate.
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_topology_nodes_external_key
       ON topology_nodes (cyber_range_id, external_key) WHERE external_key IS NOT NULL`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_topology_edges_external_key
       ON topology_edges (cyber_range_id, external_key) WHERE external_key IS NOT NULL`,
  );

  console.log('[migrate] schema applied');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  migrate();
}
