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

Production runs as one Docker container (root `Dockerfile`, deployed with Coolify) that serves the built
client and the API on the same origin. Coolify detects the `Dockerfile` automatically.

Required configuration:

- `CREDENTIAL_MASTER_KEY` — base64, decodes to 32 bytes. Without it, registering a cloud environment fails
  with a 500. To bring over environments from an existing database, use the same key that encrypted them.
  Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- Persistent storage mounted at `/data` — the database file is `DB_PATH=/data/cyber-range.db`. Without it,
  every redeploy starts from an empty database.

The process listens on `PORT` (default 4000). Health check: `GET /api/health`.

On startup the server applies migrations and seeds missing defaults. If no active event exists, it creates
the default event, instructor, and demo teams listed above; existing events, users, and teams are preserved.
If the Script Library is empty, it imports the curated `script-library/` catalog (bundled into the image);
scripts an instructor later deletes are not re-imported while at least one script remains.

A client hosted separately from the API can set `VITE_API_ORIGIN` to the API origin at build time; the
Docker image leaves it unset (same origin).

## Project layout

```
client/   React SPA (routes, features, sockets)
server/   Express API, Socket.io, SQLite schema/migrations
docs/     Design system, PRD, Azure IAM role definitions
```

See `docs/DESIGN.md` for the visual design system ("Obsidian Telemetry") and
`docs/specs/PRD.docx` for product requirements.
