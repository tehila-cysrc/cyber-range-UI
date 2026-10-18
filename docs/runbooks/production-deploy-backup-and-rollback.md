# Production — backup, migration dry run, deploy and rollback

Status: **prepared 2026-10-18, not executed.** Every step that touches the production server or its database
needs explicit approval. Nothing here has been run against a real database.

## Why this matters

Every container start runs the startup sequence (`server/src/server.ts`) against `/data/cyber-range.db`:

1. **`seed()`:**
   - `migrate()` adds the missing tables, columns, triggers and indexes, and converts schemas (for example pre-RBAC staff rows into `accounts`).
   - Reference data (days, documentation categories, scoring configuration).
   - `ensureInitialAdmin()`: when **no admin account exists**, it creates one named `instructor` (or `admin`) with `INITIAL_ADMIN_PASSWORD`, or the documented dev password if that is unset.
   - `seedDemoRunData()`: when **no active event run exists**, it creates a demo run with demo teams and student logins.
2. **`importScriptLibraryIfEmpty()`** fills an empty script library.
3. **`recoverInterruptedAiWork()`** marks interrupted AI jobs failed. It never calls Foundry.

So **deploying a new image is a database migration.** It can't be undone without restoring a backup.

## 1. Before the deploy (approval needed)

1. **Confirm** what is running: the production image or commit, and whether production is already on the RBAC schema (the dry run in step 3 shows it).
2. **Set `INITIAL_ADMIN_PASSWORD`** in the Coolify environment, if the dry run warns that an admin account would be created. Never let production create the dev-password admin.
3. **Plan for AI:** leave `AI_ASSESSMENT_ENABLED` unset or `false` for the deploy. See `docs/runbooks/ai-assessment-rollout.md`.
4. **Announce a window:** a few minutes when no event is running.

## 2. Backup (approval needed)

The image ships `server/scripts/db/` (Dockerfile, 2026-10-18).

**Inside the running container** (Coolify terminal):

```sh
mkdir -p /data/backups
node /app/server/scripts/db/backup.mjs --db /data/cyber-range.db --out /data/backups/cyber-range-$(date +%Y%m%d-%H%M%S)-pre-deploy.db
```

- The backup is a consistent, read-only `VACUUM INTO` snapshot.
- It writes `<file>.manifest.json`: sha256, `integrity` (must be `ok`), row counts, `scoresTotal`, and the schema generation (`rbac`, `aiAssessment`).

**Copy the backup off the server** (to your machine) with Coolify's file download or `docker cp`. The `/data` volume is not a backup of itself.

**If the running image predates the tool** (no `server/scripts/db/` inside), make the same snapshot inline:

```sh
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/cyber-range.db',{readOnly:true});d.prepare('VACUUM INTO ?').run(process.argv[1]);" /data/backups/pre-deploy.db
```

Then run the manifest step locally with `backup.mjs` on the downloaded copy.

## 3. Migration dry run on the copy (local; no approval needed once the copy is on your machine)

From the repository at the commit to be deployed:

```sh
npm ci && npm run build -w server
cd server
node scripts/db/migration-check.mjs --db <downloaded backup>.db --work <new empty folder> --initial-admin-password-set
```

Drop `--initial-admin-password-set` if production will not have `INITIAL_ADMIN_PASSWORD`; the check then warns about the dev password.

**Pass criteria:**
- `PASSED` is printed, and there is no FAIL line:
  - integrity is `ok`;
  - no new foreign-key violations;
  - no table lost rows;
  - `scoresTotal` is unchanged.
- **WARN lines are understood and accepted:**
  - an admin account would be created → set `INITIAL_ADMIN_PASSWORD` first;
  - a demo event run would be created → only expected if production has no active run.
- `migration-check.md` is kept with the approval record.

The input file is never modified; the report states `inputUnchanged`.

## 4. Deploy (approval needed)

1. Push the approved commit to the branch Coolify builds. **Pushing needs its own approval.**
2. Let Coolify build and start the container, then watch the start log:
   - `[migrate] schema applied`
   - `[seed] … done`
   - no `[seed] created admin account … documented dev password` line
3. **Health check:** `GET /api/health` returns ok.

## 5. Verify after the deploy

- [ ] An admin signs in, and a student (or a test student) signs in.
- [ ] The leaderboard and team totals match the pre-deploy values (`scoresTotal` in the manifest).
- [ ] `/admin/scenarios` loads. The AI sections show "AI assessment off" unless AI was deliberately enabled.
- [ ] `/admin/audit-log` shows no unexpected `authz.denied` bursts.
- [ ] Take a post-deploy backup with `backup.mjs`. Its manifest `scoresTotal` equals the pre-deploy value.

## 6. Rollback

Use this if a check fails, or the app misbehaves after the deploy:

1. **Stop** the application in Coolify, so nothing writes to `/data`.
2. **Restore the database:**
   - copy the pre-deploy backup over `/data/cyber-range.db`;
   - remove `/data/cyber-range.db-wal` and `/data/cyber-range.db-shm` if present (the backup is a single consistent file);
   - check that the sha256 matches the backup manifest.
3. **Redeploy the previous image** (Coolify deployment history: redeploy the previous successful deployment). The old code expects the old schema.
4. **Verify** as in step 5 against the pre-deploy manifest.

Never start the new image on the restored file again until the cause is understood. It would migrate the file again.

## 7. Approval checklist

- [ ] Backup inside the container (step 2), and copy off the server.
- [ ] `INITIAL_ADMIN_PASSWORD` set in Coolify (if the dry run warns).
- [ ] Dry-run report reviewed (step 3).
- [ ] Push and deploy (step 4).
- [ ] Post-deploy verification and backup (step 5).
