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
