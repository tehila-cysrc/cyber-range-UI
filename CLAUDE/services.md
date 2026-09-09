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

Copy `.env.example` (repo root) to `.env`. `server/src/env.ts` loads it via a `../.env` relative path because npm workspace scripts run with `cwd = server/`. Vars: `PORT` (server), `DB_PATH` (relative to `server/`), `TOKEN_TTL_HOURS`, `CLIENT_ORIGIN` (CORS), `CREDENTIAL_MASTER_KEY` (32 random bytes, base64 — encrypts registered cloud-environment credentials at rest; see below), `GUACAMOLE_LITE_SECRET_KEY` (same generation, encrypts access-broker connection tokens — see below), optional `GUACD_GATEWAY_WS_URL` (unset in dev — no gateway deployed, see below) and `ACCESS_SESSION_TTL_MINUTES` (default 15).

## External dependencies

`@azure/identity` + `@azure/arm-resources` — the project's first outbound external/cloud dependency, added for the live cloud-environment integration (`server/src/services/environments.service.ts`, connectivity check). `@azure/arm-resourcegraph` added for Phase 2 (`server/src/services/discovery/`) — one Resource Graph query covers all discovered resource types, so no `arm-compute`/`arm-network`/etc. dependency was needed. All three are pure JS/TS with no native bindings, deliberately chosen to avoid the same class of install failure as `better-sqlite3` below (arm-resourcegraph does pull in the older, deprecated `@azure/ms-rest-js`/`@azure/ms-rest-azure-js` transitively — deprecation warnings only, still pure JS).

## Phase 4: student access broker (no guacd deployed in this dev environment)

`server/src/services/accessBroker/guacamoleToken.service.ts` implements guacamole-lite's actual token wire format (AES-256-CBC, `{iv, value}` JSON envelope, base64) purely with Node's built-in `node:crypto` — **no `guacamole-lite`/`guacd` dependency was added**, because there's nothing here to run it against: no `guacd` daemon, no network path to the lab VMs, and no VM login credentials for this dev machine. The broker (`accessBroker.service.ts`) still does everything up to minting that token and tracking the session — RBAC scoping, credential resolution, `access_sessions` bookkeeping, the expiry sweep (`accessSessionExpiry.service.ts`, same `setInterval` pattern as `clock.service.ts`) — verified live end-to-end against the real dev DB and a real HTTP round-trip (see `PROGRESS.txt`). What's *not* verified, and can't be from this environment: an actual guacd decrypting that token and opening a real RDP/SSH session. `GUACD_GATEWAY_WS_URL` stays unset here; `requestAccessSession` returns `wsUrl: null` in that case rather than failing — the session is still real and tracked, just without a gateway to hand a URL for. Setting that env var against a real guacd/guacamole-lite deployment (same `GUACAMOLE_LITE_SECRET_KEY` on both sides) should work against this token format unmodified — that's the intended completion path, not a rewrite.

## Persistence note

Uses Node's built-in `node:sqlite` (`DatabaseSync`), not `better-sqlite3` — the plan originally called for `better-sqlite3`, but it failed to install on this dev machine (no prebuilt binary for the Node version in use on Windows, and no Visual Studio Build Tools to compile from source). `node:sqlite` has the same synchronous `prepare/run/get/all` shape and ships with Node >=22.5 with zero native compilation. It's marked experimental by Node (logs an `ExperimentalWarning`) but is fully functional. See `PROGRESS.txt` entry `phase0-scaffolding` for the full story if this ever needs revisiting (e.g. if a future Node/OS combo gets a working `better-sqlite3` prebuild and someone wants to switch back).
