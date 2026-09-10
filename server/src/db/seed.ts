import { fileURLToPath } from 'node:url';
import { db } from './index.js';
import { migrate } from './migrate.js';

function nowIso() {
  return new Date().toISOString();
}

// 'other' is the catch-all category and must always render last in the dropdown — a plain
// incrementing sort_order breaks this the moment any category (seeded later, or free-typed via
// documentation.routes.ts#findOrCreateCategoryId) is added afterward, since that logic assigns
// MAX(sort_order)+1. A high sentinel keeps 'other' last no matter how many categories accumulate.
export const OTHER_CATEGORY_SORT_ORDER = 9999;

function seedDays() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO days (key, label, sort_order) VALUES (?, ?, ?)',
  );
  insert.run('ai', 'AI', 1);
  insert.run('azure', 'Azure', 2);
  insert.run('aws', 'AWS', 3);
}

function dayId(key: string): number {
  const row = db.prepare('SELECT id FROM days WHERE key = ?').get(key) as { id: number };
  return row.id;
}

function seedCyberRanges() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM cyber_ranges').get() as { n: number };
  if (existing.n > 0) return;

  const insert = db.prepare(
    `INSERT INTO cyber_ranges (day_id, name, difficulty, expected_duration_minutes, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
  );
  insert.run(dayId('ai'), 'TJS', 'advanced', 180, 1);
  insert.run(dayId('azure'), 'Azure Range - Intermediate', 'intermediate', 60, 1);
  insert.run(dayId('azure'), 'Azure Range - Advanced', 'advanced', 180, 2);
  insert.run(dayId('aws'), 'AWS Range - Intermediate', 'intermediate', null, 1);
  insert.run(dayId('aws'), 'AWS Range - Advanced', 'advanced', null, 2);
}

function seedDocumentationCategories() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO documentation_categories (key, label, sort_order, active) VALUES (?, ?, ?, 1)',
  );
  const categories: [string, string][] = [
    ['recon', 'Recon'],
    ['exploitation', 'Exploitation'],
    ['persistence', 'Persistence'],
    ['lateral_movement', 'Lateral Movement'],
    ['exfiltration', 'Exfiltration'],
    ['ioc', 'Indicator of Compromise (IOC)'],
    ['other', 'Other'],
  ];
  // 'other' always sorts last, regardless of how many categories (seeded or free-typed via
  // findOrCreateCategoryId) come after it — see the matching comment there.
  categories.forEach(([key, label], i) => insert.run(key, label, key === 'other' ? OTHER_CATEGORY_SORT_ORDER : i + 1));
}

function seedScoringConfig() {
  db.prepare(
    `INSERT OR IGNORE INTO scoring_config (id, leaderboard_enabled, method_key, gamified_effect)
     VALUES (1, 0, 'sum_points', 'confetti_and_sound')`,
  ).run();
}

export function getActiveEventRunId(): number | null {
  const row = db.prepare('SELECT id FROM event_runs WHERE is_active = 1').get() as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

export const DEFAULT_INSTRUCTOR_USERNAME = 'instructor';
export const DEFAULT_INSTRUCTOR_PASSWORD = 'instructor123';

// Creates a new active event_runs row with exactly one instructor account — the minimum needed for
// the system to be usable (someone has to be able to log in to create the new cohort's teams/
// students). Shared by the dev seed script and the event-reset endpoint (server/src/routes/
// admin/event.routes.ts) so both leave the system in the same "ready to configure" state.
export function createFreshEventRun(): number {
  const runId = db
    .prepare('INSERT INTO event_runs (started_at, is_active) VALUES (?, 1)')
    .run(nowIso()).lastInsertRowid as number;

  db.prepare(
    `INSERT INTO users (event_run_id, username, password, role, team_id, display_name)
     VALUES (?, ?, ?, 'instructor', NULL, 'Instructor')`,
  ).run(runId, DEFAULT_INSTRUCTOR_USERNAME, DEFAULT_INSTRUCTOR_PASSWORD);

  return runId;
}

function seedDemoRunData() {
  if (getActiveEventRunId() !== null) {
    console.log('[seed] an active event run already exists — skipping demo teams/users');
    return;
  }

  const runId = createFreshEventRun();

  const insertTeam = db.prepare(
    'INSERT INTO teams (event_run_id, name, sort_order) VALUES (?, ?, ?)',
  );
  const teamAlphaId = insertTeam.run(runId, 'Team Alpha', 1).lastInsertRowid as number;
  const teamBravoId = insertTeam.run(runId, 'Team Bravo', 2).lastInsertRowid as number;

  const insertUser = db.prepare(
    `INSERT INTO users (event_run_id, username, password, role, team_id, display_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertUser.run(runId, 'alice', 'student123', 'student', teamAlphaId, 'Alice');
  insertUser.run(runId, 'bob', 'student123', 'student', teamAlphaId, 'Bob');
  insertUser.run(runId, 'carol', 'student123', 'student', teamBravoId, 'Carol');
  insertUser.run(runId, 'dave', 'student123', 'student', teamBravoId, 'Dave');

  console.log(
    `[seed] created event run ${runId} with 2 demo teams and 5 users (instructor/student123 logins)`,
  );
}

export function seed() {
  migrate();
  seedDays();
  seedCyberRanges();
  seedDocumentationCategories();
  seedScoringConfig();
  seedDemoRunData();
  console.log('[seed] done');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  seed();
}
