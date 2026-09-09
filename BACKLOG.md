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
- [ ] 2026-09-09 | manual | No admin UI/API exists yet to create teams and student/instructor accounts for a new cohort — only `npm run seed` (shell access required) populates demo teams into an empty event run, and it deliberately skips doing so once ANY active run exists (including the single-instructor run left after a reset). After a real event-reset, onboarding a new cohort's real roster currently requires direct DB/script access. Worth a `/admin/teams` create-team + create-user screen backed by new POST endpoints in a future phase.

## Done

- [x] 2025-12-01 | shipped in <commit/PR>
