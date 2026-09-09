-- CONFIG tables: reusable event content. NEVER touched by the event reset operation.

CREATE TABLE IF NOT EXISTS days (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL CHECK (key IN ('ai', 'azure', 'aws')),
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cyber_ranges (
  id INTEGER PRIMARY KEY,
  day_id INTEGER NOT NULL REFERENCES days(id),
  name TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('intermediate', 'advanced')),
  expected_duration_minutes INTEGER,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pressure_stages (
  id INTEGER PRIMARY KEY,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  label TEXT NOT NULL,
  trigger_seconds_remaining INTEGER NOT NULL,
  visual_style TEXT NOT NULL DEFAULT 'amber'
);

CREATE TABLE IF NOT EXISTS documentation_categories (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS topology_nodes (
  id INTEGER PRIMARY KEY,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  external_key TEXT NOT NULL,
  label TEXT NOT NULL,
  node_type TEXT NOT NULL,
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS topology_edges (
  id INTEGER PRIMARY KEY,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  from_node_id INTEGER NOT NULL REFERENCES topology_nodes(id),
  to_node_id INTEGER NOT NULL REFERENCES topology_nodes(id),
  label TEXT
);

CREATE TABLE IF NOT EXISTS scoring_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  leaderboard_enabled INTEGER NOT NULL DEFAULT 0,
  method_key TEXT NOT NULL DEFAULT 'sum_points',
  gamified_effect TEXT NOT NULL DEFAULT 'confetti_and_sound'
);

-- Live cloud environment integration (see docs/plans/live-cloud-environment.md history / PROGRESS.txt).
-- Generic secret store — used for both cloud Service Principal secrets and (future) VM login
-- credentials, so there is exactly one secret-handling code path (server/src/services/credential.service.ts)
-- rather than two. Never selected into any API response — see CLAUDE/invariants.md.
CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('service_principal', 'vm_login')),
  secret_ciphertext BLOB NOT NULL,
  secret_iv BLOB NOT NULL,
  secret_auth_tag BLOB NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  created_by_username TEXT,
  rotated_at TEXT
);

-- A registered live cloud environment (e.g. one Azure resource group). CONFIG because it's reusable
-- infrastructure registration, not tied to one event run. created_by_username is a denormalized
-- snapshot, not a FK, because `users` is a RUN table (see the CONFIG/RUN invariant).
CREATE TABLE IF NOT EXISTS cloud_environments (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('azure', 'aws')),
  name TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  external_scope TEXT,
  credential_id INTEGER NOT NULL REFERENCES credentials(id),
  default_vm_credential_id INTEGER REFERENCES credentials(id),
  config_json TEXT,
  discovery_mode TEXT NOT NULL DEFAULT 'on_demand' CHECK (discovery_mode IN ('on_demand', 'scheduled')),
  discovery_interval_minutes INTEGER,
  created_at TEXT NOT NULL,
  created_by_username TEXT
);

-- Which cyber range(s) a cloud environment backs. Both sides CONFIG.
CREATE TABLE IF NOT EXISTS cyber_range_environments (
  id INTEGER PRIMARY KEY,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  environment_id INTEGER NOT NULL REFERENCES cloud_environments(id),
  UNIQUE (cyber_range_id, environment_id)
);

-- One discovery run's status/history for a cloud environment. CONFIG — history of a CONFIG entity's
-- sync state must survive resets so "when did we last discover this environment" isn't lost every
-- training day. The partial unique index guarantees at most one queued/running run per environment
-- at a time (server/src/services/discovery/discovery.service.ts relies on the resulting UNIQUE
-- constraint violation to answer a second concurrent trigger with 409, not a race).
CREATE TABLE IF NOT EXISTS environment_discovery_runs (
  id INTEGER PRIMARY KEY,
  environment_id INTEGER NOT NULL REFERENCES cloud_environments(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'partial_failure', 'failed')) DEFAULT 'queued',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  triggered_by_username TEXT,
  resource_counts_json TEXT,
  errors_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_discovery_run
  ON environment_discovery_runs (environment_id) WHERE status IN ('queued', 'running');

-- Compliance/audit trail for environment + credential + access-session actions. CONFIG and never
-- touched by POST /api/admin/event/reset — see CLAUDE/invariants.md for why a compliance trail must
-- outlive the resets it may need to help investigate.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_username TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
