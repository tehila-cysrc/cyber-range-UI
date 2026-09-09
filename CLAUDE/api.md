# API

Base path `/api`. Auth: `Authorization: Bearer <token>` from `POST /api/auth/login` (see `CLAUDE/invariants.md` for the plaintext-password decision). Student routes are implicitly scoped to `req.user.teamId`; instructor bypasses team scoping and uses `/api/admin/*` for cross-team actions.

Kept in sync with `server/src/app.ts`'s route mounts — update this table in the same change whenever a route file is added/removed there.

## Public / auth

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | — | `{username, password}` -> `{token, user}`. 409 if no active event run. |
| POST | `/auth/logout` | any | Deletes the presented token. |
| GET | `/auth/me` | any | Current user from token. |

## Student (team-scoped)

| Method | Path | Notes |
|---|---|---|
| GET | `/teams/me` | Own team + members (US-002). |
| GET | `/teams/me/active-cyber-range` | Active `team_cyber_range_progress` for own team, joined with cyber range + day, with computed `remainingSeconds` (US-001). `{active: null}` if none active. |
| GET | `/documentation-categories` | Active categories, any authenticated user. |
| GET | `/cyber-ranges/:cyberRangeId/documentation` | Own team's entries for that range, chronological (US-003). Instructor must pass `?teamId=`. |
| POST | `/cyber-ranges/:cyberRangeId/documentation` | Student only. `{body, categoryId?, isImportantFinding?}`. |
| GET | `/cyber-ranges` | Read-only catalog (all days/ranges) — any authenticated user, used by admin UI to pick a range. |
| GET | `/cyber-ranges/:cyberRangeId/topology` | Read-only `{nodes, edges}` (US-004). Topology is CONFIG data (tied to the range, not a team), so not team-scoped — empty arrays if none configured yet. |
| POST | `/help-requests` | Student only (US-005). `cyberRangeId` is resolved server-side from the team's active `team_cyber_range_progress` row, never trusted from the client. 409 if no active range. No hint payload — see `CLAUDE/invariants.md`. |
| GET | `/leaderboard` | `{enabled: false, teams: []}` unless `scoring_config.leaderboard_enabled` (US-008/FR-6). |
| GET | `/teams/me/scores` | Student's own team's scoring history + team total + per-student totals (US-007). |
| GET | `/history` | Own team's completed Cyber Ranges (day + difficulty + completedAt), newest first (US-010). Instructor must pass `?teamId=`. |
| GET | `/history/event-summary` | Per-day (AI/Azure/AWS) completed-count + total points for the team — a day with zero completions is simply omitted, never shown zeroed (US-010/FR-8). **Must stay mounted before `/history/:cyberRangeId`** or Express will capture `event-summary` as an id. |
| GET | `/history/:cyberRangeId` | Documentation + score total actually recorded for that team+range — no fabricated data. |

## Instructor (`/admin/*`, `requireRole('instructor')`)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/teams` | All teams + members. |
| POST | `/admin/teams` | `{name}` — creates a team in the current active run. |
| DELETE | `/admin/teams/:id` | Cascades to that team's users/progress/documentation/scores/help_requests. |
| POST | `/admin/users` | `{username, password, role, teamId?, displayName?}` — onboards a student/instructor into the current run. `teamId` required when `role: 'student'`. 409 on duplicate username within the run. |
| DELETE | `/admin/users/:id` | |
| POST | `/admin/teams/:teamId/cyber-ranges/:cyberRangeId/start` | Upserts `team_cyber_range_progress` to `active`, sets `started_at`/`time_limit_seconds` from the range's `expected_duration_minutes` (null if not configured, e.g. AWS ranges). |
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

Client side: `client/src/lib/socketClient.ts` (`getSocket()` lazily connects using the current auth token), `client/src/hooks/useSocketEvent.ts` (generic subscribe hook used by feature pages to merge live events into the TanStack Query cache).

## Status

All 10 planned phases (0–9) are implemented and verified live (see `PROGRESS.txt`). Remaining known gaps are tracked in `BACKLOG.md` (notably: no admin UI to create teams/accounts for a new cohort after a reset — currently requires the seed script).
