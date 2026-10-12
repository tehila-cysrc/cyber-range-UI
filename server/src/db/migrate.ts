import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './index.js';
import { publishTopology } from '../services/topologyPublication.service.js';

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

// topology_edges predates from_zone_id/to_zone_id and had NOT NULL from_node_id/to_node_id. SQLite
// can't relax a NOT NULL constraint or add a CHECK via plain ALTER TABLE, so a database created before
// the logical-topology redesign needs the table rebuilt once. Guarded by the presence of from_zone_id
// so re-running migrate() is a no-op on an already-migrated database (this codebase's convention).
function relaxTopologyEdgesForZones() {
  const columns = db.prepare(`PRAGMA table_info(topology_edges)`).all() as { name: string }[];
  if (columns.some((c) => c.name === 'from_zone_id')) return;

  db.exec(`
    CREATE TABLE topology_edges_new (
      id INTEGER PRIMARY KEY,
      cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
      from_node_id INTEGER REFERENCES topology_nodes(id),
      to_node_id INTEGER REFERENCES topology_nodes(id),
      from_zone_id INTEGER REFERENCES topology_zones(id),
      to_zone_id INTEGER REFERENCES topology_zones(id),
      label TEXT,
      external_key TEXT,
      relation_type TEXT,
      environment_id INTEGER REFERENCES cloud_environments(id),
      discovery_run_id INTEGER REFERENCES environment_discovery_runs(id),
      CHECK ((from_node_id IS NOT NULL) != (from_zone_id IS NOT NULL)),
      CHECK ((to_node_id IS NOT NULL) != (to_zone_id IS NOT NULL))
    );
    INSERT INTO topology_edges_new (id, cyber_range_id, from_node_id, to_node_id, label, external_key, relation_type, environment_id, discovery_run_id)
      SELECT id, cyber_range_id, from_node_id, to_node_id, label, external_key, relation_type, environment_id, discovery_run_id FROM topology_edges;
    DROP TABLE topology_edges;
    ALTER TABLE topology_edges_new RENAME TO topology_edges;
  `);
}

// access_sessions predates instructor-initiated Connect and had NOT NULL team_id. SQLite can't relax
// a NOT NULL constraint via plain ALTER TABLE, so a database created before instructor Connect needs
// the table rebuilt once, same approach as relaxTopologyEdgesForZones above. Guarded by checking
// PRAGMA table_info's notnull flag so re-running migrate() is a no-op once already relaxed.
function relaxAccessSessionsTeamId() {
  const columns = db.prepare(`PRAGMA table_info(access_sessions)`).all() as { name: string; notnull: number }[];
  const teamIdColumn = columns.find((c) => c.name === 'team_id');
  if (!teamIdColumn || teamIdColumn.notnull === 0) return;

  db.exec(`
    CREATE TABLE access_sessions_new (
      id INTEGER PRIMARY KEY,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
      topology_node_id INTEGER NOT NULL REFERENCES topology_nodes(id),
      protocol TEXT NOT NULL,
      broker_connection_id TEXT,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      expires_at TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('active', 'completed', 'expired', 'denied', 'error', 'force_closed')),
      denial_reason TEXT,
      client_ip TEXT
    );
    INSERT INTO access_sessions_new SELECT * FROM access_sessions;
    DROP TABLE access_sessions;
    ALTER TABLE access_sessions_new RENAME TO access_sessions;
  `);
}

// scores predates auto-credited ATT&CK detections: awarded_by_user_id was NOT NULL (every award came
// from an instructor) and there was no source column. A system award has no instructor, so a database
// created before the MITRE TTP feature needs the table rebuilt once, same approach as
// relaxAccessSessionsTeamId above. Guarded by the source column's presence so re-running is a no-op.
// Runs right after run.sql, before any ttp_detections row can reference a score.
function relaxScoresForTtpAwards() {
  const columns = db.prepare(`PRAGMA table_info(scores)`).all() as { name: string }[];
  if (columns.some((c) => c.name === 'source')) return;

  // One transaction: a crash between DROP and RENAME must never lose the scores table.
  db.exec(`
    BEGIN;
    CREATE TABLE scores_new (
      id INTEGER PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      student_user_id INTEGER REFERENCES users(id),
      documentation_entry_id INTEGER REFERENCES documentation_entries(id),
      cyber_range_id INTEGER REFERENCES cyber_ranges(id),
      points INTEGER NOT NULL,
      is_gamified INTEGER NOT NULL DEFAULT 0,
      awarded_by_user_id INTEGER REFERENCES users(id),
      note TEXT,
      created_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ttp'))
    );
    INSERT INTO scores_new (id, team_id, student_user_id, documentation_entry_id, cyber_range_id, points, is_gamified, awarded_by_user_id, note, created_at)
      SELECT id, team_id, student_user_id, documentation_entry_id, cyber_range_id, points, is_gamified, awarded_by_user_id, note, created_at FROM scores;
    DROP TABLE scores;
    ALTER TABLE scores_new RENAME TO scores;
    COMMIT;
  `);
}

// RBAC (accounts): every staff row of the active run that predates the accounts table becomes an
// `admin` account, so nobody loses access on upgrade — today every instructor is a full admin. Runs
// once (only while `accounts` is empty), in one transaction. The membership row keeps its id (every
// FK to it stays valid) but no longer holds a password: staff sign in through `accounts`.
function backfillStaffAccounts() {
  const hasAccounts = db.prepare('SELECT 1 FROM accounts LIMIT 1').get();
  if (hasAccounts) return;
  const staff = db
    .prepare(
      `SELECT u.id, u.username, u.password, u.display_name AS displayName, u.avatar
       FROM users u JOIN event_runs r ON r.id = u.event_run_id
       WHERE r.is_active = 1 AND u.role = 'instructor' AND u.deactivated_at IS NULL AND u.account_id IS NULL
       ORDER BY u.id`,
    )
    .all() as { id: number; username: string; password: string; displayName: string; avatar: string | null }[];
  if (staff.length === 0) return;

  db.exec('BEGIN');
  try {
    const now = new Date().toISOString();
    for (const s of staff) {
      // Two staff rows differing only in letter case collapse onto the first one's account.
      const existing = db.prepare('SELECT id FROM accounts WHERE username = ?').get(s.username) as { id: number } | undefined;
      const accountId =
        existing?.id ??
        Number(
          db
            .prepare(
              `INSERT INTO accounts (username, password, role, display_name, avatar, created_at)
               VALUES (?, ?, 'admin', ?, ?, ?)`,
            )
            .run(s.username, s.password, s.displayName, s.avatar, now).lastInsertRowid,
        );
      db.prepare("UPDATE users SET account_id = ?, password = '' WHERE id = ?").run(accountId, s.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`[migrate] ${staff.length} instructor account(s) moved to accounts as admin`);
}

// Created after the backfill so old rows never trip them. users.role 'instructor' now only marks a
// staff membership row; the real role is accounts.role.
function addStaffMembershipGuards() {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_run_account
      ON users (event_run_id, account_id) WHERE account_id IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS trg_users_account_insert
    BEFORE INSERT ON users
    WHEN (NEW.role = 'instructor' AND NEW.account_id IS NULL) OR (NEW.role = 'student' AND NEW.account_id IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'a staff users row needs account_id and a student row must not have one');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_users_account_update
    BEFORE UPDATE OF role, account_id ON users
    WHEN (NEW.role = 'instructor' AND NEW.account_id IS NULL) OR (NEW.role = 'student' AND NEW.account_id IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'a staff users row needs account_id and a student row must not have one');
    END;
  `);
}

export function migrate() {
  // Must be read before config.sql creates the table — the one-time backfill below depends on it.
  const hadTopologyPublications = !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cyber_range_topology_publications'")
    .get();

  // Order matters: run.sql's foreign keys reference config.sql's tables.
  runSchemaFile('schema/config.sql');
  runSchemaFile('schema/run.sql');

  // Additive columns for discovered (vs. manually-drawn) topology — see the live-cloud-environment
  // plan. NULL environment_id/discovery_run_id = today's manually-drawn nodes, untouched by discovery.
  addColumnIfMissing('topology_nodes', 'environment_id', 'INTEGER REFERENCES cloud_environments(id)');
  // Instructor-issued join code for student self-registration; NULL = registration closed (default,
  // and again after every event reset since it lives on the run row). See registration.service.ts.
  addColumnIfMissing('event_runs', 'registration_code', 'TEXT');
  addColumnIfMissing('topology_nodes', 'discovery_run_id', 'INTEGER REFERENCES environment_discovery_runs(id)');
  addColumnIfMissing('topology_edges', 'external_key', 'TEXT');
  addColumnIfMissing('topology_edges', 'relation_type', 'TEXT');
  addColumnIfMissing('topology_edges', 'environment_id', 'INTEGER REFERENCES cloud_environments(id)');
  addColumnIfMissing('topology_edges', 'discovery_run_id', 'INTEGER REFERENCES environment_discovery_runs(id)');

  // Logical-topology redesign: zones are the visual grouping container (one per Azure subnet, or
  // hand-added); node_type 'vnet'/'subnet' rows from older discovery runs are superseded by zones —
  // see discovery/azureDiscoveryProvider.ts. role/is_visible_to_students are write-once-then-preserved
  // across re-discovery, same pattern as pos_x/pos_y, so instructor edits survive a re-run.
  addColumnIfMissing('topology_nodes', 'zone_id', 'INTEGER REFERENCES topology_zones(id)');
  addColumnIfMissing('topology_nodes', 'role', 'TEXT');
  addColumnIfMissing('topology_nodes', 'is_visible_to_students', 'INTEGER NOT NULL DEFAULT 1');
  // Manually set by the instructor for now (running|starting|stopping|stopped|error|null=unknown) — a
  // future discovery enhancement could sync this from the VM's live Azure power state automatically.
  addColumnIfMissing('topology_nodes', 'status', 'TEXT');
  relaxTopologyEdgesForZones();
  relaxAccessSessionsTeamId();

  // Phase 2 (Bastion Shareable Link Connect + Key Vault credentials). bastion_host_id/key_vault_uri
  // are auto-populated by discovery (first Bastion host / Key Vault found in the environment's scope
  // — see azureDiscoveryProvider.ts), not instructor-entered. key_vault_secret_name is the new
  // credential-storage path for a node's VM login secret; NULL means it still uses the older local
  // credential_id path (kept working for manual-only cyber ranges with no Azure environment at all).
  addColumnIfMissing('cloud_environments', 'bastion_host_id', 'TEXT');
  addColumnIfMissing('cloud_environments', 'key_vault_uri', 'TEXT');
  addColumnIfMissing('access_targets', 'key_vault_secret_name', 'TEXT');
  // Plain (non-secret) username, stored alongside key_vault_secret_name — only the password needs
  // Key Vault; a username isn't sensitive and storing it there too would mean parsing a structured
  // value out of a KV secret for no real benefit.
  addColumnIfMissing('access_targets', 'username', 'TEXT');
  // Soft on/off for student Connect: off hides the button without deleting the Key Vault login, so
  // the instructor can re-enable a JUMP box without re-entering the password. Existing rows stay on.
  addColumnIfMissing('access_targets', 'is_enabled', 'INTEGER NOT NULL DEFAULT 1');

  // Optional screenshot/evidence attached to a documentation entry — stored inline as a data: URL
  // rather than on disk/blob storage, matching this app's low-scale internal-tool scope.
  addColumnIfMissing('documentation_entries', 'image_data_url', 'TEXT');

  // Optional free-text "what do you need?" from the student on a help request — student→instructor
  // only; the system still never attaches a hint (see CLAUDE/invariants.md).
  addColumnIfMissing('help_requests', 'message', 'TEXT');

  // Instructor-written mission briefing shown to students on Home (UX-08). Plain instructor text — the
  // system never generates it, so the "no automatic hints" rule still holds.
  addColumnIfMissing('cyber_ranges', 'student_briefing', 'TEXT');
  // Entries written after the team's time ran out are still accepted but flagged (UX-04, decided
  // 2026-09-24). Set once, server-side, at insert time.
  addColumnIfMissing('documentation_entries', 'after_time_limit', 'INTEGER NOT NULL DEFAULT 0');

  // Soft-hide, never hard-delete: a Cyber Range can carry real history (team_cyber_range_progress/
  // documentation_entries/scores all FK to it, enforced — see PRAGMA foreign_keys in db/index.ts), so
  // a range with any history can't be deleted without destroying that history. is_active=0 removes it
  // from the picker lists (GET /cyber-ranges) without touching anything that already references it.
  addColumnIfMissing('cyber_ranges', 'is_active', 'INTEGER NOT NULL DEFAULT 1');

  // MITRE TTP feature. started_at is overwritten on every (re)start, so it can't anchor an MTTD window
  // after a pause/switch-back; first_started_at is set once, on the progress row's first insert, and
  // kept by startCyberRangeForTeam's ON CONFLICT clause. Backfilled from started_at for existing rows.
  addColumnIfMissing('team_cyber_range_progress', 'first_started_at', 'TEXT');
  db.exec(
    `UPDATE team_cyber_range_progress SET first_started_at = started_at
     WHERE first_started_at IS NULL AND started_at IS NOT NULL`,
  );
  // Set once, on the first "complete" (never cleared by a restart): the ATT&CK debrief may reveal the
  // answer key from then on, so tags made after it never auto-score (ttpScoring.service.ts).
  addColumnIfMissing('team_cyber_range_progress', 'first_completed_at', 'TEXT');

  // Each team optionally belongs to one organization. Deleting an organization un-assigns its teams
  // (SET NULL) — it never deletes teams or their event history.
  addColumnIfMissing('teams', 'organization_id', 'INTEGER REFERENCES organizations(id) ON DELETE SET NULL');
  // Optional preset avatar key (services/avatar.service.ts); NULL keeps the initials circle.
  addColumnIfMissing('users', 'avatar', 'TEXT');
  // Set instead of deleting a student whose account authored team activity (DELETE /admin/users/:id).
  addColumnIfMissing('users', 'deactivated_at', 'TEXT');
  db.exec(
    `UPDATE team_cyber_range_progress SET first_completed_at = completed_at
     WHERE first_completed_at IS NULL AND completed_at IS NOT NULL`,
  );
  relaxScoresForTtpAwards();

  // RBAC: staff identities live in accounts (CONFIG); see backfillStaffAccounts.
  addColumnIfMissing('users', 'account_id', 'INTEGER REFERENCES accounts(id)');
  // Who acted in which role, for which organization/scenario, and whether it was allowed. Snapshot
  // values, never FKs (audit_log is CONFIG and outlives the RUN rows it describes).
  addColumnIfMissing('audit_log', 'actor_account_id', 'INTEGER');
  addColumnIfMissing('audit_log', 'actor_role', 'TEXT');
  addColumnIfMissing('audit_log', 'organization_id', 'INTEGER');
  addColumnIfMissing('audit_log', 'cyber_range_id', 'INTEGER');
  addColumnIfMissing('audit_log', 'outcome', "TEXT NOT NULL DEFAULT 'allowed'");
  addColumnIfMissing('audit_log', 'client_ip', 'TEXT');
  backfillStaffAccounts();
  addStaffMembershipGuards();

  // Topology publishing (UX-38) arrived after ranges already had student-visible topology. Publish
  // each such range's current student view exactly once, when the table is first created, so nothing
  // disappears from students' screens on upgrade. Never re-run: after this, only the instructor publishes.
  if (!hadTopologyPublications) {
    const ranges = db
      .prepare('SELECT DISTINCT cyber_range_id AS id FROM topology_nodes WHERE is_visible_to_students = 1')
      .all() as { id: number }[];
    for (const { id } of ranges) publishTopology(id, 'migration');
  }

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
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_topology_zones_external_key
       ON topology_zones (cyber_range_id, external_key) WHERE external_key IS NOT NULL`,
  );

  console.log('[migrate] schema applied');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  migrate();
}
