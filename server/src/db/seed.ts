import { fileURLToPath } from 'node:url';
import { db } from './index.js';
import { migrate } from './migrate.js';
import { ensureInitialAdmin, ensureStaffMembership, getAccount } from '../services/accounts.service.js';

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

// No sample scenarios (UX-37, decided 2026-09-24): the old placeholders (TJS, "Azure Range - …")
// confused new instructors. Scenarios are created on the Scenarios page ("New scenario") or together
// with an environment on the Environments page.

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

// Creates a new active, empty event_runs row (registration closed). Shared by the dev seed script and
// the event-reset endpoint (server/src/routes/admin/event.routes.ts). Staff accounts live in CONFIG
// (`accounts`) and survive the reset; their membership row in the new run is created at sign-in, so a
// reset never (re)creates a login — in particular never `instructor`/`instructor123`.
export function createFreshEventRun(): number {
  return db
    .prepare('INSERT INTO event_runs (started_at, is_active) VALUES (?, 1)')
    .run(nowIso()).lastInsertRowid as number;
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

  // Sign-in would create these anyway; the demo run has them up front so fixtures can reference staff.
  const accounts = db.prepare('SELECT id FROM accounts WHERE disabled_at IS NULL ORDER BY id').all() as { id: number }[];
  for (const { id } of accounts) ensureStaffMembership(getAccount(id)!);

  console.log(`[seed] created event run ${runId} with 2 demo teams and 4 students (student123 logins)`);
}

export function seed() {
  migrate();
  seedDays();
  seedDocumentationCategories();
  seedScoringConfig();
  const admin = ensureInitialAdmin();
  if (admin.created) {
    console.log(
      `[seed] created admin account "${admin.username}"` +
        (process.env.INITIAL_ADMIN_PASSWORD ? ' (password from INITIAL_ADMIN_PASSWORD)' : ' with the documented dev password — change it'),
    );
  }
  seedDemoRunData();
  console.log('[seed] done');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  seed();
}
