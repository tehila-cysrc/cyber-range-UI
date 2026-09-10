-- RUN tables: per-event data. Wiped entirely by POST /api/admin/event/reset.
-- Everything cascades from event_runs (directly, or transitively via teams/users),
-- so no CONFIG table may ever gain a foreign key into this file.

CREATE TABLE IF NOT EXISTS event_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  reset_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  event_run_id INTEGER NOT NULL REFERENCES event_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  event_run_id INTEGER NOT NULL REFERENCES event_runs(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'instructor')),
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  UNIQUE (event_run_id, username)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_cyber_range_progress (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  status TEXT NOT NULL CHECK (status IN ('not_started', 'active', 'paused', 'completed')) DEFAULT 'not_started',
  started_at TEXT,
  completed_at TEXT,
  time_limit_seconds INTEGER,
  current_pressure_stage_id INTEGER REFERENCES pressure_stages(id),
  UNIQUE (team_id, cyber_range_id)
);

CREATE TABLE IF NOT EXISTS documentation_entries (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER REFERENCES documentation_categories(id),
  body TEXT NOT NULL,
  is_important_finding INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  student_user_id INTEGER REFERENCES users(id),
  documentation_entry_id INTEGER REFERENCES documentation_entries(id),
  cyber_range_id INTEGER REFERENCES cyber_ranges(id),
  points INTEGER NOT NULL,
  is_gamified INTEGER NOT NULL DEFAULT 0,
  awarded_by_user_id INTEGER NOT NULL REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS help_requests (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  cyber_range_id INTEGER REFERENCES cyber_ranges(id),
  requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')) DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by_user_id INTEGER REFERENCES users(id)
);

-- A live/completed student browser-access session (Phase 4). RUN — tied to one team/student/event
-- run, same shape as help_requests/scores (a RUN row FK-ing CONFIG rows, e.g. cyber_range_id,
-- topology_node_id, is the established pattern here). A summary is also written to the CONFIG-scoped
-- audit_log at request/deny/end time, so "who accessed what, when" survives an event reset for
-- compliance purposes even though this richer operational record doesn't — see CLAUDE/invariants.md.
CREATE TABLE IF NOT EXISTS access_sessions (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  topology_node_id INTEGER NOT NULL REFERENCES topology_nodes(id),
  protocol TEXT NOT NULL,
  broker_connection_id TEXT, -- unused since the Phase 2 Bastion Shareable Link redesign; kept, not dropped, for old rows
  requested_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  expires_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('active', 'completed', 'expired', 'denied', 'error', 'force_closed')),
  denial_reason TEXT,
  client_ip TEXT
);

-- An instructor-triggered Azure VM Run Command invocation (Phase 3). RUN — an execution is tied to
-- one live event/instructor action, same lifecycle as access_sessions, not reusable infrastructure
-- (the reusable part, if any, is the linked `scripts` library row, which is CONFIG). script_id is
-- nullable: a "write manually, don't save" run has no library entry at all. script_content is
-- deliberately NOT a column here — per the approved topology-redesign plan, a script may embed
-- credentials/tokens an instructor is testing against, so the execution log stores only a hash
-- (dedup/reference) plus safe, truncated result metadata. For a library-backed run, the actual content
-- remains recoverable via script_id -> scripts.content for as long as that library entry exists; for an
-- ad hoc run, only the hash survives, by design.
CREATE TABLE IF NOT EXISTS script_executions (
  id INTEGER PRIMARY KEY,
  topology_node_id INTEGER NOT NULL REFERENCES topology_nodes(id),
  script_id INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
  script_type TEXT NOT NULL CHECK (script_type IN ('powershell', 'bash')),
  script_hash TEXT NOT NULL,
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')) DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  output_excerpt TEXT,
  error_text TEXT
);
-- At most one running execution per node at a time, mirroring Azure's own one-action-at-a-time
-- constraint on a VM — same DB-enforced single-flight pattern as idx_one_active_discovery_run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_running_script_per_node
  ON script_executions (topology_node_id) WHERE status = 'running';
