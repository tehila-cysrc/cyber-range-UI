# MITRE ATT&CK TTP detection, scoring & MTTD

Branch `feature/mitre-ttp` (2026-09-23). Approved plan: `C:\Users\Liram\.claude\plans\pasted-content-id-80e8-we-want-keen-pizza.md`.

Instructors define the ATT&CK techniques a scenario expects; students optionally tag Timeline entries with techniques; the server auto-credits each expected technique **once per team** into the existing `scores` table (live `score:awarded`), and reports an **optional** MTTD. MTTR is deferred.

Two layers, kept strictly separate:

1. **Scoring** — was the technique correctly identified? Works with no timing data at all.
2. **MTTD** — how fast? Computed only from a real recorded occurrence; otherwise **N/A** (never a fallback to scenario start). Never creates, changes or gates a credit.

## Data model

| Table | Split | Purpose |
|---|---|---|
| (file) `server/src/data/mitre/enterprise-attack.json` | static | ATT&CK Enterprise v19.2 (15 tactics, 697 techniques incl. sub-techniques). Regenerate: `npm run build-mitre-catalog -w server [version]` (needs internet), commit the output. Loaded by `services/mitreCatalog.ts`; ids are validated against it (no FK). |
| `cyber_range_expected_ttps` | CONFIG | Answer key: `technique_id`, `tactic_id` (one of the technique's tactics), `points` 1–1000, private `description`, optional `topology_node_id` (expected host), optional `trigger_script_id -> scripts`, soft delete `is_active`. Partial UNIQUE `(cyber_range_id, technique_id) WHERE is_active = 1`. |
| `documentation_entry_ttps` | RUN | Student tags (≤3 active per entry). Soft-removed (`removed_at`) — history drives incorrect-association counts and the budget. |
| `ttp_occurrences` | RUN | When an expected technique happened: `script_execution` (auto on a successful trigger-script run, `occurred_at = script_executions.started_at`; respects the expectation's pinned host) or `manual` (instructor "Mark occurred", may backdate within the current run). Per scenario. MTTD only. |
| `ttp_detections` | RUN | The locked credit. Partial UNIQUE `(team_id, cyber_range_id, expected_ttp_id) WHERE status='credited'`. `points_awarded` snapshot, `score_id` -> the paired `scores` row. |
| `scores.source` / nullable `scores.awarded_by_user_id` | RUN | `'manual'|'ttp'`; NULL awarder = auto credit. Guarded, transactional rebuild `migrate.ts#relaxScoresForTtpAwards`. |
| `team_cyber_range_progress.first_started_at` / `first_completed_at` | RUN | Set once. MTTD window start (`started_at` is overwritten on restart) / cut-off after which tags never score. Backfilled. |

All timestamps are server-generated UTC ISO strings; the only client-supplied time is an instructor's manual `occurredAt` (must parse, ≤ now, ≥ the event run's start).

## Rules

- **Match:** tag satisfies expected `E` if `tag === E` or `tag` starts with `E + '.'` (a sub-technique satisfies an expected parent; an expected sub-technique needs the exact id).
- **Credit** (`ttpScoring.service.ts#reconcileTeamTtps`, idempotent, runs after every tag write / expectation add / void): for each active expectation without a detection, the earliest active matching tag made before the team's `first_completed_at` → detection (`detected_at = tag.tagged_at`) + `scores` row. Once only per team; credits are locked (untagging doesn't revoke).
- **Incorrect association:** a distinct technique ever tagged that matches no active expectation → 0 points, counted (plus precision). Manual penalties stay on the existing Quick award.
- **Budget:** distinct techniques ever tagged per team per scenario ≤ `max(10, ceil(3n/10)·10)` (tiered so it doesn't reveal the expected count `n`); always applied, even with no expectations.
- **Overrides:** void (removes the score; blocks auto re-credit of that *technique* for the team, surviving a remove + re-add), manual credit against an entry (`detected_at = entry.created_at`, flagged `instructor`). Deleting a credited expectation requires `?voidDetections=true` (atomic); re-adding it later credits normally.
- **MTTD:** `detected_at − earliest occurrence in [first_started_at, detected_at]`; N/A with reason `no_occurrence_recorded` / `detected_before_recorded_occurrence`. Team/scenario MTTD = mean over measurable detections, always shown with "measured X of Y".
- **Reveal:** students see only their own credited techniques + budget until **every** team on the scenario is completed; then their own full breakdown (expected/detected/missed/incorrect + MTTD), never instructor notes.

## API

Any authenticated: `GET /api/mitre/catalog`.

Student:

| Method | Path | Notes |
|---|---|---|
| GET | `/cyber-ranges/:id/documentation` | Entries gain `ttps: [{techniqueId, techniqueName, credited}]`; response gains `ttpBudget {limit, used}`. **403 for a scenario the team was never assigned.** |
| POST | `/cyber-ranges/:id/documentation` | Optional `techniqueIds` (≤3, catalog ids). Budget checked before anything is written; entry + tags atomic. |
| PUT | `/cyber-ranges/:id/documentation/:entryId/ttps` | `{techniqueIds}` set semantics (replay-safe). Own team's entry, active scenario only (409 otherwise). |
| GET | `/teams/me/cyber-ranges/:id/ttp-summary` | During the run: `{scored, revealed:false, earnedPoints, credited, budget}`. After every team completed: `{revealed:true, report}`. |

Instructor (`routes/admin/ttp.routes.ts`, all audited):

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/admin/cyber-ranges/:id/expected-ttps` | List (+ `totalPoints`, `occurrences`, `attackVersion`) / create (`{techniqueId, tacticId?, points, description?, topologyNodeId?, triggerScriptId?}`; 409 duplicate). Create re-reconciles every team on the range. |
| PATCH/DELETE | `/admin/expected-ttps/:id` | PATCH points/tactic/description/host/trigger/sortOrder (explicit null clears; technique not editable). DELETE soft; 409 `{creditedCount}` unless `?voidDetections=true`. |
| POST | `/admin/expected-ttps/:id/occurrences` | Manual "Mark occurred" `{occurredAt?}`. |
| DELETE | `/admin/ttp-occurrences/:id` | |
| GET | `/admin/cyber-ranges/:id/ttp-report[?teamId=]` | Per-team report, or `{teams, mttd}` for the scenario. |
| POST | `/admin/ttp-detections` | Manual credit `{teamId, expectedTtpId, documentationEntryId, note?}` (note → audit log only). |
| POST | `/admin/ttp-detections/:id/void` | `{reason?}` |

`GET /admin/dashboard` team `active` gains `ttp` (null if no expectations); score lists gain `source`.

Sockets: `ttp:changed {teamId, cyberRangeId}` → **instructor room only**; `documentation:updated {entry, teamId}` → team + instructor. Credits reuse `score:awarded` / `leaderboard:update`.

## UI

- Student Investigation: optional "MITRE ATT&CK" picker (`components/TechniquePicker.tsx`, search over the full catalog), tag chips (credited = ✓, anything else neutral), inline "Edit ATT&CK", budget hint.
- Instructor **Scenarios** page (`/admin/scenarios`, `features/scenarios/ScenarioConfigPage.tsx`): expected techniques by tactic, total points, trigger script, host, private note, occurrences + Mark occurred.
- Progress (instructor): `features/scoring/TtpDetectionsPanel.tsx` — detected/missed, MTTD, incorrect, precision, Void, Credit manually. Dashboard card line. Debrief: `features/history/TtpDebriefSection.tsx` (cross-team matrix / student breakdown after reveal).

## Invariants

- The answer key (expected list, points on offer, instructor notes, occurrences, which expectations are still undetected) is served **only** under `/api/admin/*` and the instructor socket room. Student DTOs are explicit column lists.
- Correctness, points and timestamps are decided only server-side (`ttpScoring.service.ts`); the client sends technique ids and nothing else.
- MTTD never influences scoring, and is N/A without a recorded occurrence — no proxy timestamp.

## Verification (2026-09-23)

- `npm test -w server`: 44/44 (matching, MTTD, budget, once-only, locked credits, void/re-add, reopen cut-off, re-entrant transactions, trigger-script occurrences).
- Live API + Socket.io run against a real server: 63/63; event reset wipes RUN rows and keeps expectations.
- Headless Chrome (real clicks): 25/25 incl. live teammate updates, keyboard picker, Scenarios CRUD, void, debrief reveal, no overflow at 390px; 0 console errors.
- Not exercised: a real Azure Run Command triggering an occurrence (covered by a unit test on a fabricated succeeded execution).
