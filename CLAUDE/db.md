# DB

SQLite via Node's built-in `node:sqlite` (`DatabaseSync`) — see `CLAUDE/services.md` for why this replaced the originally-planned `better-sqlite3`. File: `server/data/cyber-range.db` (gitignored), path from `.env` `DB_PATH` (relative to `server/`).

## Schema philosophy: CONFIG vs RUN

Schema is split into two files, applied in order by `server/src/db/migrate.ts`:

- **`server/src/db/schema/config.sql`** — reusable content. **Never touched by the event-reset operation.** `days`, `cyber_ranges`, `pressure_stages`, `documentation_categories`, `topology_nodes`, `topology_edges`, `scoring_config`, `credentials`, `cloud_environments`, `cyber_range_environments`, `audit_log`.
- **`server/src/db/schema/run.sql`** — per-event data. **Wiped by `POST /api/admin/event/reset`** (not yet built — planned Phase 9). Everything cascades from `event_runs` via `ON DELETE CASCADE`: `event_runs`, `teams`, `users`, `auth_tokens`, `team_cyber_range_progress`, `documentation_entries`, `scores`, `help_requests`.

> **Invariant:** no CONFIG table may ever gain a foreign key into a RUN table. This is what makes the reset operation safe by construction — if you're adding a new table, decide CONFIG vs RUN first and put it in the matching file.

## Key relationships

- `cyber_ranges.day_id -> days.id` — the reusable scenario catalog (seeded from PRD §9: AI/TJS advanced 180min, Azure intermediate 60min + advanced 180min, AWS intermediate + advanced with `expected_duration_minutes = NULL`, admin sets later).
- `team_cyber_range_progress` — one row per (team, cyber_range), tracks live status/timing. This is where "which range is a team currently doing, and how much time is left" lives — NOT on `teams` or `cyber_ranges` directly, because a team's progress is per-run state.
- `scores` — instructor-awarded points. `student_user_id` nullable = team-level award; `documentation_entry_id` nullable = standalone scoring event not tied to a specific doc entry. **There is no separate `milestones` table** — the PRD's US-007 replaced automatic milestones with free-form instructor scoring directly on student documentation (individual + team attribution). Leaderboard/individual/team totals are always **computed** (`SUM(points) GROUP BY ...`), never stored redundantly.
- `users.password` is **plaintext, by explicit decision** — this is a low-stakes internal training tool, not public-internet-facing. Do not "fix" this into a hashed scheme without checking with the user first; it was an explicit tradeoff, not an oversight.
- `auth_tokens` — opaque bearer tokens (not sessions/cookies), looked up by `server/src/middleware/auth.ts`.
- `credentials` / `cloud_environments` / `cyber_range_environments` / `audit_log` — live cloud environment integration (Phase 1: registration + connectivity check; see `PROGRESS.txt` and `C:\Users\Liram\.claude\plans\rustling-seeking-wave.md` for the full multi-phase design). `credentials.secret_ciphertext` is AES-256-GCM encrypted (`server/src/services/credential.service.ts`, key from `CREDENTIAL_MASTER_KEY`) and is the only place a cloud Service Principal (or future VM login) secret is stored — never selected into any API response, see `CLAUDE/invariants.md`. All four are CONFIG despite `created_by_username`/`actor_username` looking like they "should" be a `users` FK — they're denormalized text snapshots instead, because `users` is a RUN table and a CONFIG table must never FK into RUN.

## Seeding

`npm run seed -w server` (idempotent — safe to re-run) applies migrations, then seeds the CONFIG catalog + a demo RUN: 2 teams (Alpha/Bravo), 1 instructor (`instructor`/`instructor123`) and 4 students (`alice`/`bob`/`carol`/`dave`, all `student123`). If an active `event_runs` row already exists, demo team/user seeding is skipped (so re-running seed after real event data exists won't clobber it) — but CONFIG tables always get their `INSERT OR IGNORE` pass.
