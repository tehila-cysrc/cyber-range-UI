# Backlog

Out-of-scope feature ideas, intentional mock/stub code, deferred refactors. The `plan-to-backlog.sh` hook auto-appends bullets from approved plans' `## Out of scope` sections.

Format:

```
- [ ] <YYYY-MM-DD> | from-plan:<plan-name> | <one-line idea>
- [ ] <YYYY-MM-DD> | manual                 | <one-line idea>
```

## Open

- [ ] 2026-09-09 | manual | Student self-report of own progress (vs. instructor-only manual scoring, the current MVP assumption) is a plausible v2 — nothing in the PRD forbids it, just deferred for scope.
- [ ] 2026-09-09 | manual | Instructor's `POST /admin/teams/:teamId/cyber-ranges/:cyberRangeId/start` override has no admin UI button (found while adding student self-service start) — instructor would need curl/API to force-start a scenario for a stuck team. Low priority since students can now self-serve.

## Done

- [x] 2026-09-09 | manual | No admin UI/API existed to create teams and student/instructor accounts for a new cohort after a reset. **Shipped:** `POST/DELETE /api/admin/teams`, `POST/DELETE /api/admin/users`, and `client/src/features/admin/TeamsAdminPage.tsx` ("Roster" nav link, instructor-only). Verified via curl: create team → create student → student logs in and posts documentation → delete team cascades cleanly (team, user, auth token, documentation entry, progress row all gone, no FK errors) → deleted user can no longer log in.
- [x] 2026-09-09 | manual | No real `/sounds/score.mp3` asset existed. **Shipped:** replaced the file-based `Audio()` call with `client/src/features/leaderboard/playScoreChime.ts`, a small synthesized two-note WebAudio chime — no external asset to source/license, and matches the design system's restrained aesthetic.
- [x] 2026-09-09 | manual | Client bundle was ~556KB (mostly React Flow) with a build-time size warning. **Shipped:** lazy-loaded `TopologyViewerPage`/`TopologyAdminPage` in `client/src/app/routes.tsx` via `React.lazy` + `Suspense`. Main bundle dropped to ~411KB; React Flow now ships as its own ~141KB chunk loaded only when a topology screen is opened. Warning gone.
