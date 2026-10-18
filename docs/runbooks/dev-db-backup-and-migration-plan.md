# Local dev database — backup and migration verification plan

Status: **proposal, awaiting approval** (2026-10-15; tooling added 2026-10-18). Nothing below has been run against the real file.

Tools (2026-10-18, tested on temporary databases only): `server/scripts/db/backup.mjs` (consistent read-only backup plus manifest) and `server/scripts/db/migration-check.mjs` (runs the real startup sequence on a copy and compares). Production: `docs/runbooks/production-deploy-backup-and-rollback.md`.

Scope: `server/data/cyber-range.db` (plus `-wal` / `-shm`), the local development database. The
production DB (Coolify `/data/cyber-range.db`) is out of scope; see `CLAUDE/deploy.md` and the RBAC
memory note before any production push.

## 1. Current state (read-only inspection, 2026-10-15)

| Item | Value |
|---|---|
| Last write to `cyber-range.db` | 2026-10-12 08:47 (sha256 prefix `db54f23ae6e99edf`, 929,792 bytes) |
| `-wal` | 0 bytes (everything checkpointed) |
| Schema generation | **Pre-RBAC**: no `accounts` / `instructor_assignments` tables, no AI tables |
| Staff | 1 `users` row with role `instructor` (holds its own password) |
| Rows | event_runs 1 · teams 4 · users 11 · documentation_entries 6 · documentation_feedback 1 · scores 5 · canvas nodes 0 · cyber_ranges 9 · team_cyber_range_progress 7 · audit_log 254 · organizations 0 |
| Official score total | `SUM(scores.points)` = **460** |

The inspection opened the file read-only. It changed nothing in `cyber-range.db` or `-wal`. SQLite did refresh `cyber-range.db-shm`, its shared-memory WAL index, which is rebuilt automatically and holds no data.

## 2. What the migration will do

`migrate()` runs automatically on the next `npm run dev` / `npm run seed` / server start. On this file it will:

1. **RBAC (2026-10-12):**
   - Create `accounts` and `instructor_assignments`.
   - **Move the 1 staff row into an `admin` account**: its password moves to `accounts`, `users.password` becomes empty, and the `users.id` and every FK to it are kept.
   - Add the audit columns and the staff-membership guards (triggers and a unique index).
2. **AI assessment (Phases 1–2):**
   - Create `scenario_ai_documents`, `ai_assessments` and `ai_foundry_resources`.
   - Add `cyber_ranges.ai_rubric_json` and `team_cyber_range_progress.ai_document_id`, both nullable and NULL for existing rows.
3. **Nothing else.** No timeline entries, feedback, canvas, scores, help requests or progress rows are changed or removed. No Foundry/Azure call is made: AI is off unless `AI_ASSESSMENT_ENABLED` is on, and indexing only happens on an explicit upload.

**Already rehearsed on a copy** (2026-10-15, twice, same build as this plan):
- Row counts were identical before and after.
- The score total stayed 460.
- `PRAGMA foreign_key_check` was empty.
- Re-running was a no-op.
- The admin login worked, and `/auth/me` listed the new permissions.

## 3. Backup procedure (to run after approval)

1. **Stop every process using the DB:** `npm run dev`, any server on ports 4000/5173, DB browsers. Then confirm that nothing holds the file.
2. **Copy all three files together** into a dated folder **outside the repo**, for example `%USERPROFILE%\cyber-range-backups\2026-10-15-pre-rbac-ai\`:
   `cyber-range.db`, `cyber-range.db-wal`, `cyber-range.db-shm`.
3. **Verify the backup:**
   - The sha256 of the copied `cyber-range.db` equals the original's.
   - `PRAGMA integrity_check` on the copy returns `ok`.
   - The row counts and the score total on the copy match section 1.
   - Alternatively (2026-10-18): `node scripts/db/backup.mjs --db data/cyber-range.db --out <backup folder>/cyber-range-backup.db` from `server/` writes a consistent copy (read-only `VACUUM INTO`) plus a `.manifest.json` with the integrity check, row counts and `scoresTotal` to compare with section 1.
4. Keep the backup until production has been migrated and checked too.

## 4. Migration and verification (to run after approval)

1. **Rehearse once more** on a fresh copy with the current commit, as in section 2: `node scripts/db/migration-check.mjs --db <backup>.db --work <empty folder>` (from `server/`, after `npm run build -w server`). It must print PASSED with no FAIL line. Read every WARN line; for this file none is expected, because the staff row becomes the admin account.
2. **Run** `npm run migrate -w server` against the real file. This uses the default `DB_PATH=./data/cyber-range.db` with `cwd = server/`.
3. **Verify:**
   - `PRAGMA integrity_check` = `ok` and `PRAGMA foreign_key_check` = empty.
   - The row counts from section 1 are unchanged, except the new empty tables and 1 new `accounts` row.
   - `SUM(scores.points)` = 460, and the leaderboard is the same per team.
   - The staff user signs in with its old password (now an admin account); a student (`alice`) signs in.
   - `/admin/scenarios` loads, and the AI section shows "AI disabled on server" (unless you enable AI).
4. **Rollback** (if any check fails): stop the server, restore all three files from the backup, and confirm that the sha256 matches the backup.

## 5. Approval checklist

- [ ] Backup location approved.
- [ ] OK to stop running dev servers during the backup.
- [ ] OK to run the RBAC staff → admin conversion on this file. The staff login keeps its password.
- [ ] Run the migration now, or leave the file as is until production is migrated.
