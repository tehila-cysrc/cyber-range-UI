# Backlog

Out-of-scope feature ideas, intentional mock/stub code, deferred refactors. The `plan-to-backlog.sh` hook auto-appends bullets from approved plans' `## Out of scope` sections.

Format:

```
- [ ] <YYYY-MM-DD> | from-plan:<plan-name> | <one-line idea>
- [ ] <YYYY-MM-DD> | manual                 | <one-line idea>
```

## Open

- [ ] 2026-09-09 | manual | Student self-report of own progress (vs. instructor-only manual scoring, the current MVP assumption) is a plausible v2 — nothing in the PRD forbids it, just deferred for scope.
- [ ] 2026-09-10 | manual | `cyber_ranges.is_active` (added to retire the old seeded example catalog from the picker `<select>`s without breaking real history) has no admin endpoint/UI to toggle — currently only settable via direct DB access. An instructor-facing "archive this Cyber Range" action would need `PATCH /admin/cyber-ranges/:id {isActive}` + a small UI affordance.
- [ ] 2026-09-10 | from-plan:azure-swirling-mitten | `topology_nodes.status` is instructor-set only (Phase 1) — a future enhancement could sync it automatically from the VM's live Azure power state during discovery instead.
- [ ] 2026-09-10 | from-plan:azure-swirling-mitten | Dragging a node's card into another zone's visual bounding box on the canvas doesn't reassign its `zone_id` — zone assignment is only changeable via the side panel's zone dropdown today. True drag-to-reassign would need real React Flow parent/child (group) nodes with coordinate remapping, deferred for scope.
- [ ] 2026-09-10 | from-plan:azure-swirling-mitten | `PATCH .../topology/nodes/:nodeId` can't explicitly clear `zoneId` back to "no zone" (COALESCE-based partial update, same pre-existing limitation as label/nodeType) — un-assignment currently only happens by deleting the zone itself.
- [ ] 2026-09-10 | from-plan:azure-swirling-mitten | The custom `docs/azure/cyber-range-bastion-operator-role.json` least-privilege RBAC role was verified live only with a broader Contributor SP (this session's identity lacked subscription-level rights to create a real narrow-permission test SP) — its exact action list is sourced from Microsoft's own Bastion IAM docs, but hasn't been empirically confirmed sufficient-and-necessary on its own. Worth a real test once someone with Owner/User Access Administrator rights assigns it to a dedicated SP.
- [ ] 2026-09-10 | manual | The Script Library (`scripts` table) is global/cyber-range-agnostic by design (see `CLAUDE/db.md`) — if an instructor later wants day/range-scoped libraries (e.g. AI-day scripts hidden from Azure-day instructors), that needs a `cyber_range_id` column and is a deliberate scope decision, not an oversight.
- [ ] 2026-09-10 | manual | `RunScriptDrawer`'s manual-mode script type is auto-fixed to the target VM's OS (no picker) to prevent OS/script mismatch — an instructor authoring a library script from scratch still picks the type explicitly in the Script Library page itself, so this is consistent, just worth knowing if the UI feels restrictive later.
- [ ] 2026-09-10 | from-plan:azure-swirling-mitten | `cloud_environments.default_vm_credential_id` (an environment-wide fallback credential for nodes with no explicit access target) is now unused/vestigial — Phase 2's credential model is per-node (`access_targets.username` + Key Vault secret) with no environment-level default. Column kept, not dropped; revisit if a "default credential per environment" convenience is wanted back.
- [ ] 2026-09-10 | from-plan:azure-swirling-mitten | QRadar's specialized-image credential (confirmed real: `QRADAR01` has `osProfile: null`) flows through the same generic Key Vault access-target UI as any other VM — there's no distinguishing "appliance-managed, don't expect normal rotation to work" UI treatment yet (design doc §11.9).
- [ ] 2026-09-10 | from-plan:azure-swirling-mitten | `EnvironmentsAdminPage.tsx` doesn't surface the auto-discovered `bastion_host_id`/`key_vault_uri` anywhere in the UI — useful for instructor troubleshooting ("why can't students connect") but not load-bearing for the feature to work.

## Done

- [x] 2026-09-09 | manual | Instructor's `POST /admin/teams/:teamId/cyber-ranges/:cyberRangeId/start` override had no admin UI button — instructor needed curl/API to force-assign/switch a scenario for a team. **Shipped:** a per-team "Assign/Switch scenario…" `<select>` on `InstructorDashboardPage.tsx`.
- [x] 2026-09-09 | manual | No admin UI/API existed to create teams and student/instructor accounts for a new cohort after a reset. **Shipped:** `POST/DELETE /api/admin/teams`, `POST/DELETE /api/admin/users`, and `client/src/features/admin/TeamsAdminPage.tsx` ("Roster" nav link, instructor-only). Verified via curl: create team → create student → student logs in and posts documentation → delete team cascades cleanly (team, user, auth token, documentation entry, progress row all gone, no FK errors) → deleted user can no longer log in.
- [x] 2026-09-09 | manual | No real `/sounds/score.mp3` asset existed. **Shipped:** replaced the file-based `Audio()` call with `client/src/features/leaderboard/playScoreChime.ts`, a small synthesized two-note WebAudio chime — no external asset to source/license, and matches the design system's restrained aesthetic.
- [x] 2026-09-09 | manual | Client bundle was ~556KB (mostly React Flow) with a build-time size warning. **Shipped:** lazy-loaded `TopologyViewerPage`/`TopologyAdminPage` in `client/src/app/routes.tsx` via `React.lazy` + `Suspense`. Main bundle dropped to ~411KB; React Flow now ships as its own ~141KB chunk loaded only when a topology screen is opened. Warning gone.
- [x] 2026-09-10 | from-plan:azure-swirling-mitten | Phase 3's `ComputeManagementClient.beginRunCommand` call had not been exercised against a real Azure VM at implementation time (no `cloud_environments` row registered in the dev DB). **Confirmed working:** user tested live against a real environment (2026-09-14) and reported success.
