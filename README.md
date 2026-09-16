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

On Vercel, set the Root Directory to `client` and use the Vite preset.
`client/vercel.json` serves `index.html` for application routes such as `/login`.

For Render, build with `npm ci && npm run build -w server` from the repository
root, then start with `npm run start -w server`. Use Node.js 24 and set
`CLIENT_ORIGIN=https://cyber-range-ui.vercel.app`. Set `DB_PATH` to a file on a
persistent disk to retain event data across deployments.

The server applies migrations and seeds missing defaults before accepting requests.
If no active event exists, it creates the default event, instructor, and demo teams
listed above. Existing active events, users, and teams are preserved on restart.
The server build copies the SQL schema into `dist/db/schema` for this startup step.

## Project layout

```
client/   React SPA (routes, features, sockets)
server/   Express API, Socket.io, SQLite schema/migrations
docs/     Design system, PRD, Azure IAM role definitions
```

See `docs/DESIGN.md` for the visual design system ("Obsidian Telemetry") and
`docs/specs/PRD.docx` for product requirements.
