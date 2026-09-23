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
  -- NULL = a system award (source = 'ttp', an auto-credited ATT&CK detection) — see migrate.ts's
  -- relaxScoresForTtpAwards for why this was originally NOT NULL.
  awarded_by_user_id INTEGER REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ttp'))
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
  -- NULL = an instructor's own diagnostic Connect (not tied to any team) — see migrate.ts's
  -- relaxAccessSessionsTeamId for why this was originally NOT NULL.
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
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

-- Investigation Canvas: a per-team, per-cyber-range freeform node/edge board — the graphical
-- counterpart to documentation_entries' Timeline, not a replacement for it. Student-authored, RUN-
-- scoped (team_id cascades from event_runs via teams), same authorship model as documentation_entries:
-- students build it, instructors only view it (team-picker, never author). Unlike documentation_entries
-- (append-only), nodes/edges here are dragged/renamed/deleted in place, so both tables carry a real
-- PATCH/DELETE surface and an updated_at column. Normalized rows (not a single JSON blob per team+range)
-- so two teammates dragging different nodes at the same moment never race on one read-modify-write.
CREATE TABLE IF NOT EXISTS investigation_canvas_nodes (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  node_type TEXT NOT NULL, -- 'entry'|'system'|'evidence'|'finding'|'decision'|'action'|'impact', free text (no CHECK), same precedent as topology_nodes.node_type
  label TEXT NOT NULL,
  body TEXT,
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  metadata_json TEXT, -- opaque/variable extra data only, same role as topology_nodes.metadata_json
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
  -- Future extensibility (NOT built now): a nullable linked_documentation_entry_id
  -- REFERENCES documentation_entries(id), added later via migrate.ts's addColumnIfMissing, once
  -- "link a canvas node to a Timeline finding" is actually designed.
);

-- Edges are always node-to-node here (no zone-boundary concept — this isn't a network diagram).
-- team_id/cyber_range_id are duplicated onto the edge row rather than derived via a join on every
-- read, same denormalization precedent as topology_edges.cyber_range_id.
CREATE TABLE IF NOT EXISTS investigation_canvas_edges (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  from_node_id INTEGER NOT NULL REFERENCES investigation_canvas_nodes(id),
  to_node_id INTEGER NOT NULL REFERENCES investigation_canvas_nodes(id),
  label TEXT,
  created_at TEXT NOT NULL,
  CHECK (from_node_id != to_node_id)
);
-- DB-enforced belt-and-suspenders (app-level checks live in investigationCanvas.routes.ts): no
-- self-loop (CHECK above) and no duplicate edge between the same ordered pair. A->B and B->A are
-- distinct edges (e.g. "escalated to" vs "reported by" can legitimately run both ways) — only an
-- exact repeat of the same direction is blocked.
CREATE UNIQUE INDEX IF NOT EXISTS idx_investigation_canvas_edges_unique_pair
  ON investigation_canvas_edges (from_node_id, to_node_id);

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

-- MITRE ATT&CK tagging + scoring (see the MITRE TTP plan / CLAUDE/db.md). All three tables are RUN:
-- they cascade away on event reset while the expected-TTP definitions (CONFIG) survive.

-- A student's optional technique tag on a Timeline entry. Soft-removed (removed_at) rather than
-- deleted, so the tag history survives un-tagging: incorrect associations can't be hidden, and the
-- anti-guessing budget counts every distinct technique a team ever tried. team_id/cyber_range_id are
-- denormalized off the entry, same precedent as investigation_canvas_edges.
CREATE TABLE IF NOT EXISTS documentation_entry_ttps (
  id INTEGER PRIMARY KEY,
  documentation_entry_id INTEGER NOT NULL REFERENCES documentation_entries(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  technique_id TEXT NOT NULL,
  tagged_by_user_id INTEGER NOT NULL REFERENCES users(id),
  tagged_at TEXT NOT NULL,
  removed_at TEXT,
  removed_by_user_id INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entry_ttps_one_active_per_technique
  ON documentation_entry_ttps (documentation_entry_id, technique_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entry_ttps_team_range ON documentation_entry_ttps (team_id, cyber_range_id);

-- When an expected technique actually happened in the range — recorded automatically when its
-- trigger script succeeds (script_executions) or manually by the instructor ("Mark occurred", e.g. for
-- the external AI Agent Simulator). Per scenario, not per team: every team on the range shares its
-- environment. Feeds MTTD ONLY — recording an occurrence never creates, changes or gates a credit.
-- event_run_id gives manual rows a cascade path on reset (script-backed rows also cascade via
-- script_executions).
CREATE TABLE IF NOT EXISTS ttp_occurrences (
  id INTEGER PRIMARY KEY,
  event_run_id INTEGER NOT NULL REFERENCES event_runs(id) ON DELETE CASCADE,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  expected_ttp_id INTEGER NOT NULL REFERENCES cyber_range_expected_ttps(id),
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('script_execution', 'manual')),
  script_execution_id INTEGER REFERENCES script_executions(id) ON DELETE CASCADE,
  recorded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ttp_occurrences_expected ON ttp_occurrences (expected_ttp_id);

-- The credit record: a team correctly identified an expected technique. Persisted (not derived from
-- tags) because a credit is locked once awarded — live feedback already told the team they scored,
-- and later tag edits must not move points or the detection time. points_awarded is a snapshot, so an
-- instructor editing the expectation's points later never rewrites history. The paired scores row
-- (source='ttp') is what the leaderboard/totals actually sum.
CREATE TABLE IF NOT EXISTS ttp_detections (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  cyber_range_id INTEGER NOT NULL REFERENCES cyber_ranges(id),
  expected_ttp_id INTEGER NOT NULL REFERENCES cyber_range_expected_ttps(id),
  documentation_entry_ttp_id INTEGER REFERENCES documentation_entry_ttps(id) ON DELETE SET NULL,
  documentation_entry_id INTEGER REFERENCES documentation_entries(id) ON DELETE SET NULL,
  credited_user_id INTEGER REFERENCES users(id),
  detected_at TEXT NOT NULL,
  points_awarded INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto', 'instructor')),
  status TEXT NOT NULL CHECK (status IN ('credited', 'voided')) DEFAULT 'credited',
  voided_at TEXT,
  voided_by_user_id INTEGER REFERENCES users(id),
  void_reason TEXT,
  score_id INTEGER REFERENCES scores(id) ON DELETE SET NULL,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
-- DB-enforced "a technique awards its points once per team" — replays, races and duplicate tags all
-- land on this constraint rather than double-awarding.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ttp_detections_one_credit
  ON ttp_detections (team_id, cyber_range_id, expected_ttp_id) WHERE status = 'credited';
