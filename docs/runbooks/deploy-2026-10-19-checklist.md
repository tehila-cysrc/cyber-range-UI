# Deploy 2026-10-19 — execution checklist

Applies `production-deploy-backup-and-rollback.md` and `ai-assessment-rollout.md` to this deploy.
Status: **prepared, not executed.** Every step marked (approval) touches production and needs the user's go-ahead.

## What is deployed

| | |
|---|---|
| Production now | `cysrc/master` = `0fc3bb0` (2026-10-12, "RBAC stage 6 browser QA") — RBAC schema, no AI tables, image has **no** `server/scripts/db/` |
| To deploy | `master` = `5c9cef6` (26 commits): AI assessment (phases 0–8, platform P1–P6), simplified instructor UX, Event Summary batch, AI Management page |
| Schema change | adds `scenario_ai_documents`, `ai_assessments`, `ai_foundry_resources`, `documentation_feedback.source_ai_assessment_id` and related columns/indexes — **a migration; rollback = restore the backup** |
| Tests at `5c9cef6` | server 252/252 |
| Migration rehearsal (local) | Render snapshot of 2026-09-16 (pre-RBAC, 25 tables): PASSED, integrity ok, score total 460 → 460, 16 tables added; WARN: an admin is created when none exists → set `INITIAL_ADMIN_PASSWORD` |

The rehearsal used an old production snapshot, not today's data. Step 3 repeats it on today's backup.

## 1. Before (approval)

- [ ] Pick a window with no running event.
- [ ] Coolify env: `INITIAL_ADMIN_PASSWORD` set (production already has RBAC accounts, so it should not trigger — set it anyway).
- [ ] Coolify env for AI, **with the switch off** for the deploy:
  - `AI_ASSESSMENT_ENABLED=false`
  - `FOUNDRY_PROJECT_ENDPOINT`
  - The agent (cyber-range-assessor v7, contract 3) is pinned in code since 2026-10-21 — no agent variables in Coolify (v7: user decision 2026-10-19, connectivity-tested, not production-approved)
  - `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` — **decide which service principal**: the runbook requires a dedicated one with only "Foundry User"; the local `.env` one may be the over-privileged `sp-cyber-range-demo` (FOLLOWUPS P2).

## 2. Backup (approval) — Coolify terminal of the running container

The running image predates `backup.mjs`, so use the inline snapshot:

```sh
mkdir -p /data/backups
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/cyber-range.db',{readOnly:true});d.prepare('VACUUM INTO ?').run(process.argv[1]);" /data/backups/pre-deploy-2026-10-19.db
ls -l /data/backups/
```

- [ ] Download `/data/backups/pre-deploy-2026-10-19.db` to this machine (Coolify file download or `docker cp`). Keep it owner-only, never in the repo.

## 3. Dry run on today's copy (local, no production access)

```sh
cd server
node scripts/db/backup.mjs --db <downloaded>.db --out <scratch>/prod-2026-10-19.db        # manifest: integrity, scoresTotal
node scripts/db/migration-check.mjs --db <scratch>/prod-2026-10-19.db --work <new empty dir> --initial-admin-password-set
```

- [ ] `PASSED`, no FAIL; `scoresTotal` unchanged; every WARN understood. Keep `migration-check.md` with this checklist.

## 4. Deploy (approval)

- [ ] `git push cysrc master` (fast-forward `0fc3bb0..5c9cef6`; triggers the Coolify build).
- [ ] Start log: `[migrate] schema applied`, `[seed] … done`, **no** "created admin account … documented dev password".
- [ ] `GET /api/health` → ok.

## 5. Verify (AI still off)

- [ ] Admin and a test student sign in.
- [ ] Leaderboard / team totals match the manifest `scoresTotal`.
- [ ] `/admin/scenarios` loads; AI Management shows **Disabled**, "Settings complete", pinned version 7.
- [ ] No unexpected `authz.denied` bursts in `/admin/audit-log`.
- [ ] Post-deploy backup (`node /app/server/scripts/db/backup.mjs …` — the new image has the tool); `scoresTotal` equal.

## 6. Enable AI pilot (approval; real Foundry calls)

- [ ] Set `AI_ASSESSMENT_ENABLED=true`, restart → AI Management **Ready**, version 7.
- [ ] Upload one reference document on a test scenario; one "Check with AI" and one final on a test team.
- [ ] Known issue before instructors use it: the leak warning fires on ordinary words (FOLLOWUPS P2) — brief instructors or fix first.

## Rollback

- AI only: `AI_ASSESSMENT_ENABLED=false`, restart (stored results stay readable).
- Whole deploy: stop app → restore `pre-deploy-2026-10-19.db` over `/data/cyber-range.db`, remove `-wal`/`-shm`, check sha256 → redeploy the previous successful deployment (`0fc3bb0`) in Coolify → verify against the manifest. Never start `5c9cef6` on the restored file before the cause is understood.
