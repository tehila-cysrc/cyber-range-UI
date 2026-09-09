# Backlog

Out-of-scope feature ideas, intentional mock/stub code, deferred refactors. The `plan-to-backlog.sh` hook auto-appends bullets from approved plans' `## Out of scope` sections.

Format:

```
- [ ] <YYYY-MM-DD> | from-plan:<plan-name> | <one-line idea>
- [ ] <YYYY-MM-DD> | manual                 | <one-line idea>
```

## Open

- [ ] 2026-09-09 | manual | No real `/sounds/score.mp3` asset exists — GamifiedEffects.tsx's audio.play() 404s silently (caught, non-fatal; confetti still fires). Add a real short sound file when one is available.
- [ ] 2026-09-09 | manual | Student self-report of own progress (vs. instructor-only manual scoring, the current MVP assumption) is a plausible v2 — nothing in the PRD forbids it, just deferred for scope.
- [ ] 2026-09-09 | manual | Client bundle is ~545KB (mostly React Flow) with a build-time size warning; consider dynamic import()/code-splitting the topology feature if this ever matters for load time on the event day.
## Done

- [x] 2026-09-09 | manual | No admin UI/API existed to create teams and student/instructor accounts for a new cohort after a reset. **Shipped:** `POST/DELETE /api/admin/teams`, `POST/DELETE /api/admin/users`, and `client/src/features/admin/TeamsAdminPage.tsx` ("Roster" nav link, instructor-only). Verified via curl: create team → create student → student logs in and posts documentation → delete team cascades cleanly (team, user, auth token, documentation entry, progress row all gone, no FK errors) → deleted user can no longer log in.
