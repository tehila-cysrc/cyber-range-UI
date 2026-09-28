# Cyber Range UI

Training-event management system for SOC students. Teams work through "Cyber
Range" attack-simulation scenarios across three themed days (AI / Azure /
AWS), document findings on a shared timeline, request instructor help, and
get scored and leaderboarded by an instructor in real time.

## Stack

- **Client:** React + Vite + TypeScript SPA (`client/`)
- **Server:** Express + TypeScript API with Socket.io for realtime updates (`server/`)
- **Database:** SQLite via Node's built-in `node:sqlite` (`server/data/`)

## Getting started

```bash
npm install
cp .env.example .env   # fill in CREDENTIAL_MASTER_KEY, see comments in the file
npm run migrate
npm run seed
npm run dev
```

This starts the API on `http://localhost:4000` and the client on
`http://localhost:5173`.

### Default seeded users

| Role       | Username     | Password      |
|------------|--------------|---------------|
| Instructor | `instructor` | `instructor123` |
| Student    | `alice`, `bob` (Team Alpha) | `student123` |
| Student    | `carol`, `dave` (Team Bravo) | `student123` |

Passwords are stored in plaintext by design — this is an internal tool, not
public-facing.

## Scripts

Run from the repo root (npm workspaces):

| Command | What it does |
|---------|---------------|
| `npm run dev` | Runs server + client together |
| `npm run migrate` | Applies the SQLite schema |
| `npm run seed` | Seeds the default event/teams/users above |
| `npm run build` | Builds server and client for production |

## Deployment

The client is a static site and the API is a separate Node.js 24 process; the server does not serve the client.

**Client:** `npm run build -w client`, then host `client/dist`. Set `VITE_API_ORIGIN` at build time to the
API's public origin (e.g. `https://api.example.com`); leave it unset only when the API is reachable on the same
origin as the page (a reverse proxy routing `/api` and `/socket.io`). Configure the host to serve `index.html`
for application routes such as `/login` (`client/vercel.json` does this on Vercel).

**Server:** `npm ci && npm run build -w server`, then `npm run start -w server`. Required environment:

- `CLIENT_ORIGIN` — the client's public origin (CORS and Socket.IO).
- `DB_PATH` — a file on persistent storage, or event data is lost when the process/container restarts.
- `CREDENTIAL_MASTER_KEY` — base64 32-byte key. Without it, registering a cloud environment fails with a 500.
  To bring over environments from an existing database, use the same key that encrypted them.

The server applies migrations and seeds missing defaults before accepting requests.
If no active event exists, it creates the default event, instructor, and demo teams
listed above. Existing active events, users, and teams are preserved on restart.
The server build copies the SQL schema into `dist/db/schema` for this startup step.

The Script Library catalog is **not** loaded at startup. After the first deploy, run it once from the
server directory (idempotent; needs the repo's `script-library/` folder next to `server/`):
`node dist/db/importScriptLibrary.js`.

## Project layout

```
client/   React SPA (routes, features, sockets)
server/   Express API, Socket.io, SQLite schema/migrations
docs/     Design system, PRD, Azure IAM role definitions
```

See `docs/DESIGN.md` for the visual design system ("Obsidian Telemetry") and
`docs/specs/PRD.docx` for product requirements.
