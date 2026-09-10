# API

Base path `/api`. Auth: `Authorization: Bearer <token>` from `POST /api/auth/login` (see `CLAUDE/invariants.md` for the plaintext-password decision). Student routes are implicitly scoped to `req.user.teamId`; instructor bypasses team scoping and uses `/api/admin/*` for cross-team actions.

Kept in sync with `server/src/app.ts`'s route mounts — update this table in the same change whenever a route file is added/removed there.

## Public / auth

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | — | `{username, password}` -> `{token, user}`. 409 if no active event run. |
| GET | `/auth/teams` | — | `{teams: [{id, name}]}` for the active event run — names only, no member/account details. Powers the registration team picker. 409 if no active event run. |
| POST | `/auth/register` | — | Self-registration for students. `{teamId, username, password, displayName?}` -> `{token, user}` (auto-logs in). Always creates role `student`; 400 if `teamId` isn't a team in the active run, 409 on a taken username. Instructor accounts are still created only via `POST /admin/users`. |
| POST | `/auth/logout` | any | Deletes the presented token. |
| GET | `/auth/me` | any | Current user from token. |

## Student (team-scoped)

| Method | Path | Notes |
|---|---|---|
| GET | `/teams/me` | Own team + members (US-002). |
| GET | `/teams/me/active-cyber-range` | Active `team_cyber_range_progress` for own team, joined with cyber range + day, with computed `remainingSeconds` (US-001). `{active: null}` if none active. Read-only for students by design — only the instructor assigns/switches a team's scenario, via `/admin/teams/:teamId/cyber-ranges/:cyberRangeId/start` below. |
| GET | `/documentation-categories` | Active categories ordered by `sort_order`, any authenticated user. Seeded set now includes `ioc` ("Indicator of Compromise (IOC)"); more can be added on the fly (see below) — this is CONFIG data, survives an event reset. `other` always sorts last (see `CLAUDE/invariants.md`). |
| GET | `/cyber-ranges/:cyberRangeId/documentation` | Own team's entries for that range, chronological (US-003). Instructor must pass `?teamId=`. Each entry includes `imageDataUrl` (a `data:image/...` string, or null). |
| POST | `/cyber-ranges/:cyberRangeId/documentation` | Student only. `{body, categoryId?, newCategoryLabel?, isImportantFinding?, imageDataUrl?}`. `newCategoryLabel` (free text) takes precedence over `categoryId` — find-or-creates a `documentation_categories` row by a slugified key (`findOrCreateCategoryId` in `documentation.routes.ts`), so typing an existing category's name (any case/spacing) reuses it rather than duplicating. `imageDataUrl` must be a `data:image/...` string, capped at ~4.5MB raw (`MAX_IMAGE_DATA_URL_LENGTH`) — note the global `express.json()` body limit is `8mb` (`app.ts`) to accommodate this. |
| GET | `/cyber-ranges` | Read-only catalog (all days/ranges) — any authenticated user, used by admin UI to pick a range. |
| GET | `/cyber-ranges/:cyberRangeId/topology` | Read-only `{nodes, edges}` (US-004). Topology is CONFIG data (tied to the range, not a team), so not team-scoped — empty arrays if none configured yet. Nodes/edges with a non-null `environmentId` were written by Azure discovery (see `/admin/environments/:id/discover` below), not hand-drawn by an instructor; the client (`TopologyGraph.tsx`) colors nodes by `nodeType` and marks discovered ones with a small indicator + a click-through metadata panel (Phase 3). |
| POST | `/help-requests` | Student only (US-005). `cyberRangeId` is resolved server-side from the team's active `team_cyber_range_progress` row, never trusted from the client. 409 if no active range. No hint payload — see `CLAUDE/invariants.md`. |
| GET | `/leaderboard` | `{enabled: false, teams: []}` unless `scoring_config.leaderboard_enabled` (US-008/FR-6). |
| GET | `/teams/me/scores` | Student's own team's scoring history + team total + per-student totals (US-007). |
| GET | `/history` | Own team's completed Cyber Ranges (day + difficulty + completedAt), newest first (US-010). Instructor must pass `?teamId=`. |
| GET | `/history/event-summary` | Per-day (AI/Azure/AWS) completed-count + total points for the team — a day with zero completions is simply omitted, never shown zeroed (US-010/FR-8). **Must stay mounted before `/history/:cyberRangeId`** or Express will capture `event-summary` as an id. |
| GET | `/history/:cyberRangeId` | Documentation + score total actually recorded for that team+range — no fabricated data. |
| POST | `/teams/me/access-sessions` | Student only (Phase 4 access broker). `{topologyNodeId}` — the node's cyber range is cross-checked server-side against the team's active `team_cyber_range_progress`, never trusted from the client (same pattern as `/help-requests`' `cyberRangeId` resolution). 201 with `{accessSessionId, wsUrl, expiresAt}` on success (`wsUrl` is `null` when no `GUACD_GATEWAY_WS_URL` gateway is configured — token is still minted and the session still tracked); otherwise 400/403/409 with `{error, reason}` (`reason` one of `no_active_range\|node_not_in_active_range\|not_connectable\|no_credential_configured\|credential_error`) and the denial is still recorded (`access_sessions.outcome='denied'` + `audit_log`). |
| POST | `/teams/me/access-sessions/:id/end` | Ends the caller's own `active` session (`outcome='completed'`). 404 if it isn't active or isn't the caller's team's. |

## Instructor (`/admin/*`, `requireRole('instructor')`)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/teams` | All teams + members. |
| POST | `/admin/teams` | `{name}` — creates a team in the current active run. |
| DELETE | `/admin/teams/:id` | Cascades to that team's users/progress/documentation/scores/help_requests. |
| POST | `/admin/users` | `{username, password, role, teamId?, displayName?}` — onboards a student/instructor into the current run. `teamId` required when `role: 'student'`. 409 on duplicate username within the run. |
| DELETE | `/admin/users/:id` | |
| POST | `/admin/teams/:teamId/cyber-ranges/:cyberRangeId/start` | Instructor-only: assigns/switches this scenario as the team's current one (see `CLAUDE/invariants.md` — students cannot self-assign). Upserts `team_cyber_range_progress` to `active` via `startCyberRangeForTeam` (`server/src/services/cyberRangeProgress.service.ts`), which first pauses (not deletes) whatever else was `active` for the team so at most one scenario is current at a time; sets `started_at`/`time_limit_seconds` from the range's `expected_duration_minutes` (null if not configured, e.g. AWS ranges). |
| POST | `/admin/teams/:teamId/cyber-ranges/:cyberRangeId/complete` | Sets status `completed` + `completed_at`. 404 if no progress row exists yet. |
| POST | `/admin/cyber-ranges/:cyberRangeId/topology/nodes` | `{label, nodeType, posX?, posY?, metadata?}`. `external_key` is set to the new row's id after insert (used as the React Flow node id). |
| PATCH | `/admin/cyber-ranges/:cyberRangeId/topology/nodes/:nodeId` | Partial update (label/nodeType/posX/posY) — used for admin drag-to-reposition. |
| DELETE | `/admin/cyber-ranges/:cyberRangeId/topology/nodes/:nodeId` | Also deletes edges touching that node first (no FK cascade defined for this one — done explicitly in the handler). |
| POST | `/admin/cyber-ranges/:cyberRangeId/topology/edges` | `{fromNodeId, toNodeId, label?}`. |
| DELETE | `/admin/cyber-ranges/:cyberRangeId/topology/edges/:edgeId` | |
| GET | `/admin/help-requests` | Optional `?status=open\|resolved` (US-006). |
| POST | `/admin/help-requests/:id/resolve` | Sets status `resolved`, `resolved_at`, `resolved_by_user_id`. |
| GET | `/admin/dashboard` | Array (N teams, never hardcoded to 2), each with active range/day/difficulty/`remainingSeconds`, `openHelpCount`, `completedCount` (US-006). |
| GET | `/admin/cyber-ranges/:cyberRangeId/pressure-thresholds` | List thresholds for a range. |
| POST | `/admin/cyber-ranges/:cyberRangeId/pressure-thresholds` | `{label, triggerSecondsRemaining, visualStyle?}`. Stage activates once remaining time drops to or below `triggerSecondsRemaining`; the most urgent (smallest) reached threshold wins — see `clock.service.ts`. |
| DELETE | `/admin/pressure-thresholds/:id` | |
| POST | `/admin/scores` | `{teamId, studentUserId?, documentationEntryId?, cyberRangeId?, points, isGamified?, note?}` (US-007). No `milestones` table — this is the entire scoring mechanism. `studentUserId` null = team-level award. |
| GET/PUT | `/admin/scoring-config` | `{leaderboardEnabled}`. Enabling it immediately emits a `leaderboard:update` broadcast. |
| POST | `/admin/event/reset` | `{confirm: "RESET EVENT"}` (exact match required, else 400, nothing changes). Deletes the active `event_runs` row — cascades through every RUN table — and creates a fresh one with a single default instructor account (`instructor`/`instructor123`, same convention as the seed script). **The caller's own token dies in this same request** since their user row is cascaded away; the response includes the new instructor credentials so they can log back in. CONFIG tables (cyber_ranges, days, topology, categories, scoring_config, pressure_stages) are never touched — see `CLAUDE/invariants.md`. |
| GET | `/admin/environments` | Registered live cloud environments (Phase 1 of the live-environment integration — see `CLAUDE/invariants.md` and the plan history in `PROGRESS.txt`). Never includes the secret — only `hasSecret: true` plus non-secret fields (tenantId/clientId/subscriptionId/resource group). |
| POST | `/admin/environments` | `{provider: 'azure'\|'aws', name, externalAccountId, externalScope?, tenantId, clientId, clientSecret, discoveryMode?, discoveryIntervalMinutes?}`. Encrypts `clientSecret` at rest via `server/src/services/credential.service.ts` (AES-256-GCM, key from `CREDENTIAL_MASTER_KEY`) — never stored or returned as plaintext. |
| PATCH | `/admin/environments/:id` | Partial update; passing `clientSecret` rotates the stored credential (old ciphertext is overwritten, not kept). |
| DELETE | `/admin/environments/:id` | Cascades: unlinks any `cyber_range_environments` rows and deletes the associated `credentials` row. |
| POST | `/admin/environments/:id/connectivity-check` | On-demand only (no polling). Authenticates as the environment's registered Service Principal and does one lightweight ARM read (`resourceGroups.get`). Always 200: `{ok:true, latencyMs, resourceGroupId}` or `{ok:false, latencyMs, reason: 'not_configured'\|'auth'\|'not_found'\|'network'\|'unknown', message}` — an unreachable environment is a valid result, not a server error. Every call (success or failure) writes an `audit_log` row. |
| POST | `/admin/environments/:id/discover` | Triggers an Azure Resource Graph discovery run (Phase 2 — see `PROGRESS.txt` and the plan referenced there). Runs async in-process; responds `202 {runId}` immediately, or `409` if a run is already `queued`/`running` for this environment (DB-enforced via a partial unique index, not app-level locking). No cyber range linked to the environment (`POST /admin/cyber-ranges/:cyberRangeId/environments` below) means resources are discovered but nothing is written to any topology — the run still completes with a warning, not an error. |
| GET | `/admin/environments/:id/discovery-runs` | History of discovery runs for this environment, newest first — `{id, status, startedAt, finishedAt, triggeredByUsername, resourceCounts, errors}`. `status` is `queued\|running\|succeeded\|partial_failure\|failed`. |
| GET | `/admin/environments/:id/discovery-runs/:runId` | Single run detail. |
| GET | `/admin/environments/:id/linked-cyber-ranges` | Cyber ranges this environment currently backs. |
| POST | `/admin/cyber-ranges/:cyberRangeId/environments` | `{environmentId}` — links an environment to a cyber range; a discovery run then writes/updates that range's `topology_nodes`/`topology_edges` (upserted by Azure resource id, never duplicated — see `CLAUDE/db.md`). |
| DELETE | `/admin/cyber-ranges/:cyberRangeId/environments/:environmentId` | Unlinks (does not delete previously-discovered topology — that's removed only by a subsequent successful discovery run's pruning, or by deleting the environment itself). |
| PUT | `/admin/topology/nodes/:nodeId/access-target` | `{protocol: 'rdp'\|'ssh', host, port, username, password}` (Phase 4 — student browser access broker, see `CLAUDE/invariants.md`). Makes a node connectable: stores the VM login credential encrypted (`credentials`, `kind='vm_login'`) and re-configuring rotates the existing credential in place rather than leaving an orphaned row. `password` is write-only — never returned by any GET. |
| GET | `/admin/topology/nodes/:nodeId/access-target` | `{accessTarget: {protocol, host, port, hasCredential} \| null}` — never the credential itself. |
| DELETE | `/admin/topology/nodes/:nodeId/access-target` | Removes the access target (the node stops being connectable); does not touch historical `access_sessions` rows. |
| GET | `/admin/access-sessions` | Currently-`active` student access sessions across all teams, for the instructor dashboard's live panel. |
| POST | `/admin/access-sessions/:id/force-close` | Instructor-only kill switch — sets `outcome='force_closed'`, emits `access_session:ended`. |
| GET | `/admin/audit-log` | Read-only view of the compliance trail (Phase 5). Optional `?entityType=` filter and `?before=<id>` for keyset pagination (pass the last row's id to page further back), `?limit=` (default 100, capped at 500). Newest first. |

## Realtime (Socket.io)

Handshake auth: client passes `{ auth: { token } }` (same bearer token as REST). `server/src/sockets/index.ts`'s `io.use()` validates it and joins the socket to a room: `team:{teamId}` for students, `instructor` for instructors. All current events are server→client fan-out only — writes always go through REST first (see `server/src/sockets/emitters.ts`).

| Event | Payload | Room | Fires on |
|---|---|---|---|
| `documentation:new` | `{entry}` | `team:{teamId}` | A student in that team posts a new documentation entry (US-003 shared timeline). |
| `help_request:new` | `{helpRequest}` | `instructor` | A student sends a help request (US-005/US-006). |
| `help_request:resolved` | `{helpRequestId}` | `team:{teamId}` + `instructor` | Instructor resolves a help request. |
| `clock:tick` | `{progressId, remainingSeconds}` | `team:{teamId}` + `instructor` | Once/second, server-authoritative (`server/src/services/clock.service.ts`), for every `active` progress row with a time limit. |
| `clock:pressure_stage` | `{progressId, stageLabel, visualStyle}` | `team:{teamId}` + `instructor` | Fires once when the most-urgent reached `pressure_stages` threshold changes (not every tick). |
| `clock:time_up` | `{progressId}` | `team:{teamId}` + `instructor` | Fires once when remaining hits 0 (deduped in-memory — an expired-but-still-`active` range does not re-fire this every second). |
| `score:awarded` | `{score, isGamified, teamTotal, studentTotal}` | `team:{teamId}` + `instructor` | Instructor scores a documentation entry or awards a standalone team score. `GamifiedEffects.tsx` fires confetti/sound on the receiving team's clients when `isGamified` is true. |
| `leaderboard:update` | `{teams}` | broadcast (all connected clients) | Any score change, only while `scoring_config.leaderboard_enabled`. Not team-scoped — the leaderboard itself is cross-team by nature. |
| `access_session:started` | `{session: {id, topologyNodeId, protocol, expiresAt}}` | `team:{teamId}` + `instructor` | A student's access-session request succeeds (Phase 4). |
| `access_session:ended` | `{accessSessionId, outcome}` | `team:{teamId}` + `instructor` | A session ends for any reason — self-end (`completed`), instructor kill (`force_closed`), or the server-side expiry sweep (`expired`). |

Client side: `client/src/lib/socketClient.ts` (`getSocket()` lazily connects using the current auth token), `client/src/hooks/useSocketEvent.ts` (generic subscribe hook used by feature pages to merge live events into the TanStack Query cache).

## Status

All 10 planned phases (0–9) are implemented and verified live (see `PROGRESS.txt`). Remaining known gaps are tracked in `BACKLOG.md` (notably: no admin UI to create teams/accounts for a new cohort after a reset — currently requires the seed script).
