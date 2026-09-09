# Invariants

Load-bearing MUSTs and NEVERs. Each rule has a **why** so future-you can judge edge cases.

Read before touching: the DB schema (`server/src/db/schema/*.sql`), the auth middleware, or the event-reset endpoint (planned Phase 9).

---

## Database schema (CONFIG vs RUN split)

### MUST

- **A new table goes in exactly one of `config.sql` or `run.sql`, decided before writing it.** Why: the event-reset operation (`POST /api/admin/event/reset`, planned Phase 9) deletes the active `event_runs` row and relies on `ON DELETE CASCADE` to wipe every RUN table in one shot, leaving CONFIG tables untouched. How to apply: ask "does this survive a reset, or does it belong to one specific event run?" — Cyber Range definitions/topology/categories/thresholds = CONFIG; teams/users/docs/scores/help-requests = RUN.
- **Leaderboard/team/student totals are computed (`SUM(...) GROUP BY ...`), never stored as a running total column.** Why: a stored aggregate can drift from the underlying `scores` rows and would need explicit invalidation on reset. How to apply: any new "total" or "count" display value should be a query, not a column.

### NEVER

- **A CONFIG table must never have a foreign key into a RUN table** (e.g. `cyber_ranges` must never reference `teams` or `event_runs`). Why: that FK would make the reset operation's "CONFIG survives, RUN is wiped" guarantee false — a cascading delete could reach into config, or an orphaned FK could block deletion. How to apply: if you're tempted to add this, the data you're modeling is probably RUN-scoped and belongs in a RUN table referencing the CONFIG table instead (see `team_cyber_range_progress` for the pattern).

### Gotcha: multi-statement writes need manual transactions

- **`node:sqlite`'s `DatabaseSync` has no `.transaction()` helper** (unlike `better-sqlite3`). Why: we're on the Node built-in module, not the npm package (see `CLAUDE/services.md` for why). How to apply: wrap any multi-statement write that must be atomic in explicit `db.exec('BEGIN')` / `db.exec('COMMIT')`, with `db.exec('ROLLBACK')` in a catch — see `server/src/routes/admin/event.routes.ts`'s reset handler for the pattern.

---

## Auth

### MUST

- **Auth is a plaintext username/password compare + opaque bearer token, by explicit user decision.** Why: this is a low-stakes, internal, time-boxed training tool never exposed to the public internet — the user explicitly asked for no hashing/encryption to keep it simple. How to apply: don't "improve" this into bcrypt/JWT/sessions without checking with the user first; it's a documented tradeoff, not an oversight left to clean up.
- **Student-scoped routes must verify `req.user.teamId` matches the requested `:teamId`** (instructor role bypasses this check). Why: without it, any authenticated student could read another team's private documentation, violating US-002's explicit "no exposure to the competing team's documentation" requirement.

---

## Product model

### MUST

- **There is no discrete "milestones" entity.** Why: the PRD's US-007 was changed mid-project to replace automatic milestones with free-form instructor scoring on student documentation (individual + team attribution) — see `PROGRESS.txt` entry for the PRD-v2 planning session. How to apply: scoring/progress features go through the `scores` table (`server/src/db/schema/run.sql`), not a milestones table. The UI's nav slot that `docs/DESIGN.md` calls "Milestones" is deliberately renamed "Progress" (`client/src/app/AppShell.tsx`) — don't revert this to match the design doc literally without checking with the user.
- **Team count is flexible (N teams), never hardcoded to 2.** Why: the PRD was revised from "two teams" to just "teams" (instructor configures however many). How to apply: any UI rendering multiple teams (leaderboard, instructor dashboard) must `.map()` over an array with a responsive/auto-fill layout, never assume exactly 2.
- **No automatic hints, anywhere.** Why: explicit PRD non-goal (US-005) — a student needing help must go through the human instructor; the system must never suggest a next step. How to apply: `help_requests` carries no hint/suggestion field; don't add one even as a "nice to have".

---

## Adding a new invariant

A new entry earns its place only if:
1. There's a real incident or constraint (not a hypothetical).
2. Following the rule is non-obvious from reading the code.
3. The rule is stable — not tied to a current refactor.

Format: rule, then `Why:` and `How to apply:` lines. No prose.
