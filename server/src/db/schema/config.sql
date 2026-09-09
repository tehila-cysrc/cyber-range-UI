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
