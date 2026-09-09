# CLAUDE.md

Claude Code project instructions. Detail docs in `<repo>/CLAUDE/` — read on demand.

## Repo

`cyber-range-UI` is a training-event management system for SOC students: teams work through "Cyber Range" attack-simulation scenarios across three themed days (AI/Azure/AWS), documenting findings on a shared timeline, requesting instructor help, and getting scored/leaderboarded by an instructor. Stack: React + Vite + TypeScript SPA (`client/`), Express + TypeScript + Socket.io API (`server/`), SQLite via Node's built-in `node:sqlite` for persistence. This is the only architecture — there is no legacy version. See `docs/specs/PRD.docx` for requirements and `docs/DESIGN.md` for the visual design system ("Obsidian Telemetry"). Full implementation plan (data model, phases): `C:\Users\Liram\.claude\plans\prd-tranquil-pearl.md`.

> **Non-obvious gotcha:** persistence uses `node:sqlite`, not `better-sqlite3` as originally planned — `better-sqlite3` failed to install on this dev machine (no prebuilt binary, no VS Build Tools). See `CLAUDE/services.md` and `CLAUDE/db.md`.
> **Non-obvious gotcha:** the PRD's US-007 dropped discrete "milestones" in favor of free-form instructor scoring on documentation entries — there is no `milestones` table, and the UI's "Milestones" nav slot (per `docs/DESIGN.md`) is deliberately renamed "Progress". Don't reintroduce a milestones concept without checking with the user.
> **Non-obvious gotcha:** `npm run <script> -w server` runs with `cwd = server/`, not the repo root — `DB_PATH` and the `.env` lookup in `server/src/env.ts` are relative to that.

## Default Test User / Fixture

Seeded by `npm run seed -w server` (see `CLAUDE/db.md`):

- **Instructor:** `instructor` / `instructor123`
- **Students:** `alice` / `bob` (Team Alpha), `carol` / `dave` (Team Bravo) — all password `student123`
- **Data scope:** the single active `event_runs` row created by the seed script; safe to freely create/delete teams, docs, scores, help requests against it in dev.

Use this for any manual/browser/API test. No password hashing — plaintext by explicit decision (internal tool, not public-facing).

## Golden Rules

- **PROGRESS.txt** — append after every significant change. Fields: timestamp, session_id, tasks, file changes. NEVER overwrite. Too big → rename `PROGRESS_OLD_{date}.txt`, start fresh.
- **FOLLOWUPS.md / BACKLOG.md** — at the start of every session, read both. If FOLLOWUPS has open P0/P1 items, surface them before touching the new task. Found a bug not in current scope? Append one line to FOLLOWUPS (severity P0/P1/P2/P3, file:line, repro). Out-of-scope feature idea or mock/stub code? Append to BACKLOG. Never silently leave broken state.
- **Past work lookup order** — check before re-investigating:
  1. `PROGRESS.txt` + `PROGRESS_OLD_*.txt`
  2. `git log --all --oneline --grep=<keyword>`
  3. Memory search (claude-mem or equivalent)
  4. `CLAUDE/*.md` + project `CLAUDE.md`
- **Commit every significant change** — local repo, descriptive message. No push unless asked.
- **READ INVARIANTS FIRST.** Before touching <risky-subsystem-1>, <risky-subsystem-2>, <risky-subsystem-3> → read `CLAUDE/invariants.md`. Single-source MUSTs/NEVERs derived from past incidents.
- **"Verified" = real run, not compile.** Type-check / build pass = syntax OK only. Mark verified only after running against a live env. Say "compiles, untested" until that happens.
- **Sync CLAUDE.md with code.** New port/service/env/endpoint/file rename/schema/table/script/auth flow/deploy step → update matching doc in the same commit. Targets: root `CLAUDE.md`, `CLAUDE/<topic>.md`, project `CLAUDE.md`. Skip only: typos, comment edits, pure internal refactor.

## Detail Docs (read when relevant)

| File | When to read |
|------|--------------|
| `CLAUDE/invariants.md` | **MUSTs/NEVERs** — load-bearing rules from incidents. Read before risky edits. |
| `CLAUDE/lessons-learned.md` | Backward-looking incident log, grouped by subsystem. |
| `CLAUDE/system-flows.md` | Cross-system data flows: topology, connection matrix, numbered flows. |
| `CLAUDE/servers.md` | SSH keys, hosts, environment topology. |
| `CLAUDE/services.md` | Port map, containers, dev commands, tests, logs. |
| `CLAUDE/deploy.md` | Build/push, release flow. |
| `CLAUDE/db.md` | Schemas, connection strings, keys. |
| `CLAUDE/api.md` | Current REST endpoint table (kept in sync with `server/src/app.ts` route mounts). |

## Per-project Refs

- `<project-a>/CLAUDE.md` — <project-a> guide
- `<project-b>/CLAUDE.md` — <project-b> guide
