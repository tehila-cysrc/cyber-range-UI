# Services

## Port map (dev)

| Service | Port | Container | Purpose |
|---------|------|-----------|---------|
| client  | 5173 | none (Vite dev server) | React/Vite/TS SPA. Proxies `/api` and `/socket.io` to the server (see `client/vite.config.ts`). |
| server  | 4000 | none (Node process) | Express API + Socket.io. SQLite file at `server/data/cyber-range.db`. |

## Dev commands

| What | Command |
|------|---------|
| Install deps (whole workspace) | `npm install` (run at repo root — npm workspaces cover `client` + `server`) |
| Run both dev servers | `npm run dev` (repo root; concurrently runs server+client) |
| Run server only | `npm run dev -w server` |
| Run client only | `npm run dev -w client` |
| Apply DB schema | `npm run migrate -w server` |
| Seed DB (idempotent) | `npm run seed -w server` (also runs migrate first) |
| Build for prod | `npm run build` (repo root) |
| Type-check server | `npx -w server tsc -b` |
| Type-check client | `npx -w client tsc -b` |

## Project map

- `client/` — React + Vite + TypeScript SPA, styled per `docs/DESIGN.md` ("Obsidian Telemetry"). Entrypoint: `client/src/main.tsx`.
- `server/` — Express + TypeScript API + Socket.io. Entrypoint: `server/src/server.ts`.

## Environment

Copy `.env.example` (repo root) to `.env`. `server/src/env.ts` loads it via a `../.env` relative path because npm workspace scripts run with `cwd = server/`. Vars: `PORT` (server), `DB_PATH` (relative to `server/`), `TOKEN_TTL_HOURS`, `CLIENT_ORIGIN` (CORS), `CREDENTIAL_MASTER_KEY` (32 random bytes, base64 — encrypts registered cloud-environment credentials at rest; see below).

## External dependencies

`@azure/identity` + `@azure/arm-resources` — the project's first outbound external/cloud dependency, added for the live cloud-environment integration (`server/src/services/environments.service.ts`, connectivity check). Both are pure JS/TS with no native bindings, deliberately chosen to avoid the same class of install failure as `better-sqlite3` below. Later discovery/broker phases add `@azure/arm-resourcegraph` and a Guacamole client — see the design plan referenced in `PROGRESS.txt`.

## Persistence note

Uses Node's built-in `node:sqlite` (`DatabaseSync`), not `better-sqlite3` — the plan originally called for `better-sqlite3`, but it failed to install on this dev machine (no prebuilt binary for the Node version in use on Windows, and no Visual Studio Build Tools to compile from source). `node:sqlite` has the same synchronous `prepare/run/get/all` shape and ships with Node >=22.5 with zero native compilation. It's marked experimental by Node (logs an `ExperimentalWarning`) but is fully functional. See `PROGRESS.txt` entry `phase0-scaffolding` for the full story if this ever needs revisiting (e.g. if a future Node/OS combo gets a working `better-sqlite3` prebuild and someone wants to switch back).
