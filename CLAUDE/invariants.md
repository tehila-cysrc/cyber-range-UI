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
- **Students never choose or switch their own team's cyber range/scenario.** Why: a self-service student picker was built and then explicitly reverted by the user — the instructor is the sole source of truth for which scenario a team is on, students only view it. How to apply: `GET /teams/me/active-cyber-range` stays read-only; scenario assignment goes exclusively through instructor-only `POST /admin/teams/:teamId/cyber-ranges/:cyberRangeId/start` (`InstructorDashboardPage.tsx`'s per-team picker). Don't reintroduce a student-facing start/switch endpoint or UI without checking with the user first.

---

## Live cloud environment credentials

### MUST

- **A stored credential (`credentials.secret_ciphertext`) is never selected into any API response, under any role, including instructor.** Why: unlike this app's intentionally-plaintext training passwords, these are real external-blast-radius credentials (a cloud Service Principal today, VM login credentials later). How to apply: list/detail DTOs (`environments.service.ts`'s `toSummary`) select only non-secret columns plus a computed `hasSecret: true`; the secret is a write-only request field on create/rotate, never echoed back.
- **The app's own Azure Service Principal is never assigned `Contributor`/`Owner` — `Reader` at resource-group scope, plus narrowly-scoped additive roles only, if a later feature needs more.** Why: the identity used to *build* a customer's Azure environment and the identity this app authenticates as are different trust levels; broadening the app's own SP turns a credential leak into a subscription-wide compromise instead of a bounded read-only one. How to apply: environment registration instructions should tell the instructor to assign `Reader` on the resource group, never suggest `Contributor` as a shortcut.
- **`audit_log` is CONFIG and must never be touched by `POST /api/admin/event/reset`.** Why: it's a compliance/accountability trail whose value depends on surviving the very resets it may need to help investigate — RUN-scoping it would let a reset silently erase the record of who registered/rotated/deleted an environment before that reset. How to apply: reference RUN-scoped entities (team, user) as plain text in `metadata_json`/`actor_username`, never as a foreign key.

### NEVER

- **Never log `CREDENTIAL_MASTER_KEY`, a decrypted credential, or a raw Azure SDK error object** (the latter can echo request details). How to apply: `credential.service.ts#readCredentialPlaintext` is the only function in the codebase allowed to produce plaintext secret material, and its result must be used immediately (building an SDK credential object) and never stored in a variable that outlives that call, logged, or returned from a route handler. `environments.service.ts#classifyAzureError` maps SDK errors to a small safe enum before anything reaches the client/logs.

---

## Student access broker (Phase 4)

### MUST

- **A student's access-session request resolves the target node's cyber range server-side from the team's currently-`active` `team_cyber_range_progress` row — never from anything the client asserts.** Why: same class of protection as the existing `help_requests` `cyberRangeId` resolution and the "students never self-assign a scenario" rule above; without it a crafted request could reach another range's VM. How to apply: `accessBroker.service.ts#requestAccessSession` re-derives `activeProgress.cyberRangeId` and cross-checks the node's `cyber_range_id` against it before touching any credential — verified live: a cross-range request is rejected (403, `node_not_in_active_range`) and the rejection itself is audited, not silently dropped.
- **A VM login credential (`access_targets` -> `credentials`, `kind='vm_login'`) is never selected into any API response, same rule as the Service Principal secret above.** How to apply: `GET .../access-target` returns only `{protocol, host, port, hasCredential}`; `password` is a write-only request field, and re-configuring rotates the existing credential row in place (`topology.routes.ts`) rather than leaving an orphaned one.
- **A minted broker connection token is built and returned once, then never persisted or logged in plaintext form.** Why: `guacamoleToken.service.ts#encryptConnectionToken`'s output embeds the VM's login secret (AES-encrypted, but still the literal path to it) — treat it like the plaintext credential it decrypts to. How to apply: `access_sessions` stores only `broker_connection_id` (an opaque `randomUUID()`, unrelated to the token), never the token itself.

---

## Adding a new invariant

A new entry earns its place only if:
1. There's a real incident or constraint (not a hypothetical).
2. Following the rule is non-obvious from reading the code.
3. The rule is stable — not tied to a current refactor.

Format: rule, then `Why:` and `How to apply:` lines. No prose.
